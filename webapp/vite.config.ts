import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'fs';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
);

export default defineConfig({
  plugins: [
    preact(),
    {
      name: 'mock-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/programs' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              programs: ['10 seconds', '8 seconds', '6 seconds']
            }));
            return;
          }

          if (req.url === '/api/target/turn' && req.method === 'POST') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'target turned' }));
            return;
          }

          if (req.url?.startsWith('/api/programs/') && req.url.endsWith('/start') && req.method === 'POST') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'program started' }));
            return;
          }

          if (req.url?.startsWith('/api/programs/') && req.url.endsWith('/stop') && req.method === 'POST') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'program stopped' }));
            return;
          }

          next();
        });
      }
    }
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version)
  }
});
