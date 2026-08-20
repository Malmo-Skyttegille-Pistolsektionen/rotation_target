/**
 * Deliberately separate from `vite.config.ts`: the app config mounts the mock
 * API and the router codegen plugin on every dev server it creates, and unit
 * tests want neither. Tests that need the mock construct it themselves, with a
 * fake clock.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    // Node by default; the React/DOM suites opt in per file with
    // `@vitest-environment happy-dom`.
    environment: 'node',
    // Process CSS modules only, and unhashed, so a test can assert on
    // `styles.active` by its source name. Plain CSS stays stubbed out.
    css: { include: [/\.module\.css$/], modules: { classNameStrategy: 'non-scoped' } },
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
