import { execFileSync } from 'child_process';

/**
 * The bundle's version is the release tag and nothing else - the same
 * `git describe` invocation `firmware/CMakeLists.txt` runs. `vite.config.ts`
 * (the device build) and `vite.editor.config.ts` (the Pages build, #140)
 * both inject the result as `__APP_VERSION__`, so this lives once rather than
 * as two copies that can drift.
 *
 * `package.json`'s `version` is a `0.0.0` placeholder that exists only because
 * npm wants the field. It is never bumped and it is not read here.
 */
export function resolveVersion(): string {
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
  // The same word `firmware/CMakeLists.txt` puts in PROJECT_VER for a build with
  // no git metadata, so the app and the device still agree in the one case
  // neither can name a version. Deliberately not a number: `0.0.0` is valid
  // semver and would read as a real, very old release.
  return 'unknown';
}
