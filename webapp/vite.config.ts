import { defineConfig } from 'vite';
import fs from 'fs';
import type { ServerResponse } from 'http';
import { SERVER_API_URL, SERVER_SSE_URL } from './src/config.js';

const program_1_data = JSON.parse(fs.readFileSync('./test/data/program_1.json', 'utf-8'));
const { version } = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

// Shared ProgramState
type ProgramState = {
  running_series: boolean;
  program_id: number | null;
  current_series_index: number | null;
  current_event_index: number | null;
  target_status_shown: boolean | null;
};

const currentState: ProgramState = {
  running_series: false,
  program_id: null,
  current_series_index: null,
  current_event_index: null,
  target_status_shown: null
};

// SSE Clients
const clients: ServerResponse[] = [];

// Emit SSE events
const emit = (event: string, data: object) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(payload));
};

const simulateSeriesEvents = () => {
  if (!currentState.running_series || currentState.program_id === null || currentState.current_series_index === null) {
    console.warn('Simulation aborted: Invalid program state', currentState);
    return;
  }

  const series = program_1_data.series[currentState.current_series_index];
  if (!series || !series.events) {
    // Check if there are more series
    if (currentState.current_series_index !== null && currentState.current_series_index + 1 < program_1_data.series.length) {
      currentState.current_series_index += 1; // Move to the next series
      currentState.current_event_index = 0; // Reset event index
      currentState.running_series = false; // Stop running until explicitly started
      emit('series_next', { program_id: currentState.program_id, series_index: currentState.current_series_index });
      return;
    }

    // If no more series, complete the program
    emit('program_completed', { program_id: currentState.program_id });
    currentState.running_series = false;
    currentState.program_id = null;
    currentState.current_series_index = null;
    currentState.current_event_index = null;
    return;
  }

  const events = series.events;

  // Start simulation from the current event index
  const simulateEvent = (eventIndex: number) => {
    if (eventIndex >= events.length) {
      // All events in the series are completed
      emit('series_completed', { program_id: currentState.program_id, series_index: currentState.current_series_index });

      // Check if there are more series
      if (currentState.current_series_index !== null && currentState.current_series_index + 1 < program_1_data.series.length) {
        currentState.current_series_index += 1; // Move to the next series
        currentState.current_event_index = 0; // Reset event index
        currentState.running_series = false; // Stop running until explicitly started
        emit('series_next', { program_id: currentState.program_id, series_index: currentState.current_series_index });
        return;
      }

      // If no more series, complete the program
      emit('program_completed', { program_id: currentState.program_id });
      currentState.running_series = false;
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
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(currentState));
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
            currentState.running_series = false;
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
            currentState.running_series = true;
            emit('program_started', { program_id: currentState.program_id });
            emit('series_started', { program_id: currentState.program_id, series_index: currentState.current_series_index });

            // Simulate series events
            simulateSeriesEvents();

            res.writeHead(200);
            res.end();
            return;
          }

          if (strippedPathname === '/programs/stop' && req.method === 'POST') {
            if (!currentState.running_series) {
              res.writeHead(400);
              res.end('No program running');
              return;
            }
            currentState.running_series = false;
            emit('program_completed', { program_id: currentState.program_id });
            res.writeHead(200);
            res.end();
            return;
          }


          // Handle /api/v1/programs/series/{series_index}/skip_to POST
          const seriesSkipMatch = strippedPathname.match(/^\/api\/v1\/programs\/series\/(\d+)\/skip_to$/);
          if (seriesSkipMatch && req.method === 'POST') {
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
          const audioDeleteMatch = strippedPathname.match(/^\/api\/v1\/audios\/(\d+)\/delete$/);
          if (audioDeleteMatch && req.method === 'POST') {
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