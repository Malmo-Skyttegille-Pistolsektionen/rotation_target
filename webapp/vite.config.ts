import { defineConfig } from 'vite';
import fs from 'fs';
import type { ServerResponse } from 'http'; // add this import at the top

const program_1_data = JSON.parse(fs.readFileSync('./test/data/program_1.json', 'utf-8'));

export default defineConfig({
  plugins: [
    {
      name: 'mock-rest-sse',
      configureServer(server) {

        type ProgramState = {
          running: boolean;
          program_id: number | null;
          next_event: { series_index: number; event_index: number } | null;
        };

        let currentState: ProgramState = {
          running: false,
          program_id: null,
          next_event: null
        };

        const clients: ServerResponse[] = [];
        let uploadedAudios = [
          { id: 101, title: "start.mp3" }
        ];
        let builtinAudios = [
          { id: 1, title: "beep.mp3" },
          { id: 2, title: "voice_ready.mp3" }
        ];

        const emit = (event, data) => {
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
            return;
          }

          if (url.pathname === '/status') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(currentState));
            return;
          }

          if (url.pathname === '/programs' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([
              { "id": 1, "title": program_1_data.title, "description": program_1_data.description }
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
            currentState.next_event = { series_index: 0, event_index: 0 };
            emit("program_loaded", { id: 1 });
            res.end();
            return;
          }

          if (url.pathname === '/programs/start' && req.method === 'POST') {
            if (currentState.program_id == null) {
              res.writeHead(400);
              res.end("No program loaded");
              return;
            }
            currentState.running = true;
            currentState.next_event = { series_index: 0, event_index: 1 };
            emit("series_started", { series_index: 0, name: "Main" });
            emit("event_started", { series_index: 0, event_index: 0 });
            res.end();
            return;
          }

          if (url.pathname === '/programs/stop' && req.method === 'POST') {
            if (!currentState.running) {
              res.writeHead(400);
              res.end("No program running");
              return;
            }
            currentState.running = false;
            emit("series_completed", { series_index: 0, name: "Main" });
            res.end();
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
            emit("audio_uploaded", newAudio);
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
                  res.end("Audio not found");
                  return;
                }
                uploadedAudios.splice(index, 1);
                emit("audio_deleted", { id });
                res.writeHead(200);
                res.end();
              } catch {
                res.writeHead(400);
                res.end("Invalid request");
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
