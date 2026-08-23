import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { mockServerV2Plugin } from './vite-plugins/mock-server-v2';
import { resolveVersion } from './vite-plugins/resolve-version';

// See vite-plugins/resolve-version.ts: the device and the bundle it ships
// with must report byte-identical version strings, so a mismatch on the
// Settings page is a real signal. See docs/RELEASING.md.
const version = resolveVersion();

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
