import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { execFileSync } from 'child_process';
import { mockServerV2Plugin } from './vite-plugins/mock-server-v2';

/**
 * The bundle's version is the release tag and nothing else - the same
 * `git describe` invocation `firmware/CMakeLists.txt` runs, so the bundle and
 * the device it ships inside report byte-identical strings and a mismatch on
 * the Settings page is a real signal. See docs/RELEASING.md.
 *
 * `package.json`'s `version` is a `0.0.0` placeholder that exists only because
 * npm wants the field. It is never bumped and it is not read here.
 */
function resolveVersion(): string {
  try {
    const described = execFileSync(
      'git',
      ['describe', '--tags', '--match', '[0-9]*.[0-9]*.[0-9]*', '--always', '--dirty'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (described) return described;
  } catch {
    // Fall through: no git at all - a tarball, or a container without the
    // repository.
  }
  // What the device answers for a build with no release tag reachable, so it is
  // the honest stand-in rather than a number invented here.
  return '0.0.0';
}

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
