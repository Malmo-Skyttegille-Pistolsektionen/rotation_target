/**
 * Mock Server v2 - SSE-first architecture
 *
 * Key differences from v1:
 * - Single `stateUpdate` SSE event (no per-event SSE)
 * - REST program payloads use snake_case `audio_ids`, matching the firmware
 * - `stop` pauses execution (keeps position), `reset` is explicit
 * - `tickerMs` = milliseconds elapsed in current SERIES (not event)
 * - `currentEventIndex` derived from tickerMs + cumulative durations
 *
 * See webapp/docs/server-spec.md and contracts/ for details.
 *
 * Interim: E2E is moving to the real firmware under QEMU, at which point this
 * shrinks to a unit fixture. Lives under `test/` so it can never reach the
 * production bundle.
 */
import type { ServerResponse, IncomingMessage } from 'http';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  Program,
  StateUpdatePayload,
  ProgramState,
  AudioFile,
  DiagnosticsInfo,
  LibraryChangedPayload,
  ProgramSummary,
  Series,
  StartupIssue,
  Event,
} from '../../src/api/types';
import type { EventLocation } from '../../src/lib/run-position';
import { locateEvent, seriesTotalMs } from '../../src/lib/run-position';
import type { Clock } from './clock';
import { realClock } from './clock';

// --- Constants ---
const API_PREFIX = '/api/v2';
const SSE_PATH = '/sse/v2';
const HEARTBEAT_INTERVAL = 10000; // 10 seconds
const TICK_INTERVAL = 1000; // 1 second
/** `kMaxUploadBytes` in firmware/main/config.h. */
const MAX_UPLOAD_BYTES = 1024 * 1024;
/** `kFirstUploadId` in firmware/main/config.h - the floor for uploaded audio AND program ids. */
const FIRST_UPLOAD_ID = 100;
/**
 * How long a clip counts as playing, so `DELETE` can answer 409 the way the
 * device does. Under a fake clock nothing expires until a test advances it.
 */
const PLAYBACK_DURATION = 3000;

/** `kMaxStartupIssues` in firmware/main/net/sse_hub.cpp: the ring is bounded, oldest dropped. */
const MAX_STARTUP_ISSUES = 8;

/** Per-event clamp the firmware applies on parse. */
const MIN_DURATION_MS = 1;
const MAX_DURATION_MS = 3600000;

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, '../data');

// --- Seed data ---

export interface MockSeed {
  programs: Record<number, Program>;
  audios: AudioFile[];
  /**
   * What the boot scan complained about, served by `GET /diagnostics/info`
   * (D-25). Defaults to none, which is what a clean boot reports.
   */
  startupIssues?: StartupIssue[];
}

/**
 * The shipped programs and audios under `test/data`, plus a writable copy of
 * the last three of each (id + 1000) so the editor has something non-readonly
 * to work on.
 */
export function loadSeedFromDisk(dataDir: string = DATA_DIR): MockSeed {
  const programsDir = path.join(dataDir, 'programs');
  const programFiles = fs.readdirSync(programsDir).filter((f) => /^\d+\.json$/.test(f));

  const programs: Record<number, Program> = {};
  for (const file of programFiles) {
    const id = parseInt(file.replace('.json', ''), 10);
    programs[id] = JSON.parse(fs.readFileSync(path.join(programsDir, file), 'utf-8'));
  }

  for (const file of programFiles.slice(-3)) {
    const id = parseInt(file.replace('.json', ''), 10);
    const newId = id + 1000;
    const data = JSON.parse(fs.readFileSync(path.join(programsDir, file), 'utf-8'));
    programs[newId] = { ...data, id: newId, readonly: false };
  }

  const audiosData = JSON.parse(fs.readFileSync(path.join(dataDir, 'audios/audios.json'), 'utf-8')) as Record<
    string,
    { title: string; filename: string }
  >;

  const audios: AudioFile[] = Object.entries(audiosData).map(([id, audio]) => ({
    id: Number(id),
    title: audio.title,
    filename: `/storage/shipped/audio/${audio.filename}`,
    readonly: true,
  }));

  // Paths match `RT_UPLOADS_AUDIO_DIR` in firmware/main/config.h.
  for (const [id, audio] of Object.entries(audiosData).slice(-3)) {
    audios.push({
      id: Number(id) + 1000,
      title: audio.title,
      filename: `/storage/uploads/audio/${audio.filename}`,
      readonly: false,
    });
  }

  return { programs, audios };
}

/**
 * `parse_command` in `firmware/lib/rt_logic/program.cpp`: absent, JSON `null`
 * and `""` all mean "leave the targets where they are"; `show` and `hide` are
 * the commands; anything else - a typo, the wrong case, a non-string - refuses
 * the whole program, so that `shwo` fails at upload instead of becoming a
 * target that silently never turns mid-exercise.
 */
function parseCommand(raw: unknown): { ok: true; command?: Event['command'] } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true };
  if (raw !== 'show' && raw !== 'hide') return { ok: false };
  return { ok: true, command: raw };
}

/**
 * What the firmware keeps of an uploaded document: unknown fields dropped,
 * durations clamped, `id` from the path (or the assignment) and `readonly`
 * false. `POST /programs` and `PUT /programs/{id}` both store this form, and
 * it is what a later `GET` returns. `null` when the document is one the device
 * refuses outright.
 */
function normalizeProgram(raw: Record<string, unknown>, id: number): Program | null {
  let refused = false;

  const rawSeries = Array.isArray(raw.series) ? (raw.series as unknown[]) : [];

  const series: Series[] = rawSeries.filter(isRecord).map((entry) => {
    const rawEvents = Array.isArray(entry.events) ? (entry.events as unknown[]) : [];

    const events: Event[] = rawEvents.filter(isRecord).map((rawEvent) => {
      const duration = typeof rawEvent.duration === 'number' ? Math.trunc(rawEvent.duration) : MIN_DURATION_MS;
      const event: Event = { duration: Math.min(Math.max(duration, MIN_DURATION_MS), MAX_DURATION_MS) };

      const command = parseCommand(rawEvent.command);
      if (!command.ok) refused = true;
      else if (command.command !== undefined) event.command = command.command;
      if (Array.isArray(rawEvent.audio_ids)) {
        event.audio_ids = (rawEvent.audio_ids as unknown[]).filter((v): v is number => typeof v === 'number');
      }
      return event;
    });

    return {
      name: typeof entry.name === 'string' ? entry.name : '',
      optional: entry.optional === true,
      events,
    };
  });

  if (refused) return null;

  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    readonly: false,
    series,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- Server ---

export interface MockServerOptions {
  /** Data the server starts with. Defaults to the fixtures under `test/data`. */
  seed?: MockSeed;
  /** Port for `listen()`. 0 (the default) picks a free one; read `server.port` after. */
  port?: number;
  /** Defaults to real timers. Tests pass a fake clock so simulated time is free. */
  clock?: Clock;
}

export interface MockServer {
  /** Connect-style middleware, for mounting in the Vite dev server. */
  middleware(req: IncomingMessage, res: ServerResponse, next: () => void): void;
  /** Back to a freshly booted device, without rebinding the socket. */
  reset(): void;
  /** Bind a real socket (for tests that want to speak HTTP). Resolves to the bound port. */
  listen(): Promise<number>;
  /** Stop timers, drop SSE clients, close the socket if one was opened. */
  close(): Promise<void>;
  readonly port: number;
}

interface ServerState {
  loadedProgram: Program | null;
  programState: ProgramState | null;
  targetStatus: 'shown' | 'hidden';
  adminModePassword: string | null;
  adminModeTokens: Set<string>;
  /** Clock time the current series started running at. */
  seriesStartTime: number | null;
  /** The clip `POST /audios/{id}/play` last started, and when it stops counting as playing. */
  playingAudioId: number | null;
  playingUntil: number | null;
}

interface SSEClient {
  res: ServerResponse;
  cancelHeartbeat: () => void;
}

export function createMockServer(options: MockServerOptions = {}): MockServer {
  const clock = options.clock ?? realClock;
  const requestedPort = options.port ?? 0;
  const seed = options.seed ?? loadSeedFromDisk();
  // Uploads, edits and deletes mutate both, so each is a copy of the seed and
  // `reset()` puts it back rather than leaking one test's writes into the next.
  const audios: AudioFile[] = [...seed.audios];
  const programs: Record<number, Program> = {};
  function restorePrograms(): void {
    for (const key of Object.keys(programs)) delete programs[Number(key)];
    for (const [id, program] of Object.entries(seed.programs)) {
      programs[Number(id)] = JSON.parse(JSON.stringify(program)) as Program;
    }
  }
  restorePrograms();

  const state: ServerState = {
    loadedProgram: null,
    programState: null,
    targetStatus: 'hidden',
    adminModePassword: null,
    adminModeTokens: new Set<string>(),
    seriesStartTime: null,
    playingAudioId: null,
    playingUntil: null,
  };

  // What `uptimeSeconds` counts from. The mock has no reboot, so this is fixed
  // for the life of the server - as are the startup issues, which the device
  // collects once during boot and never adds to while it is up (D-25).
  const bootedAt = clock.now();
  const startupIssues: StartupIssue[] = (seed.startupIssues ?? []).slice(-MAX_STARTUP_ISSUES);

  const clients: SSEClient[] = [];
  let httpServer: http.Server | null = null;
  let boundPort = 0;

  // --- Helpers ---

  function getStateUpdatePayload(): StateUpdatePayload {
    return {
      loadedProgramId: state.loadedProgram?.id ?? null,
      programState: state.programState,
      targetStatus: state.targetStatus,
    };
  }

  function stateUpdateFrame(): string {
    return `event: stateUpdate\ndata: ${JSON.stringify(getStateUpdatePayload())}\n\n`;
  }

  function broadcastState(): void {
    const message = stateUpdateFrame();
    clients.forEach(({ res }) => res.write(message));
  }

  /**
   * `sse_hub::broadcast_library_changed`, emitted from the REST handlers after
   * a change has reached storage and the response is a success (D-24) - never
   * from load/start/stop/reset/skip_to/unload, which change what the device is
   * doing rather than what it stores.
   */
  function broadcastLibraryChanged(kind: LibraryChangedPayload['kind']): void {
    const message = `event: libraryChanged\ndata: ${JSON.stringify({ kind })}\n\n`;
    clients.forEach(({ res }) => res.write(message));
  }

  function isAdminEnabled(): boolean {
    return state.adminModePassword !== null;
  }

  function createAdminToken(): string {
    return Math.random().toString(36).slice(2) + clock.now();
  }

  function hasAdminToken(token: string | undefined): boolean {
    if (!token) {
      return false;
    }

    return state.adminModeTokens.has(token);
  }

  function issueAdminSession(res: ServerResponse): string {
    const token = createAdminToken();
    state.adminModeTokens.add(token);
    res.setHeader('Set-Cookie', `admin=${token}; Path=/; SameSite=Lax`);
    return token;
  }

  function parseCookies(req: IncomingMessage): Record<string, string> {
    const cookies: Record<string, string> = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      cookieHeader.split(';').forEach((cookie) => {
        const [name, ...rest] = cookie.trim().split('=');
        cookies[name] = rest.join('=');
      });
    }
    return cookies;
  }

  function checkAdminAuth(req: IncomingMessage, res: ServerResponse): boolean {
    // If admin mode is disabled, allow all requests
    if (!isAdminEnabled()) {
      return true;
    }

    // Check Authorization header first
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ') && hasAdminToken(auth.slice(7))) {
      return true;
    }

    // Check cookie as fallback
    const cookies = parseCookies(req);
    if (hasAdminToken(cookies['admin'])) {
      return true;
    }

    jsonResponse(res, 401, { error: 'Invalid or missing bearer token' });
    return false;
  }

  function parseBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        resolve(body);
      });
    });
  }

  function parseBodyBuffer(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      // Without these a client that hangs up mid-body never settles the
      // promise, and the request handler is stuck for the life of the server.
      req.on('error', reject);
      req.on('aborted', () => reject(new Error('request aborted')));
    });
  }

  interface ParsedUpload {
    filename: string;
    title: string;
    content: Buffer;
  }

  /**
   * Enough of RFC 7578 for one file part and one text field. The device does
   * not inspect the file part's name either, so neither does this.
   */
  function parseMultipart(req: IncomingMessage, body: Buffer): ParsedUpload | null {
    const contentType = req.headers['content-type'] ?? '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    if (!boundaryMatch) return null;

    const boundary = `--${boundaryMatch[1] ?? boundaryMatch[2]}`;
    const parts = body.toString('latin1').split(boundary).slice(1, -1);

    let filename: string | null = null;
    let title = '';
    let content = Buffer.alloc(0);

    for (const part of parts) {
      const separator = part.indexOf('\r\n\r\n');
      if (separator === -1) continue;

      const headers = part.slice(0, separator);
      // Trailing CRLF belongs to the boundary, not the payload.
      const value = part.slice(separator + 4, part.length - 2);

      const nameMatch = headers.match(/name="([^"]*)"/);
      const filenameMatch = headers.match(/filename="([^"]*)"/);

      if (filenameMatch) {
        filename = filenameMatch[1];
        content = Buffer.from(value, 'latin1');
      } else if (nameMatch?.[1] === 'title') {
        // Split latin1 so byte offsets survive binary parts; a text field has
        // to be decoded back out of those bytes as UTF-8, or "Klubbmasterskap"
        // arrives mojibaked.
        title = Buffer.from(value, 'latin1').toString('utf8');
      }
    }

    return filename === null ? null : { filename, title, content };
  }

  /** `audios::add_uploaded`: the first free slot at or above `kFirstUploadId`, so a deleted id is reused. */
  function nextUploadedId(): number {
    let id = FIRST_UPLOAD_ID;
    while (audios.some((audio) => audio.id === id)) id++;
    return id;
  }

  function isPlaying(id: number): boolean {
    return state.playingAudioId === id && state.playingUntil !== null && clock.now() < state.playingUntil;
  }

  function parseJsonObject(body: string): Record<string, unknown> | null {
    if (!body) return null;
    try {
      const parsed: unknown = JSON.parse(body);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  // --- Simulation ---

  function currentSeries(seriesIndex: number) {
    return state.loadedProgram?.series[seriesIndex] ?? null;
  }

  /** Move the published position onto an already-located event. */
  function applyLocation(series: Series, location: EventLocation): void {
    if (!state.programState) return;

    state.programState.currentEventIndex = location.index;
    state.targetStatus = series.events[location.index].command === 'show' ? 'shown' : 'hidden';
  }

  function runSimulationTick(): void {
    if (!state.programState?.running || state.seriesStartTime === null) return;

    const { currentSeriesIndex } = state.programState;
    if (currentSeriesIndex === null) return;

    const series = currentSeries(currentSeriesIndex);
    if (!series) return;

    const elapsedMs = clock.now() - state.seriesStartTime;

    if (elapsedMs >= seriesTotalMs(series)) {
      const nextSeriesIndex = currentSeriesIndex + 1;

      if (state.loadedProgram && nextSeriesIndex < state.loadedProgram.series.length) {
        // Another series follows: pause at its start, targets hidden.
        state.programState.currentSeriesIndex = nextSeriesIndex;
        state.programState.currentEventIndex = 0;
        state.targetStatus = 'hidden';
      }

      state.programState.running = false;
      state.programState.tickerMs = null;
      state.seriesStartTime = null;

      broadcastState();
      return;
    }

    const location = locateEvent(series, elapsedMs);
    if (!location) return;

    // Whole seconds decide *whether* to publish; milliseconds are what gets
    // published. Same split as rt::Executor::tick - see D-16.
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const publishedSeconds =
      state.programState.tickerMs === null ? null : Math.floor(state.programState.tickerMs / 1000);
    const changed = state.programState.currentEventIndex !== location.index || publishedSeconds !== elapsedSeconds;

    if (changed) {
      state.programState.tickerMs = elapsedMs;
      applyLocation(series, location);
      broadcastState();
    }
  }

  const cancelSimulation = clock.setInterval(runSimulationTick, TICK_INTERVAL);

  // --- REST routing ---

  async function handleRest(req: IncomingMessage, res: ServerResponse, endpoint: string): Promise<void> {
    // --- Admin Mode Endpoints ---

    // GET /admin-mode/status - no auth: every client needs to know.
    if (endpoint === '/admin-mode/status' && req.method === 'GET') {
      jsonResponse(res, 200, { enabled: isAdminEnabled() });
      return;
    }

    // POST /admin-mode/enable
    if (endpoint === '/admin-mode/enable' && req.method === 'POST') {
      const body = await parseBody(req);

      if (isAdminEnabled()) {
        jsonResponse(res, 409, {
          error: 'Admin mode is already enabled. Log in or disable it before enabling again.',
        });
        return;
      }

      try {
        const data = JSON.parse(body);
        if (typeof data.password === 'string' && data.password.length > 0) {
          state.adminModePassword = data.password;
          jsonResponse(res, 200, { token: issueAdminSession(res) });
        } else {
          jsonResponse(res, 401, { error: 'Invalid password' });
        }
      } catch {
        jsonResponse(res, 400, { error: 'Invalid JSON' });
      }
      return;
    }

    // POST /admin-mode/login
    if (endpoint === '/admin-mode/login' && req.method === 'POST') {
      const body = await parseBody(req);

      if (!isAdminEnabled()) {
        jsonResponse(res, 409, { error: 'Admin mode is not enabled. Enable it before logging in.' });
        return;
      }

      try {
        const data = JSON.parse(body);
        if (typeof data.password === 'string' && data.password === state.adminModePassword) {
          jsonResponse(res, 200, { token: issueAdminSession(res) });
        } else {
          jsonResponse(res, 401, { error: 'Invalid password' });
        }
      } catch {
        jsonResponse(res, 400, { error: 'Invalid JSON' });
      }
      return;
    }

    // POST /admin-mode/disable
    if (endpoint === '/admin-mode/disable' && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      state.adminModePassword = null;
      state.adminModeTokens.clear();
      jsonResponse(res, 200, { message: 'Admin mode disabled' });
      return;
    }

    // --- Diagnostics ---

    // GET /diagnostics/info - public, like every other GET. The health figures
    // are plausible constants; the two fields a test can care about are read
    // from the live state (`startupIssues`, and the counts).
    if (endpoint === '/diagnostics/info' && req.method === 'GET') {
      const info: DiagnosticsInfo = {
        version: '2.0.0-mock',
        idfVersion: 'v6.0.2',
        buildDate: 'Aug 21 2026 09:12:44',
        resetReason: 'poweron',
        uptimeSeconds: Math.floor((clock.now() - bootedAt) / 1000),
        freeHeapBytes: 182_344,
        minFreeHeapBytes: 170_112,
        freePsramBytes: 8_216_576,
        runningPartition: 'ota_0',
        coredumpPresent: false,
        storageTotalBytes: 12_582_912,
        storageUsedBytes: 4_194_304,
        programCount: Object.keys(programs).length,
        audioCount: audios.length,
        ipAddress: '127.0.0.1',
        targetGpio: 4,
        targetGpioLevel: state.targetStatus === 'shown' ? 1 : 0,
        adminModeEnabled: isAdminEnabled(),
        // Already bounded at construction: an array of exactly 8 may be a
        // truncated one, which is what the contract says and what the app warns
        // about.
        startupIssues,
      };
      jsonResponse(res, 200, info);
      return;
    }

    // --- Programs Endpoints ---

    // GET /programs - No auth required (read-only)
    if (endpoint === '/programs' && req.method === 'GET') {
      const list: ProgramSummary[] = Object.values(programs).map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        readonly: p.readonly,
      }));
      jsonResponse(res, 200, list);
      return;
    }

    // POST /programs - Requires auth. The document's id is ignored: the device
    // assigns the next free one from 100 up and stores what it parsed.
    if (endpoint === '/programs' && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      const raw = parseJsonObject(await parseBody(req));
      if (!raw) {
        jsonResponse(res, 400, { error: 'Invalid program' });
        return;
      }

      // Lowest free id from 100 up, not highest+1: `firmware/main/repositories/
      // programs.cpp` walks `id = kFirstUploadId; while (count(id)) id++`, so a
      // deleted program's id is handed straight back out. Shipped programs
      // occupy some of that range on the real device (100 and 101 today), and
      // the two allocators disagree the moment anything is deleted.
      let id = FIRST_UPLOAD_ID;
      while (programs[id] !== undefined) id++;
      const program = normalizeProgram(raw, id);
      if (!program) {
        jsonResponse(res, 400, { error: 'Invalid program' });
        return;
      }
      programs[id] = program;
      broadcastLibraryChanged('program');
      jsonResponse(res, 201, { id });
      return;
    }

    // GET /programs/{id} - No auth required (read-only)
    const programGetMatch = endpoint.match(/^\/programs\/(\d+)$/);
    if (programGetMatch && req.method === 'GET') {
      const program = programs[parseInt(programGetMatch[1], 10)];
      if (!program) {
        jsonResponse(res, 404, { error: 'Program not found' });
        return;
      }
      jsonResponse(res, 200, program);
      return;
    }

    // PUT /programs/{id} - Requires auth. See D-15: the path owns the id, a
    // shipped program is a 409, and so is the loaded one.
    if (programGetMatch && req.method === 'PUT') {
      if (!checkAdminAuth(req, res)) return;
      const id = parseInt(programGetMatch[1], 10);
      const existing = programs[id];
      if (!existing) {
        jsonResponse(res, 404, { error: 'Program not found' });
        return;
      }
      if (existing.readonly) {
        jsonResponse(res, 409, { error: 'Program is read-only and cannot be updated' });
        return;
      }
      if (state.loadedProgram?.id === id) {
        jsonResponse(res, 409, { error: 'Program is loaded; unload it before updating' });
        return;
      }

      const raw = parseJsonObject(await parseBody(req));
      if (!raw) {
        jsonResponse(res, 400, { error: 'Invalid program' });
        return;
      }
      // Parsed before the id is compared, as `update_uploaded` does: a document
      // that is refused outright is `kInvalid` even when its id also mismatches.
      const replacement = normalizeProgram(raw, id);
      if (!replacement) {
        jsonResponse(res, 400, { error: 'Invalid program' });
        return;
      }
      if (raw.id !== undefined && raw.id !== null && raw.id !== id) {
        jsonResponse(res, 400, { error: 'Program id in the document does not match the path' });
        return;
      }

      programs[id] = replacement;
      broadcastLibraryChanged('program');
      jsonResponse(res, 200, programs[id]);
      return;
    }

    // DELETE /programs/{id}/delete - Requires auth. Deletability is decided
    // before anything is unloaded, and a shipped program is a 409, not a 404
    // (D-23): it exists, GET lists it and fetches it, and only the write is
    // refused - the same answer PUT gives for the same program. 404 is left
    // meaning exactly one thing.
    const programDeleteMatch = endpoint.match(/^\/programs\/(\d+)\/delete$/);
    if (programDeleteMatch && req.method === 'DELETE') {
      if (!checkAdminAuth(req, res)) return;
      const id = parseInt(programDeleteMatch[1], 10);
      const existing = programs[id];
      if (!existing) {
        jsonResponse(res, 404, { error: 'Program not found' });
        return;
      }
      if (existing.readonly) {
        jsonResponse(res, 409, { error: 'Program is read-only and cannot be deleted' });
        return;
      }

      // Unloaded first, as the firmware does: the run loop holds a pointer into
      // the program, and the client needs the stateUpdate either way. Whatever
      // the run state - refusing is not an option once the file is going.
      if (state.loadedProgram?.id === id) {
        state.loadedProgram = null;
        state.programState = null;
        state.seriesStartTime = null;
        broadcastState();
      }

      delete programs[id];

      // Both events, for their two different reasons: the state changed because
      // nothing is loaded, the library changed because a program is gone.
      broadcastLibraryChanged('program');
      jsonResponse(res, 200, { message: 'Program deleted' });
      return;
    }

    // POST /programs/{id}/load - Requires auth
    const programLoadMatch = endpoint.match(/^\/programs\/(\d+)\/load$/);
    if (programLoadMatch && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      const program = programs[parseInt(programLoadMatch[1], 10)];
      if (!program) {
        jsonResponse(res, 404, { error: 'Program not found' });
        return;
      }

      state.loadedProgram = program;
      state.programState = {
        running: false,
        currentSeriesIndex: 0,
        currentEventIndex: 0,
        tickerMs: null,
      };
      state.seriesStartTime = null;

      broadcastState();
      jsonResponse(res, 200, { message: 'Program loaded' });
      return;
    }

    // POST /programs/unload - Requires auth. `rt::Executor::unload` (D-22):
    // running is refused first, so the refusal is the answer whenever there is
    // a run to protect; nothing loaded is a 200 that publishes nothing, because
    // the payload would repeat the one clients already hold.
    if (endpoint === '/programs/unload' && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      if (state.programState?.running) {
        jsonResponse(res, 409, { error: 'A program is running - stop it before unloading' });
        return;
      }
      if (!state.loadedProgram) {
        jsonResponse(res, 200, { message: 'Program unloaded' });
        return;
      }

      // The targets are left where the run left them: unloading moves no
      // hardware, so `targetStatus` is untouched.
      state.loadedProgram = null;
      state.programState = null;
      state.seriesStartTime = null;

      broadcastState();
      jsonResponse(res, 200, { message: 'Program unloaded' });
      return;
    }

    // POST /programs/start - Requires auth. The body names the program the
    // caller decided to start (D-27); the device refuses a start for one it no
    // longer holds. Order mirrors `rt::Executor::start`: a malformed body is
    // rejected before anything is read, then "nothing loaded" (the more precise
    // diagnosis, and the answer this endpoint always gave), then the id.
    if (endpoint === '/programs/start' && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;

      const startBody = parseJsonObject(await parseBody(req));
      const requestedId = startBody?.id;
      if (typeof requestedId !== 'number' || !Number.isInteger(requestedId)) {
        jsonResponse(res, 400, { error: 'Expected a JSON body naming the program to start: {"id": <id>}' });
        return;
      }

      if (!state.loadedProgram || !state.programState) {
        jsonResponse(res, 400, { error: 'No program loaded' });
        return;
      }

      if (state.loadedProgram.id !== requestedId) {
        // Checked whether or not a run is in progress, as in the firmware: a
        // start aimed at the wrong program is never answered "fine, it is
        // running". Both ids, so the operator learns what the device holds.
        jsonResponse(res, 409, {
          error: `Start refused: the device has program ${state.loadedProgram.id} loaded, not program ${requestedId}`,
        });
        return;
      }

      const { currentSeriesIndex } = state.programState;
      if (currentSeriesIndex === null) {
        jsonResponse(res, 400, { error: 'Invalid program state' });
        return;
      }

      // Resume from where a pause left the ticker, otherwise from the top.
      const resumeFromMs = state.programState.tickerMs ?? 0;
      state.programState.running = true;
      state.seriesStartTime = clock.now() - resumeFromMs;
      state.programState.tickerMs = resumeFromMs;

      // Mirrors rt::Executor::start: a resume point past the end of the series
      // has no event to enter, and the next tick completes the series.
      const series = currentSeries(currentSeriesIndex);
      const location = series ? locateEvent(series, resumeFromMs) : null;
      if (series && location) applyLocation(series, location);

      broadcastState();
      jsonResponse(res, 200, { message: 'Program started' });
      return;
    }

    // POST /programs/stop - Requires auth
    if (endpoint === '/programs/stop' && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      if (!state.programState?.running) {
        jsonResponse(res, 400, { error: 'Program not running' });
        return;
      }

      // Pause: keep current position and tickerMs
      state.programState.running = false;
      state.seriesStartTime = null;

      broadcastState();
      jsonResponse(res, 200, { message: 'Program paused' });
      return;
    }

    // POST /programs/reset - Requires auth
    if (endpoint === '/programs/reset' && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      if (!state.loadedProgram || !state.programState) {
        jsonResponse(res, 400, { error: 'No program loaded' });
        return;
      }

      // Reset to start of current series
      state.programState.running = false;
      state.programState.currentEventIndex = 0;
      state.programState.tickerMs = null;
      state.seriesStartTime = null;

      broadcastState();
      jsonResponse(res, 200, { message: 'Program reset' });
      return;
    }

    // POST /programs/series/{idx}/skip_to - Requires auth
    const skipToMatch = endpoint.match(/^\/programs\/series\/(\d+)\/skip_to$/);
    if (skipToMatch && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      const idx = parseInt(skipToMatch[1], 10);

      if (!state.loadedProgram || !state.programState) {
        jsonResponse(res, 400, { error: 'No program loaded' });
        return;
      }

      if (idx < 0 || idx >= state.loadedProgram.series.length) {
        jsonResponse(res, 400, { error: 'Series index out of bounds' });
        return;
      }

      state.programState.currentSeriesIndex = idx;
      state.programState.currentEventIndex = 0;
      state.programState.running = false;
      state.programState.tickerMs = null;
      state.seriesStartTime = null;

      broadcastState();
      jsonResponse(res, 200, { message: `Skipped to series ${idx}` });
      return;
    }

    // --- Targets Endpoints ---

    if (endpoint === '/targets/show' && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      state.targetStatus = 'shown';
      broadcastState();
      jsonResponse(res, 200, { message: 'Targets shown' });
      return;
    }

    if (endpoint === '/targets/hide' && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      state.targetStatus = 'hidden';
      broadcastState();
      jsonResponse(res, 200, { message: 'Targets hidden' });
      return;
    }

    if (endpoint === '/targets/toggle' && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      state.targetStatus = state.targetStatus === 'shown' ? 'hidden' : 'shown';
      broadcastState();
      jsonResponse(res, 200, { message: `Targets ${state.targetStatus}` });
      return;
    }

    // --- Audios Endpoints ---

    if (endpoint === '/audios' && req.method === 'GET') {
      jsonResponse(res, 200, { audios });
      return;
    }

    // POST /audios/{id}/play - Requires auth
    const audioPlayMatch = endpoint.match(/^\/audios\/(\d+)\/play$/);
    if (audioPlayMatch && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      const id = parseInt(audioPlayMatch[1], 10);
      if (!audios.some((a) => a.id === id)) {
        jsonResponse(res, 404, { error: 'Audio not found' });
        return;
      }
      state.playingAudioId = id;
      state.playingUntil = clock.now() + PLAYBACK_DURATION;
      jsonResponse(res, 200, { message: 'Playback started', audioId: id });
      return;
    }

    // POST /audios - Requires auth. Multipart, and only the two things the
    // firmware actually checks are checked here: a `.wav` filename and a
    // non-empty title. The body is measured, not parsed into a file.
    if (endpoint === '/audios' && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      const body = await parseBodyBuffer(req);

      if (body.byteLength > MAX_UPLOAD_BYTES) {
        // Refused above the handler, so not the JSON error shape:
        // `httpd_resp_send_err` labels it `text/html` but sends
        // PsychicUploadHandler's sentence verbatim, markup and all absent.
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`File size must be less than ${MAX_UPLOAD_BYTES} bytes!`);
        return;
      }

      const upload = parseMultipart(req, body);
      if (!upload || !upload.filename.toLowerCase().endsWith('.wav')) {
        jsonResponse(res, 400, { error: 'No file uploaded' });
        return;
      }
      if (!upload.title) {
        jsonResponse(res, 400, { error: 'Missing title' });
        return;
      }
      if (!upload.content.subarray(0, 4).equals(Buffer.from('RIFF'))) {
        jsonResponse(res, 400, { error: 'Unsupported audio format' });
        return;
      }

      const id = nextUploadedId();
      audios.push({
        id,
        title: upload.title,
        filename: `/storage/uploads/audio/${id}.wav`,
        readonly: false,
      });
      broadcastLibraryChanged('audio');
      jsonResponse(res, 201, { id });
      return;
    }

    // DELETE /audios/{id}/delete - Requires auth
    const audioDeleteMatch = endpoint.match(/^\/audios\/(\d+)\/delete$/);
    if (audioDeleteMatch && req.method === 'DELETE') {
      if (!checkAdminAuth(req, res)) return;
      const id = parseInt(audioDeleteMatch[1], 10);
      const index = audios.findIndex((a) => a.id === id);
      // Existence first, so a bogus id is never reported as a conflict; then
      // read-only, which is the reason that never lifts (D-23) and therefore
      // goes ahead of the run-safety conflicts below it.
      if (index === -1) {
        jsonResponse(res, 404, { error: 'Audio not found' });
        return;
      }
      if (audios[index].readonly) {
        jsonResponse(res, 409, { error: 'Audio is read-only and cannot be deleted' });
        return;
      }
      if (isPlaying(id)) {
        jsonResponse(res, 409, { error: 'Audio is currently playing' });
        return;
      }
      audios.splice(index, 1);
      broadcastLibraryChanged('audio');
      jsonResponse(res, 200, { message: 'Audio deleted successfully' });
      return;
    }

    jsonResponse(res, 404, { error: 'Endpoint not found' });
  }

  // --- SSE ---

  function handleSSE(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');

    // Full state on connect, before anything else.
    res.write(stateUpdateFrame());

    let heartbeatId = 1;
    const cancelHeartbeat = clock.setInterval(() => {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ id: heartbeatId })}\n\n`);
      heartbeatId++;
    }, HEARTBEAT_INTERVAL);

    const client: SSEClient = { res, cancelHeartbeat };
    clients.push(client);

    req.on('close', () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) {
        client.cancelHeartbeat();
        clients.splice(idx, 1);
      }
    });
  }

  function middleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const url = new URL(req.url || '', 'http://localhost');

    if (url.pathname === SSE_PATH) {
      handleSSE(req, res);
      return;
    }

    if (!url.pathname.startsWith(API_PREFIX)) {
      next();
      return;
    }

    void handleRest(req, res, url.pathname.slice(API_PREFIX.length));
  }

  return {
    middleware,

    reset(): void {
      restorePrograms();
      state.loadedProgram = null;
      state.programState = null;
      state.targetStatus = 'hidden';
      state.adminModePassword = null;
      state.adminModeTokens.clear();
      state.seriesStartTime = null;
      state.playingAudioId = null;
      state.playingUntil = null;
      audios.splice(0, audios.length, ...seed.audios);
    },

    listen(): Promise<number> {
      return new Promise((resolve, reject) => {
        httpServer = http.createServer((req, res) => {
          middleware(req, res, () => jsonResponse(res, 404, { error: 'Endpoint not found' }));
        });
        // Without this an EADDRINUSE never settles the promise, and the suite
        // dies to a hook timeout that says nothing about the real cause.
        httpServer.on('error', reject);
        httpServer.listen(requestedPort, '127.0.0.1', () => {
          const address = httpServer!.address();
          boundPort = typeof address === 'object' && address !== null ? address.port : requestedPort;
          resolve(boundPort);
        });
      });
    },

    close(): Promise<void> {
      cancelSimulation();
      clients.forEach((client) => {
        client.cancelHeartbeat();
        client.res.end();
      });
      clients.length = 0;

      const server = httpServer;
      httpServer = null;
      if (!server) return Promise.resolve();
      return new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },

    get port(): number {
      return boundPort;
    },
  };
}
