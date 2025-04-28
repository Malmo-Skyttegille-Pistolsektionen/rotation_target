import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'fs';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
);

export default defineConfig({
  plugins: [
    preact(),
    viteSingleFile(),    
    {
      name: 'mock-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/programs' && req.method === 'GET') {
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
  build: {
    assetsInlineLimit: 100000000, // big number to force inline
  },  
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version)
  }
});
