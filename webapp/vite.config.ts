import { defineConfig } from 'vite';
import fs from 'fs';
import type { ServerResponse } from 'http';

const program_1_data = JSON.parse(fs.readFileSync('./test/data/program_1.json', 'utf-8'));
const { version } = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },

  plugins: [
    {
      name: 'mock-rest-sse',
      configureServer(server) {

        type ProgramState = {
          running: boolean;
          program_id: number | null;
          current_series_index: number | null;
          current_event_index: number | null;
          target_status: 'shown' | 'hidden' | null;
        };

        let currentState: ProgramState = {
          running: false,
          program_id: null,
          current_series_index: null,
          current_event_index: null,
          target_status: null
        };

        const clients: ServerResponse[] = [];
        let uploadedAudios = [
          { id: 101, title: 'start.mp3' }
        ];
        let builtinAudios = [
          { id: 1, title: 'beep.mp3' },
          { id: 2, title: 'voice_ready.mp3' }
        ];

        const emit = (event: string, data: object) => {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          clients.forEach(res => res.write(payload));
        };

        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url || '', 'http://localhost');

          if (url.pathname === '/events') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive'
            });
            res.write('\n');
            clients.push(res);
            req.on('close', () => {
              const index = clients.indexOf(res);
              if (index !== -1) clients.splice(index, 1);
            });
            return;
          }

          if (url.pathname === '/status') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(currentState));
            return;
          }

          // Show target
          if (url.pathname === '/target/show' && req.method === 'POST') {
            currentState.target_status = "show";
            emit("target_status_changed", { target_status: "show" });
            res.writeHead(200);
            res.end(JSON.stringify({ message: "Target is now shown" }));
            return;
          }

          // Hide target
          if (url.pathname === '/target/hide' && req.method === 'POST') {
            currentState.target_status = "hide";
            emit("target_status_changed", { target_status: "hide" });
            res.writeHead(200);
            res.end(JSON.stringify({ message: "Target is now hidden" }));
            return;
          }

          // Toggle target
          if (url.pathname === '/target/toggle' && req.method === 'POST') {
            currentState.target_status = currentState.target_status === "show" ? "hide" : "show";
            emit("target_status_changed", { target_status: currentState.target_status });
            res.writeHead(200);
            res.end(JSON.stringify({ message: `Target is now ${currentState.target_status}` }));
            return;
          }
          if (url.pathname === '/programs' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([
              { id: 1, title: program_1_data.title, description: program_1_data.description }
            ]));
            return;
          }

          if (url.pathname === '/programs/1' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(program_1_data));
            return;
          }

          if (url.pathname === '/programs/1/load' && req.method === 'POST') {
            currentState.program_id = 1;
            currentState.running = false;
            currentState.current_series_index = 0;
            currentState.current_event_index = 0;
            emit('program_uploaded', { program_id: 1 });
            res.writeHead(200);
            res.end();
            return;
          }

          if (url.pathname === '/programs/start' && req.method === 'POST') {
            if (currentState.program_id == null) {
              res.writeHead(400);
              res.end('No program loaded');
              return;
            }
            currentState.running = true;
            emit('program_started', { program_id: currentState.program_id });
            emit('series_started', { program_id: currentState.program_id, series_index: currentState.current_series_index });
            emit('event_started', { program_id: currentState.program_id, series_index: currentState.current_series_index, event_index: currentState.current_event_index });
            res.writeHead(200);
            res.end();
            return;
          }

          if (url.pathname === '/programs/stop' && req.method === 'POST') {
            if (!currentState.running) {
              res.writeHead(400);
              res.end('No program running');
              return;
            }
            currentState.running = false;
            emit('program_completed', { program_id: currentState.program_id });
            res.writeHead(200);
            res.end();
            return;
          }

          if (url.pathname === '/programs/series/skip_to' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const { series_index } = JSON.parse(body);
                if (series_index == null || series_index < 0) {
                  res.writeHead(400);
                  res.end('Invalid series index');
                  return;
                }
                currentState.current_series_index = series_index;
                currentState.current_event_index = 0;
                emit('series_next', { program_id: currentState.program_id, series_index });
                res.writeHead(200);
                res.end();
              } catch {
                res.writeHead(400);
                res.end('Invalid request');
              }
            });
            return;
          }

          if (url.pathname === '/audios' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ builtin: builtinAudios, uploaded: uploadedAudios }));
            return;
          }

          if (url.pathname === '/audios/upload' && req.method === 'POST') {
            let newId = Math.max(...uploadedAudios.map(a => a.id), 100) + 1;
            const fakeTitle = `Uploaded ${newId}`;
            const newAudio = { id: newId, title: fakeTitle };
            uploadedAudios.push(newAudio);
            emit('audio_added', newAudio);
            res.writeHead(201);
            res.end();
            return;
          }

          if (url.pathname === '/audios/delete' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const { id } = JSON.parse(body);
                const index = uploadedAudios.findIndex(a => a.id === id);
                if (index === -1) {
                  res.writeHead(404);
                  res.end('Audio not found');
                  return;
                }
                uploadedAudios.splice(index, 1);
                emit('audio_deleted', { id });
                res.writeHead(200);
                res.end();
              } catch {
                res.writeHead(400);
                res.end('Invalid request');
              }
            });
            return;
          }

          next();
        });
      }
    }
  ]
});