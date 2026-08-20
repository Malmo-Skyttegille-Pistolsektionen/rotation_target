/**
 * Dev-server adapter for the v2 mock API.
 *
 * The mock itself lives in `test/mock-server/` so tests can drive it with a
 * fake clock; this file only mounts it on the Vite dev server with real
 * timers. See that module for what the mock actually implements.
 */
import type { Plugin, ViteDevServer } from 'vite';
import { createMockServer } from '../test/mock-server/server';

export function mockServerV2Plugin(): Plugin {
  return {
    name: 'mock-server-v2',
    configureServer(server: ViteDevServer) {
      const mock = createMockServer();

      server.middlewares.use((req, res, next) => mock.middleware(req, res, next));
      server.httpServer?.on('close', () => void mock.close());
    },
  };
}
