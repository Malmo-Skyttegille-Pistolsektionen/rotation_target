import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { resolveVersion } from './vite-plugins/resolve-version';

/**
 * The GitHub Pages build of `editor.html` (#140) - a separate config, not an
 * extra entry on `vite.config.ts`, so the two builds share nothing at the
 * bundle level:
 *
 * - **`vite.config.ts`'s output is what `webapp/dist` staged into the
 *   firmware image, and the whole point of a second build is that this one
 *   never lands there.** A second `rollupOptions.input` on the same config
 *   would put `editor.html` and its chunks in `dist` too, growing exactly the
 *   bundle `size-budget` exists to bound - for a page the device never serves.
 * - **`base` differs.** The device serves the app from `/`; GitHub Pages
 *   serves this repo's site from `/rotation_target/`, so the editor needs
 *   `/rotation_target/editor/` here to resolve its own assets.
 * - No `tanstackRouter()` plugin: `editor-main.tsx` builds its router by hand
 *   (see the comment there) rather than from file-based routes, and no
 *   `mockServerV2Plugin()`: there is no device to mock against.
 *
 * `npm run build` (device) and `npm run build:pages-editor` (this) are
 * otherwise both just `ProgramEditor` - see `src/components/ProgramEditor.tsx`.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/rotation_target/editor/',
  define: {
    __APP_VERSION__: JSON.stringify(resolveVersion()),
  },
  build: {
    outDir: 'dist-editor',
    rollupOptions: {
      input: fileURLToPath(new URL('./editor.html', import.meta.url)),
    },
  },
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
});
