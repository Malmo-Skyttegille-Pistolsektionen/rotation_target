import { defineConfig } from 'vite';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  plugins: [
    {
      name: 'mock-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url || '', 'http://localhost');

          if (url.pathname === '/api/programs' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              programs: {
                "1": "10 seconds",
                "2": "8 seconds",
                "3": "6 seconds"
              }
            }));
            return;
          }

          if (url.pathname === '/api/target/turn' && req.method === 'POST') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'target turned' }));
            return;
          }

          if (url.pathname === '/api/programs/start' && req.method === 'POST') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: `program ${url.searchParams.get('id')} started` }));
            return;
          }

          if (url.pathname === '/api/programs/stop' && req.method === 'POST') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: `program ${url.searchParams.get('id')} stopped` }));
            return;
          }

          next();
        });
      }
    }
  ]
});