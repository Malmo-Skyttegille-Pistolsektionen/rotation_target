/**
 * Mock Server v2 - SSE-first architecture
 *
 * Key differences from v1:
 * - Single `stateUpdate` SSE event (no per-event SSE)
 * - REST program payloads use snake_case `audio_ids`, matching the firmware
 * - `stop` pauses execution (keeps position), `reset` is explicit
 * - `tickerSeconds` = whole seconds elapsed in current SERIES (not event)
 * - `currentEventIndex` derived from tickerSeconds + cumulative durations
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
import type { Program, StateUpdatePayload, ProgramState, AudioFile, ProgramSummary, Series } from '../../src/api/types';
import type { EventLocation } from '../../src/lib/run-position';
import { locateEvent, seriesTotalMs } from '../../src/lib/run-position';
import type { Clock } from './clock';
import { realClock } from './clock';

// --- Constants ---
const API_PREFIX = '/api/v2';
const SSE_PATH = '/sse/v2';
const HEARTBEAT_INTERVAL = 10000; // 10 seconds
const TICK_INTERVAL = 1000; // 1 second

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, '../data');

// --- Seed data ---

export interface MockSeed {
  programs: Record<number, Program>;
  audios: AudioFile[];
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
}

interface SSEClient {
  res: ServerResponse;
  cancelHeartbeat: () => void;
}

export function createMockServer(options: MockServerOptions = {}): MockServer {
  const clock = options.clock ?? realClock;
  const requestedPort = options.port ?? 0;
  const { programs, audios } = options.seed ?? loadSeedFromDisk();

  const state: ServerState = {
    loadedProgram: null,
    programState: null,
    targetStatus: 'hidden',
    adminModePassword: null,
    adminModeTokens: new Set<string>(),
    seriesStartTime: null,
  };

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
      state.programState.tickerSeconds = null;
      state.seriesStartTime = null;

      broadcastState();
      return;
    }

    const location = locateEvent(series, elapsedMs);
    if (!location) return;

    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const changed =
      state.programState.currentEventIndex !== location.index || state.programState.tickerSeconds !== elapsedSeconds;

    if (changed) {
      state.programState.tickerSeconds = elapsedSeconds;
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
        tickerSeconds: null,
      };
      state.seriesStartTime = null;

      broadcastState();
      jsonResponse(res, 200, { message: 'Program loaded' });
      return;
    }

    // POST /programs/start - Requires auth
    if (endpoint === '/programs/start' && req.method === 'POST') {
      if (!checkAdminAuth(req, res)) return;
      if (!state.loadedProgram || !state.programState) {
        jsonResponse(res, 400, { error: 'No program loaded' });
        return;
      }

      const { currentSeriesIndex } = state.programState;
      if (currentSeriesIndex === null) {
        jsonResponse(res, 400, { error: 'Invalid program state' });
        return;
      }

      // Resume from where a pause left the ticker, otherwise from the top.
      const resumeFromMs = (state.programState.tickerSeconds ?? 0) * 1000;
      state.programState.running = true;
      state.seriesStartTime = clock.now() - resumeFromMs;
      state.programState.tickerSeconds = Math.floor(resumeFromMs / 1000);

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

      // Pause: keep current position and tickerSeconds
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
      state.programState.tickerSeconds = null;
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
      state.programState.tickerSeconds = null;
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
      // Just acknowledge playback (no state change needed)
      jsonResponse(res, 200, { message: 'Playback started', audioId: id });
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
      state.loadedProgram = null;
      state.programState = null;
      state.targetStatus = 'hidden';
      state.adminModePassword = null;
      state.adminModeTokens.clear();
      state.seriesStartTime = null;
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
