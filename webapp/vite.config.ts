import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import fs from 'fs';
import { resolve } from 'path';
import { mockServerPlugin } from './vite-plugins/mock-server';
import { mockServerV2Plugin } from './vite-plugins/mock-server-v2';
import { schemaSyncPlugin } from './vite-plugins/schema-sync';

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
const version = packageJson.version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    host: 'localhost',
    port: 8080,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        legacy: resolve(__dirname, 'legacy.html'),
      },
    },
  },
  plugins: [
    schemaSyncPlugin(),
    tanstackRouter(),
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
    mockServerPlugin(),
    mockServerV2Plugin(),
  ],
});
