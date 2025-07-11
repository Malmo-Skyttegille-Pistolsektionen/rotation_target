import { defineConfig } from 'vite';
import fs, { read } from 'fs';
import type { ServerResponse } from 'http';
import { EventType } from './src/sse-client.js';

// Mock server URLs
const SERVER_BASE_URL = "http://localhost:8080";
const SERVER_API_URL = `${SERVER_BASE_URL}/api/v1`;
const SERVER_SSE_URL = `${SERVER_BASE_URL}/sse/v1`;

const programs: Record<number, any> = {
  1: JSON.parse(fs.readFileSync('./test/data/1.json', 'utf-8')),
  2: JSON.parse(fs.readFileSync('./test/data/2.json', 'utf-8')),
  40: JSON.parse(fs.readFileSync('./test/data/40.json', 'utf-8')),
};
const { version } = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

// Shared ProgramState
type ProgramState = {
  running_series_start: Date | null; // Timestamp when the series started, or null if not running
  program_id: number | null;
  current_series_index: number | null;
  current_event_index: number | null;
  target_status_shown: boolean | null;
};

const currentState: ProgramState = {
  running_series_start: null, // Initially not running
  program_id: null,
  current_series_index: null,
  current_event_index: null,
  target_status_shown: null,
};

// SSE Clients
const clients: ServerResponse[] = [];

// Emit SSE events
const emit = (event: string, data: object) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(payload));
};

function getCurrentProgramData() {
  if (currentState.program_id == null) return null;
  return programs[currentState.program_id] || null;
}

// Emit chrono SSE every second
setInterval(() => {
  if (
    currentState.running_series_start &&
    currentState.program_id !== null &&
    currentState.current_series_index !== null
  ) {
    const programData = getCurrentProgramData();
    if (!programData) return;

    const series = programData.series[currentState.current_series_index];
    if (!series || !series.events) return;

    const elapsedTime = Date.now() - currentState.running_series_start.getTime(); // ms
    const totalTime = series.events.reduce((sum, event) => sum + event.duration, 0); // ms
    const remainingTime = Math.max(totalTime - elapsedTime, 0); // ms

    emit(EventType.Chrono, {
      elapsed: elapsedTime,
      remaining: remainingTime,
      total: totalTime,
    });
  }
}, 1000);

const simulateSeriesEvents = () => {
  if (
    !currentState.running_series_start ||
    currentState.program_id === null ||
    currentState.current_series_index === null
  ) {
    console.warn('Simulation aborted: Invalid program state', currentState);
    return;
  }

  const programData = programs[currentState.program_id];
  if (!programData) {
    console.warn('Simulation aborted: Program not found', currentState.program_id);
    return;
  }

  const series = programData.series[currentState.current_series_index];
  if (!series || !series.events) {
    // Check if there are more series
    if (
      currentState.current_series_index !== null &&
      currentState.current_series_index + 1 < programData.series.length
    ) {
      currentState.current_series_index += 1;
      currentState.current_event_index = 0;
      currentState.running_series_start = null;
      emit(EventType.SeriesNext, { program_id: currentState.program_id, series_index: currentState.current_series_index });
      return;
    }

    // If no more series, complete the program
    emit(EventType.ProgramCompleted, { program_id: currentState.program_id });
    currentState.running_series_start = null;
    currentState.program_id = null;
    currentState.current_series_index = null;
    currentState.current_event_index = null;
    return;
  }

  const events = series.events;

  // Start simulation from the current event index
  const simulateEvent = (eventIndex: number) => {
    if (!currentState.running_series_start) {
      console.warn('Simulation aborted: Series skipped or stopped');
      return;
    }

    if (eventIndex >= events.length) {
      emit(EventType.SeriesCompleted, { program_id: currentState.program_id, series_index: currentState.current_series_index });

      // Check if there are more series
      if (
        currentState.current_series_index !== null &&
        currentState.current_series_index + 1 < programData.series.length
      ) {
        currentState.current_series_index += 1;
        currentState.current_event_index = 0;
        currentState.running_series_start = null;
        emit(EventType.SeriesNext, { program_id: currentState.program_id, series_index: currentState.current_series_index });
        return;
      }

      emit(EventType.ProgramCompleted, { program_id: currentState.program_id });
      currentState.running_series_start = null;
      currentState.program_id = null;
      currentState.current_series_index = null;
      currentState.current_event_index = null;
      return;
    }

    currentState.current_event_index = eventIndex;

    const event = events[eventIndex];
    if (event.command === 'show') {
      currentState.target_status_shown = true;
      emit(EventType.TargetStatus, { status: "shown" });
    } else if (event.command === 'hide') {
      currentState.target_status_shown = false;
      emit(EventType.TargetStatus, { status: "hidden" });
    }

    emit(EventType.EventStarted, {
      program_id: currentState.program_id,
      series_index: currentState.current_series_index,
      event_index: eventIndex
    });

    setTimeout(() => {
      if (!currentState.running_series_start) {
        console.warn('Simulation aborted: Series skipped or stopped');
        return;
      }

      emit(EventType.EventCompleted, {
        program_id: currentState.program_id,
        series_index: currentState.current_series_index,
        event_index: eventIndex
      });

      simulateEvent(eventIndex + 1);
    }, event.duration); // <-- Use event.duration here!
  };

  simulateEvent(currentState.current_event_index || 0);
};

// function logRequests(server: PreviewServer | ViteDevServer) {
//   server.middlewares.use((req, _, next) => {
//     console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
//     next();
//   });
// }

// --- Admin mode state ---
let adminModeToken: string | null = null;
const ADMIN_PASSWORD = "admin"; // Change as needed

function isAdminModeEnabled(): boolean {
  return typeof adminModeToken === "string";
}

function requireAdminAuth(req: any, res: any): boolean {
  if (!isAdminModeEnabled()) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: "Admin mode not enabled" }));
    return false;
  }
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== adminModeToken) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: "Invalid or missing bearer token" }));
    return false;
  }
  return true;
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },

  server: {
    host: 'localhost',
    port: 8080,
  },
  plugins: [
    // {
    //   name: 'requestLogger',
    //   configurePreviewServer: logRequests, // log in preview mode
    //   configureServer: logRequests,        // log in development mode
    // },

    {
      name: 'mock-rest',
      configureServer(server) {
        let audios = [
          { id: 1, title: 'Beep', readonly: true },
          { id: 2, title: 'Färdiga', readonly: true },
          { id: 101, title: 'Custom', readonly: false },
        ];
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url || '', SERVER_API_URL);
          const strippedPathname = url.pathname.replace(new URL(SERVER_API_URL).pathname, '');

          // --- Admin mode endpoints ---

          // GET /admin-mode/status
          if (strippedPathname === '/admin-mode/status' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ enabled: isAdminModeEnabled() }));
            return;
          }

          // POST /admin-mode/enable
          if (strippedPathname === '/admin-mode/enable' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                if (typeof data.password === 'string' && data.password === ADMIN_PASSWORD) {
                  // Generate a simple random token for the session
                  adminModeToken = Math.random().toString(36).slice(2) + Date.now();
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ token: adminModeToken }));
                  emit(EventType.AdminModeStatus, { enabled: isAdminModeEnabled() }); // <-- simplified SSE emit
                  return;
                } else {
                  res.writeHead(401);
                  res.end(JSON.stringify({ error: "Unauthorized: Invalid password" }));
                }
              } catch (err) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "Invalid JSON" }));
              }
            });
            return;
          }

          // POST /admin-mode/disable
          if (strippedPathname === '/admin-mode/disable' && req.method === 'POST') {
            if (!requireAdminAuth(req, res)) return;
            adminModeToken = null;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ message: "Admin mode disabled" }));
            emit(EventType.AdminModeStatus, { enabled: isAdminModeEnabled() }); // <-- simplified SSE emit
            return;
          }

          // --- Require Bearer token for POST/PUT/DELETE if admin mode is enabled ---
          const protectedMethods = ['POST', 'PUT', 'DELETE'];

          const unprotectedPaths = [
            '/admin-mode/enable',
            '/admin-mode/status'
          ];
          if (
            isAdminModeEnabled() &&
            protectedMethods.includes(req.method ?? '') &&
            !unprotectedPaths.includes(strippedPathname)
          ) {
            if (!requireAdminAuth(req, res)) return;
          }

          // Status endpoint
          if (strippedPathname === '/status' && req.method === 'GET') {
            const statusResponse = {
              running: currentState.running_series_start !== null,
              next_event: currentState.running_series_start && currentState.current_series_index !== null && currentState.current_event_index !== null
                ? {
                  program_id: currentState.program_id,
                  series_index: currentState.current_series_index,
                  event_index: currentState.current_event_index + 1 // Next event index
                }
                : null,
              target_status: currentState.target_status_shown ? 'shown' : 'hidden'
            };

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(statusResponse));
            return;
          }

          // Targets endpoints
          if (strippedPathname === '/targets/show' && req.method === 'POST') {
            currentState.target_status_shown = true;
            emit(EventType.TargetStatusChanged, { target_status_shown: true });
            res.writeHead(200);
            res.end(JSON.stringify({ message: "Target is now shown" }));
            return;
          }

          if (strippedPathname === '/targets/hide' && req.method === 'POST') {
            currentState.target_status_shown = false;
            emit(EventType.TargetStatusChanged, { target_status_shown: false });
            res.writeHead(200);
            res.end(JSON.stringify({ message: "Target is now hidden" }));
            return;
          }

          if (strippedPathname === '/targets/toggle' && req.method === 'POST') {
            currentState.target_status_shown = !currentState.target_status_shown;
            emit(EventType.TargetStatusChanged, { target_status_shown: currentState.target_status_shown });
            res.writeHead(200);
            res.end(JSON.stringify({ message: `Target is now ${currentState.target_status_shown ? 'shown' : 'hidden'}` }));
            return;
          }

          // Programs endpoints
          if (strippedPathname === '/programs' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(
              Object.entries(programs).map(([id, data]) => ({
                id: Number(id),
                title: data.title,
                description: data.description,
                readonly: Number(id) === 1
              }))
            ));
            return;
          }

          const programIdMatch = strippedPathname.match(/^\/programs\/(\d+)$/);
          if (programIdMatch && req.method === 'GET') {
            const program_id = parseInt(programIdMatch[1], 10);
            if (!programs[program_id]) {
              res.writeHead(404);
              res.end(JSON.stringify({ error: 'Program not found' }));
              return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(programs[program_id]));
            return;
          }

          const programLoadMatch = strippedPathname.match(/^\/programs\/(\d+)\/load$/);
          if (programLoadMatch && req.method === 'POST') {
            const program_id = parseInt(programLoadMatch[1], 10);
            if (!programs[program_id]) {
              res.writeHead(404);
              res.end(JSON.stringify({ error: 'Program not found' }));
              return;
            }
            currentState.program_id = program_id;
            currentState.running_series_start = null;
            currentState.current_series_index = 0;
            currentState.current_event_index = 0;
            emit(EventType.ProgramLoaded, { program_id });
            res.writeHead(200);
            res.end();
            return;
          }

          if (strippedPathname === '/programs/start' && req.method === 'POST') {
            if (currentState.program_id == null) {
              res.writeHead(400);
              res.end('No program loaded');
              return;
            }
            currentState.running_series_start = new Date(); // Set the start time
            emit(EventType.ProgramStarted, { program_id: currentState.program_id });
            emit(EventType.SeriesStarted, { program_id: currentState.program_id, series_index: currentState.current_series_index });

            // Simulate series events
            simulateSeriesEvents();

            res.writeHead(200);
            res.end();
            return;
          }

          if (strippedPathname === '/programs/stop' && req.method === 'POST') {
            if (!currentState.running_series_start) {
              res.writeHead(400);
              res.end('No program running');
              return;
            }

            // Stop the series and reset the event index to the first event of the current series
            currentState.running_series_start = null; // Stop the series
            currentState.current_event_index = 0; // Reset to the first event of the current series
            emit(EventType.SeriesStopped, {
              program_id: currentState.program_id,
              series_index: currentState.current_series_index,
              event_index: currentState.current_event_index,
            });

            res.writeHead(200);
            res.end(JSON.stringify({ message: 'Series stopped and reset to the first event' }));
            return;
          }


          // Handle /api/v1/programs/series/{series_index}/skip_to POST
          if (strippedPathname.startsWith('/programs/series/') && strippedPathname.endsWith('/skip_to') && req.method === 'POST') {
            const seriesSkipMatch = strippedPathname.match(/^\/programs\/series\/(\d+)\/skip_to$/);
            if (seriesSkipMatch) {
              const series_index = parseInt(seriesSkipMatch[1], 10);

              const programData = currentState.program_id !== null ? programs[currentState.program_id] : null;
              if (
                isNaN(series_index) ||
                series_index < 0 ||
                !programData ||
                !Array.isArray(programData.series) ||
                series_index >= programData.series.length
              ) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid series index' }));
                return;
              }

              currentState.current_series_index = series_index;
              currentState.current_event_index = 0;
              emit(EventType.SeriesNext, { program_id: currentState.program_id, series_index });
              res.writeHead(200);
              res.end(JSON.stringify({ message: `Skipped to series ${series_index}` }));
              return;
            }
          }

          // Audios endpoints
          if (strippedPathname === '/audios' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ audios: audios }));
            return;
          }

          // Handle POST /audios (upload a new audio)
          if (strippedPathname === '/audios' && req.method === 'POST') {
            // Only handle multipart/form-data (basic boundary check)
            const contentType = req.headers['content-type'] || '';
            if (!contentType.startsWith('multipart/form-data')) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Content-Type must be multipart/form-data' }));
              return;
            }

            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              // Very basic multipart parsing for mock purposes only
              // Extract title and codec fields
              const titleMatch = body.match(/name="title"\r\n\r\n([^\r\n]*)/);
              const codecMatch = body.match(/name="codec"\r\n\r\n([^\r\n]*)/);
              const fileMatch = body.match(/name="file"; filename="([^"]+)"/);

              const title = titleMatch ? titleMatch[1] : '';
              const codecReceived = !!codecMatch;
              const fileReceived = !!fileMatch;

              if (fileReceived && title && codecReceived) {
                const newId = Math.max(...audios.map(a => a.id), 100) + 1;
                audios.push({ id: newId, title, readonly: false });
                emit(EventType.AudioUploaded, { id: newId, title });

                res.writeHead(201);
                res.end(JSON.stringify({ message: "Audio uploaded", id: newId }));
              } else {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid multipart form data' }));
              }
            });
            return;
          }

          // Handle /api/v1/audios/{id}/delete POST
          if (strippedPathname.startsWith('/audios/') && strippedPathname.endsWith('/delete') && req.method === 'DELETE') {
            const audioDeleteMatch = strippedPathname.match(/^\/audios\/(\d+)\/delete$/);
            if (audioDeleteMatch) {
              const audio_id = parseInt(audioDeleteMatch[1], 10);

              if (isNaN(audio_id)) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid ID' }));
                return;
              }

              const audioIndex = audios.findIndex(audio => audio.id === audio_id);
              if (audioIndex === -1) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Audio not found' }));
                return;
              }

              if (audios[audioIndex].readonly) {
                res.writeHead(403);
                res.end(JSON.stringify({ error: 'Cannot delete readonly audio' }));
                return;
              }

              const deletedAudio = audios.splice(audioIndex, 1)[0];
              emit(EventType.AudioDeleted, { id: deletedAudio.id });
              res.writeHead(200);
              res.end(JSON.stringify({ message: 'Audio deleted successfully', id: deletedAudio.id }));
              return;
            }
          }

          // Handle /api/v1/programs/{id}/delete DELETE
          if (strippedPathname.startsWith('/programs/') && strippedPathname.endsWith('/delete') && req.method === 'DELETE') {
            const programDeleteMatch = strippedPathname.match(/^\/programs\/(\d+)\/delete$/);
            if (programDeleteMatch) {
              const program_id = parseInt(programDeleteMatch[1], 10);

              if (isNaN(program_id)) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid ID' }));
                return;
              }

              // Only allow deleting custom (id !== 1) program in this mock
              if (program_id === 1) {
                res.writeHead(403);
                res.end(JSON.stringify({ error: 'Cannot delete readonly program' }));
                return;
              }

              // In a real implementation, you would remove from a list.
              // Here, just emit and return success for id !== 1.
              emit(EventType.ProgramDeleted, { id: program_id });
              res.writeHead(200);
              res.end(JSON.stringify({ message: 'Program deleted successfully', id: program_id }));
              return;
            }
          }

          // Mock POST /programs (upload a new program)
          if (strippedPathname === '/programs' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                if (
                  typeof data.title === 'string' &&
                  typeof data.description === 'string' &&
                  Array.isArray(data.series)
                ) {
                  // Simulate success (could add to a mock list if desired)
                  // Emit SSE event for program upload
                  emit(EventType.ProgramUploaded, { title: data.title, description: data.description });
                  res.writeHead(201);
                  res.end(JSON.stringify({ message: "Program uploaded" }));
                } else {
                  res.writeHead(400);
                  res.end(JSON.stringify({ error: "Invalid program structure" }));
                }
              } catch (err) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "Invalid JSON" }));
              }
            });
            return;
          }

          // --- Programs update endpoint ---
          if (strippedPathname.startsWith('/programs/') && strippedPathname.endsWith('/update') && req.method === 'PUT') {
            const programUpdateMatch = strippedPathname.match(/^\/programs\/(\d+)\/update$/);
            if (programUpdateMatch) {
              const program_id = parseInt(programUpdateMatch[1], 10);

              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', () => {
                try {
                  const data = JSON.parse(body);
                  // Simulate readonly check (id === 1 is readonly in this mock)
                  if (program_id === 1) {
                    res.writeHead(403);
                    res.end(JSON.stringify({ error: 'Program is readonly and cannot be updated' }));
                    emit(EventType.ProgramUpdated, { program_id, status: 'readonly' });
                    return;
                  }
                  // Validate structure (must be a complete program JSON)
                  if (
                    typeof data.title === 'string' &&
                    typeof data.description === 'string' &&
                    Array.isArray(data.series)
                  ) {
                    // Simulate update success
                    emit(EventType.ProgramUpdated, { program_id, status: 'success' });
                    res.writeHead(200);
                    res.end(JSON.stringify({ message: 'Program updated successfully', program_id }));
                  } else {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Invalid program structure' }));
                    emit(EventType.ProgramUpdated, { program_id, status: 'error' });
                  }
                } catch (err) {
                  res.writeHead(400);
                  res.end(JSON.stringify({ error: 'Invalid JSON' }));
                  emit(EventType.ProgramUpdated, { program_id, status: 'error' });
                }
              });
              return;
            }
          }

          // --- Audio playback endpoint ---
          if (strippedPathname.startsWith('/audios/') && strippedPathname.endsWith('/play') && req.method === 'POST') {
            const audioPlayMatch = strippedPathname.match(/^\/audios\/(\d+)\/play$/);
            if (audioPlayMatch) {
              const audio_id = parseInt(audioPlayMatch[1], 10);

              if (isNaN(audio_id)) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid ID' }));
                emit(EventType.AudioPlayback, { audio_id, status: 'error' });
                return;
              }

              const audio = audios.find(a => a.id === audio_id);
              if (!audio) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Audio not found' }));
                emit(EventType.AudioPlayback, { audio_id, status: 'error' });
                return;
              }

              // Simulate playback started
              emit(EventType.AudioPlayback, { audio_id, status: 'started' });
              res.writeHead(200);
              res.end(JSON.stringify({ message: 'Playback started successfully', audio_id }));

              // Simulate playback finished after 2 seconds
              setTimeout(() => {
                emit(EventType.AudioPlayback, { audio_id, status: 'finished' });
              }, 2000);
              return;
            }
          }

          next();
        });
      }
    },
    {
      name: 'mock-sse',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url || '', SERVER_SSE_URL);
          const SSE_PATHNAME = new URL(SERVER_SSE_URL).pathname;

          if (url.pathname === SSE_PATHNAME) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive'
            });
            res.write('\n');

            clients.push(res); // Handle SSE connection - add client to the list
            req.on('close', () => {
              const index = clients.indexOf(res);
              if (index !== -1) clients.splice(index, 1);
            });
            return;
          }

          next();
        });
      }
    }
  ]
});