import { defineConfig } from 'vite';
import fs from 'fs';
import type { ServerResponse } from 'http';
import { SERVER_API_URL, SERVER_SSE_URL, SERVER_BASE_URL } from './src/config.js';

// Extract hostname and port
const url = new URL(SERVER_BASE_URL);
const SERVER_HOSTNAME = url.hostname; // "localhost"
const SERVER_PORT = parseInt(url.port, 10);


const program_1_data = JSON.parse(fs.readFileSync('./test/data/program_1.json', 'utf-8'));
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

// Emit chrono SSE every second
setInterval(() => {
  if (currentState.running_series_start && currentState.program_id !== null && currentState.current_series_index !== null) {
    const elapsedTime = Date.now() - currentState.running_series_start.getTime(); // Calculate elapsed time in milliseconds
    const series = program_1_data.series[currentState.current_series_index];
    const totalTime = series.events.reduce((sum, event) => sum + event.duration * 1000, 0); // Total duration in milliseconds
    const remainingTime = Math.max(totalTime - elapsedTime, 0); // Remaining time in milliseconds

    emit('chrono', {
      elapsed: elapsedTime,
      remaining: remainingTime,
      total: totalTime,
    });
  }
}, 1000);

const simulateSeriesEvents = () => {
  if (!currentState.running_series_start || currentState.program_id === null || currentState.current_series_index === null) {
    console.warn('Simulation aborted: Invalid program state', currentState);
    return; // Abort simulation if the series is not running
  }

  const series = program_1_data.series[currentState.current_series_index];
  if (!series || !series.events) {
    // Check if there are more series
    if (currentState.current_series_index !== null && currentState.current_series_index + 1 < program_1_data.series.length) {
      currentState.current_series_index += 1; // Move to the next series
      currentState.current_event_index = 0; // Reset event index
      currentState.running_series_start = null; // Stop running until explicitly started
      emit('series_next', { program_id: currentState.program_id, series_index: currentState.current_series_index });
      return;
    }

    // If no more series, complete the program
    emit('program_completed', { program_id: currentState.program_id });
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
      return; // Abort simulation if the series is not running
    }

    if (eventIndex >= events.length) {
      // All events in the series are completed
      emit('series_completed', { program_id: currentState.program_id, series_index: currentState.current_series_index });

      // Check if there are more series
      if (currentState.current_series_index !== null && currentState.current_series_index + 1 < program_1_data.series.length) {
        currentState.current_series_index += 1; // Move to the next series
        currentState.current_event_index = 0; // Reset event index
        currentState.running_series_start = null; // Stop running until explicitly started
        emit('series_next', { program_id: currentState.program_id, series_index: currentState.current_series_index });
        return;
      }

      // If no more series, complete the program
      emit('program_completed', { program_id: currentState.program_id });
      currentState.running_series_start = null;
      currentState.program_id = null;
      currentState.current_series_index = null;
      currentState.current_event_index = null;
      return;
    }

    // Update current_event_index
    currentState.current_event_index = eventIndex;

    // Check for command in the event and update target_status_shown
    const event = events[eventIndex];
    if (event.command === 'show') {
      currentState.target_status_shown = true;
      emit('target_status', { status: "shown" });
    } else if (event.command === 'hide') {
      currentState.target_status_shown = false;
      emit('target_status', { status: "hidden" });
    }

    // Emit event_started
    emit('event_started', {
      program_id: currentState.program_id,
      series_index: currentState.current_series_index,
      event_index: eventIndex
    });

    // Simulate event completion after 2 seconds
    setTimeout(() => {
      if (!currentState.running_series_start) {
        console.warn('Simulation aborted: Series skipped or stopped');
        return; // Abort simulation if the series is not running
      }

      emit('event_completed', {
        program_id: currentState.program_id,
        series_index: currentState.current_series_index,
        event_index: eventIndex
      });

      // Move to the next event
      simulateEvent(eventIndex + 1);
    }, 2000);
  };

  // Start with the current event index
  simulateEvent(currentState.current_event_index || 0); // Default to 0 if current_event_index is null
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },

  server: {
    host: SERVER_HOSTNAME,
    port: SERVER_PORT,
  },
  plugins: [

    {
      name: 'mock-rest',
      configureServer(server) {
        let uploadedAudios = [
          { id: 101, title: 'start.mp3' }
        ];
        let builtinAudios = [
          { id: 1, title: 'beep.mp3' },
          { id: 2, title: 'voice_ready.mp3' }
        ];
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url || '', SERVER_API_URL);
          const strippedPathname = url.pathname.replace(new URL(SERVER_API_URL).pathname, '');


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
            emit('target_status_changed', { target_status_shown: true });
            res.writeHead(200);
            res.end(JSON.stringify({ message: "Target is now shown" }));
            return;
          }

          if (strippedPathname === '/targets/hide' && req.method === 'POST') {
            currentState.target_status_shown = false;
            emit('target_status_changed', { target_status_shown: false });
            res.writeHead(200);
            res.end(JSON.stringify({ message: "Target is now hidden" }));
            return;
          }

          if (strippedPathname === '/targets/toggle' && req.method === 'POST') {
            currentState.target_status_shown = !currentState.target_status_shown;
            emit('target_status_changed', { target_status_shown: currentState.target_status_shown });
            res.writeHead(200);
            res.end(JSON.stringify({ message: `Target is now ${currentState.target_status_shown ? 'shown' : 'hidden'}` }));
            return;
          }

          // Programs endpoints
          if (strippedPathname === '/programs' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([
              { id: 1, title: program_1_data.title, description: program_1_data.description }
            ]));
            return;
          }

          if (strippedPathname === '/programs/1' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(program_1_data));
            return;
          }

          if (strippedPathname === '/programs/1/load' && req.method === 'POST') {
            currentState.program_id = 1;
            currentState.running_series_start = null;
            currentState.current_series_index = 0;
            currentState.current_event_index = 0;
            emit('program_loaded', { program_id: 1 });
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
            emit('program_started', { program_id: currentState.program_id });
            emit('series_started', { program_id: currentState.program_id, series_index: currentState.current_series_index });

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
            emit('series_stopped', {
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

              if (isNaN(series_index) || series_index < 0 || series_index >= program_1_data.series.length) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid series index' }));
                return;
              }

              currentState.current_series_index = series_index;
              currentState.current_event_index = 0;
              emit('series_next', { program_id: currentState.program_id, series_index });
              res.writeHead(200);
              res.end(JSON.stringify({ message: `Skipped to series ${series_index}` }));
              return;
            }
          }

          // Audios endpoints
          if (strippedPathname === '/audios' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ builtin: builtinAudios, uploaded: uploadedAudios }));
            return;
          }

          if (strippedPathname === '/audios/upload' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const { title, codec } = JSON.parse(body);
                const newId = Math.max(...uploadedAudios.map(a => a.id), 100) + 1;
                const newAudio = { id: newId, title };
                uploadedAudios.push(newAudio);
                emit('audio_added', newAudio);
                res.writeHead(201);
                res.end(JSON.stringify(newAudio));
              } catch (err) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid request' }));
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

              const audioIndex = uploadedAudios.findIndex(audio => audio.id === audio_id);
              if (audioIndex === -1) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Audio not found' }));
                return;
              }

              const deletedAudio = uploadedAudios.splice(audioIndex, 1)[0];
              emit('audio_deleted', { id: deletedAudio.id });
              res.writeHead(200);
              res.end(JSON.stringify({ message: 'Audio deleted successfully', id: deletedAudio.id }));
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