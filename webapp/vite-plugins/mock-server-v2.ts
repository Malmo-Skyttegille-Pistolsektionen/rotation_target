/**
 * Mock Server v2 - SSE-first architecture
 *
 * Key differences from v1:
 * - Single `stateUpdate` SSE event (no per-event SSE)
 * - camelCase payload fields
 * - `stop` pauses execution (keeps position), `reset` is explicit
 * - `tickerSeconds` = whole seconds elapsed in current SERIES (not event)
 * - `currentEventIndex` derived from tickerSeconds + cumulative durations
 * - Completely separate state from v1
 *
 * See docs/server-spec.md and docs/server-changelog.md for details.
 */
import type { Plugin, ViteDevServer } from 'vite';
import type { ServerResponse, IncomingMessage } from 'http';
import fs from 'fs';
import path from 'path';
import type { Program, StateUpdatePayload, ProgramState, AudioFile, ProgramSummary } from '../src/api/types';

// --- Constants ---
const API_PREFIX = '/api/v2';
const SSE_PATH = '/sse/v2';
const HEARTBEAT_INTERVAL = 10000; // 10 seconds
const TICK_INTERVAL = 1000; // 1 second

// --- Server State (completely separate from v1) ---
interface ServerState {
  loadedProgram: Program | null;
  programState: ProgramState | null;
  targetStatus: 'shown' | 'hidden';
  adminModePassword: string | null;
  adminModeTokens: Set<string>;
  // Internal execution state
  seriesStartTime: number | null; // timestamp when series started running
}

const state: ServerState = {
  loadedProgram: null,
  programState: null,
  targetStatus: 'hidden',
  adminModePassword: null,
  adminModeTokens: new Set<string>(),
  seriesStartTime: null,
};

// --- SSE Clients ---
interface SSEClient {
  res: ServerResponse;
  heartbeatTimer: NodeJS.Timeout;
}

const clients: SSEClient[] = [];

// --- Data Storage ---
let programs: Record<number, Program> = {};
let audios: AudioFile[] = [];

// --- Helpers ---

function loadData(): void {
  // Load programs
  const programsDir = path.resolve('./test/data/programs');
  const programFiles = fs.readdirSync(programsDir).filter((f) => /^\d+\.json$/.test(f));

  programs = {};
  for (const file of programFiles) {
    const id = parseInt(file.replace('.json', ''), 10);
    const data = JSON.parse(fs.readFileSync(path.join(programsDir, file), 'utf-8'));
    programs[id] = data;
  }

  // Add editable copies (id + 1000)
  const lastThree = programFiles.slice(-3);
  lastThree.forEach((file) => {
    const id = parseInt(file.replace('.json', ''), 10);
    const newId = id + 1000;
    const data = JSON.parse(fs.readFileSync(path.join(programsDir, file), 'utf-8'));
    programs[newId] = { ...data, id: newId, readonly: false };
  });

  // Load audios
  const audiosData = JSON.parse(fs.readFileSync('./test/data/audios/audios.json', 'utf-8'));
  audios = Object.entries(audiosData).map(([id, audio]: [string, unknown]) => ({
    id: Number(id),
    title: (audio as { title: string }).title,
    readonly: true,
  }));

  // Add editable copies
  const lastThreeAudios = Object.entries(audiosData).slice(-3);
  lastThreeAudios.forEach(([id, audio]: [string, unknown]) => {
    audios.push({
      id: Number(id) + 1000,
      title: (audio as { title: string }).title,
      readonly: false,
    });
  });
}

function getStateUpdatePayload(): StateUpdatePayload {
  return {
    loadedProgramId: state.loadedProgram?.id ?? null,
    programState: state.programState,
    targetStatus: state.targetStatus,
  };
}

function broadcastState(): void {
  const payload = getStateUpdatePayload();
  const message = `event: stateUpdate\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach(({ res }) => {
    res.write(message);
  });
}

function sendStateToClient(res: ServerResponse): void {
  const payload = getStateUpdatePayload();
  const message = `event: stateUpdate\ndata: ${JSON.stringify(payload)}\n\n`;
  res.write(message);
}

function isAdminEnabled(): boolean {
  return state.adminModePassword !== null;
}

function createAdminToken(): string {
  return Math.random().toString(36).slice(2) + Date.now();
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

  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Invalid or missing bearer token' }));
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

function getAdminModeAlreadyEnabledError(): { error: string } {
  return {
    error: 'Admin mode is already enabled. Log in or disable it before enabling again.',
  };
}

function getAdminModeNotEnabledError(): { error: string } {
  return {
    error: 'Admin mode is not enabled. Enable it before logging in.',
  };
}

function logSSE(msg: string): void {
  console.log(`[SSE v2] ${msg} (${clients.length} clients)`);
}

// --- Simulation Logic ---

/**
 * Get total duration of a series in milliseconds
 */
function getSeriesTotalDuration(seriesIndex: number): number {
  if (!state.loadedProgram) return 0;
  const series = state.loadedProgram.series[seriesIndex];
  if (!series) return 0;
  return series.events.reduce((sum, e) => sum + e.duration, 0);
}

/**
 * Derive current event index from tickerSeconds (ms elapsed in series).
 * Also returns the event and time offset within that event.
 */
function deriveEventFromElapsedMs(
  seriesIndex: number,
  elapsedMs: number,
): {
  eventIndex: number;
  event: { duration: number; command: 'show' | 'hide'; audioIds?: number[] };
  offsetMs: number;
} | null {
  if (!state.loadedProgram) return null;
  const series = state.loadedProgram.series[seriesIndex];
  if (!series || series.events.length === 0) return null;

  let cumulative = 0;
  for (let i = 0; i < series.events.length; i++) {
    const event = series.events[i];
    if (elapsedMs < cumulative + event.duration) {
      return { eventIndex: i, event, offsetMs: elapsedMs - cumulative };
    }
    cumulative += event.duration;
  }

  // Past end of series - return last event
  const lastIdx = series.events.length - 1;
  return { eventIndex: lastIdx, event: series.events[lastIdx], offsetMs: 0 };
}

function runSimulationTick(): void {
  if (!state.programState?.running || !state.seriesStartTime) return;

  const { currentSeriesIndex } = state.programState;
  if (currentSeriesIndex === null) return;

  const elapsedMs = Date.now() - state.seriesStartTime;
  const seriesTotalMs = getSeriesTotalDuration(currentSeriesIndex);

  if (elapsedMs >= seriesTotalMs) {
    // Series completed
    const nextSeriesIndex = currentSeriesIndex + 1;

    if (state.loadedProgram && nextSeriesIndex < state.loadedProgram.series.length) {
      // Move to next series, pause at boundary
      state.programState.currentSeriesIndex = nextSeriesIndex;
      state.programState.currentEventIndex = 0;
      state.programState.running = false;
      state.programState.tickerSeconds = null;
      state.seriesStartTime = null;
      state.targetStatus = 'hidden';
    } else {
      // Program completed
      state.programState.running = false;
      state.programState.tickerSeconds = null;
      state.seriesStartTime = null;
    }

    broadcastState();
    return;
  }

  // Derive current event from elapsed time
  const derived = deriveEventFromElapsedMs(currentSeriesIndex, elapsedMs);
  if (!derived) return;

  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const needsBroadcast =
    state.programState.currentEventIndex !== derived.eventIndex || state.programState.tickerSeconds !== elapsedSeconds;

  if (needsBroadcast) {
    state.programState.currentEventIndex = derived.eventIndex;
    state.programState.tickerSeconds = elapsedSeconds;
    state.targetStatus = derived.event.command === 'show' ? 'shown' : 'hidden';
    broadcastState();
  }
}

// --- Plugin Export ---

export function mockServerV2Plugin(): Plugin[] {
  let simulationTimer: NodeJS.Timeout | null = null;

  return [
    {
      name: 'mock-rest-v2',
      configureServer(server: ViteDevServer) {
        // Load data on server start
        loadData();

        // Start simulation ticker
        simulationTimer = setInterval(runSimulationTick, TICK_INTERVAL);

        // Cleanup on server close
        server.httpServer?.on('close', () => {
          if (simulationTimer) {
            clearInterval(simulationTimer);
          }
          clients.forEach(({ heartbeatTimer }) => clearInterval(heartbeatTimer));
        });

        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url || '', 'http://localhost');

          // Only handle /api/v2/* routes
          if (!url.pathname.startsWith(API_PREFIX)) {
            return next();
          }

          const path = url.pathname.slice(API_PREFIX.length);

          // --- Admin Mode Endpoints ---

          // GET /admin-mode/status
          if (path === '/admin-mode/status' && req.method === 'GET') {
            // Return admin mode status without requiring auth
            // All clients need to know if admin mode is enabled
            jsonResponse(res, 200, { enabled: isAdminEnabled() });
            return;
          }

          // POST /admin-mode/enable
          if (path === '/admin-mode/enable' && req.method === 'POST') {
            const body = await parseBody(req);

            if (isAdminEnabled()) {
              jsonResponse(res, 409, getAdminModeAlreadyEnabledError());
              return;
            }

            try {
              const data = JSON.parse(body);
              if (typeof data.password === 'string' && data.password.length > 0) {
                state.adminModePassword = data.password;
                const token = issueAdminSession(res);
                jsonResponse(res, 200, { token });
              } else {
                jsonResponse(res, 401, { error: 'Invalid password' });
              }
            } catch {
              jsonResponse(res, 400, { error: 'Invalid JSON' });
            }
            return;
          }

          // POST /admin-mode/login
          if (path === '/admin-mode/login' && req.method === 'POST') {
            const body = await parseBody(req);

            if (!isAdminEnabled()) {
              jsonResponse(res, 409, getAdminModeNotEnabledError());
              return;
            }

            try {
              const data = JSON.parse(body);
              if (typeof data.password === 'string' && data.password === state.adminModePassword) {
                const token = issueAdminSession(res);
                jsonResponse(res, 200, { token });
              } else {
                jsonResponse(res, 401, { error: 'Invalid password' });
              }
            } catch {
              jsonResponse(res, 400, { error: 'Invalid JSON' });
            }
            return;
          }

          // POST /admin-mode/disable
          if (path === '/admin-mode/disable' && req.method === 'POST') {
            if (!checkAdminAuth(req, res)) return;
            state.adminModePassword = null;
            state.adminModeTokens.clear();
            jsonResponse(res, 200, { message: 'Admin mode disabled' });
            return;
          }

          // --- Programs Endpoints ---

          // GET /programs - No auth required (read-only)
          if (path === '/programs' && req.method === 'GET') {
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
          const programGetMatch = path.match(/^\/programs\/(\d+)$/);
          if (programGetMatch && req.method === 'GET') {
            const id = parseInt(programGetMatch[1], 10);
            const program = programs[id];
            if (!program) {
              jsonResponse(res, 404, { error: 'Program not found' });
              return;
            }
            jsonResponse(res, 200, program);
            return;
          }

          // POST /programs/{id}/load - Requires auth
          const programLoadMatch = path.match(/^\/programs\/(\d+)\/load$/);
          if (programLoadMatch && req.method === 'POST') {
            if (!checkAdminAuth(req, res)) return;
            const id = parseInt(programLoadMatch[1], 10);
            const program = programs[id];
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
          if (path === '/programs/start' && req.method === 'POST') {
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

            // Resume from current tickerSeconds (ms) if paused, otherwise start from 0
            const resumeFromMs = (state.programState.tickerSeconds ?? 0) * 1000;
            state.programState.running = true;
            state.seriesStartTime = Date.now() - resumeFromMs;

            // Derive and apply current event
            const derived = deriveEventFromElapsedMs(currentSeriesIndex, resumeFromMs);
            if (derived) {
              state.programState.currentEventIndex = derived.eventIndex;
              state.programState.tickerSeconds = Math.floor(resumeFromMs / 1000);
              state.targetStatus = derived.event.command === 'show' ? 'shown' : 'hidden';
            }

            broadcastState();
            jsonResponse(res, 200, { message: 'Program started' });
            return;
          }

          // POST /programs/stop - Requires auth
          if (path === '/programs/stop' && req.method === 'POST') {
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
          if (path === '/programs/reset' && req.method === 'POST') {
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
          // skip_to index bounds: 0 <= idx < series.length, else 400
          const skipToMatch = path.match(/^\/programs\/series\/(\d+)\/skip_to$/);
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

          // POST /targets/show - Requires auth
          if (path === '/targets/show' && req.method === 'POST') {
            if (!checkAdminAuth(req, res)) return;
            state.targetStatus = 'shown';
            broadcastState();
            jsonResponse(res, 200, { message: 'Targets shown' });
            return;
          }

          // POST /targets/hide - Requires auth
          if (path === '/targets/hide' && req.method === 'POST') {
            if (!checkAdminAuth(req, res)) return;
            state.targetStatus = 'hidden';
            broadcastState();
            jsonResponse(res, 200, { message: 'Targets hidden' });
            return;
          }

          // POST /targets/toggle - Requires auth
          if (path === '/targets/toggle' && req.method === 'POST') {
            if (!checkAdminAuth(req, res)) return;
            state.targetStatus = state.targetStatus === 'shown' ? 'hidden' : 'shown';
            broadcastState();
            jsonResponse(res, 200, { message: `Targets ${state.targetStatus}` });
            return;
          }

          // --- Audios Endpoints ---

          // GET /audios
          if (path === '/audios' && req.method === 'GET') {
            jsonResponse(res, 200, { audios });
            return;
          }

          // POST /audios/{id}/play
          const audioPlayMatch = path.match(/^\/audios\/(\d+)\/play$/);
          // POST /audios/{id}/play - Requires auth
          if (audioPlayMatch && req.method === 'POST') {
            if (!checkAdminAuth(req, res)) return;
            const id = parseInt(audioPlayMatch[1], 10);
            const audio = audios.find((a) => a.id === id);
            if (!audio) {
              jsonResponse(res, 404, { error: 'Audio not found' });
              return;
            }
            // Just acknowledge playback (no state change needed)
            jsonResponse(res, 200, { message: 'Playback started', audioId: id });
            return;
          }

          // Fallthrough - endpoint not found
          jsonResponse(res, 404, { error: 'Endpoint not found' });
        });
      },
    },
    {
      name: 'mock-sse-v2',
      configureServer(server: ViteDevServer) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url || '', 'http://localhost');

          if (url.pathname !== SSE_PATH) {
            return next();
          }

          // SSE connection
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write('\n');

          const clientIp = req.socket.remoteAddress || 'unknown';
          const clientPort = req.socket.remotePort || 'unknown';

          // Send initial state immediately
          sendStateToClient(res);

          // Heartbeat
          let heartbeatId = 1;
          const heartbeatTimer = setInterval(() => {
            res.write(`event: heartbeat\ndata: ${JSON.stringify({ id: heartbeatId })}\n\n`);
            logSSE(`Heartbeat #${heartbeatId} to ${clientIp}:${clientPort}`);
            heartbeatId++;
          }, HEARTBEAT_INTERVAL);

          const client: SSEClient = { res, heartbeatTimer };
          clients.push(client);
          logSSE(`Client connected from ${clientIp}:${clientPort}`);

          req.on('close', () => {
            const idx = clients.indexOf(client);
            if (idx !== -1) {
              clearInterval(client.heartbeatTimer);
              clients.splice(idx, 1);
              logSSE(`Client disconnected from ${clientIp}:${clientPort}`);
            }
          });
        });
      },
    },
  ];
}
