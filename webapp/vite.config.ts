import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import fs from 'fs';
import { mockServerV2Plugin } from './vite-plugins/mock-server-v2';

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
  plugins: [tanstackRouter(), react(), babel({ presets: [reactCompilerPreset()] }), mockServerV2Plugin()],
});
