/**
 * The release tag this bundle was built at.
 *
 * `__APP_VERSION__` is a Vite `define`, so it is substituted literally into
 * every file that names it. Naming it in exactly one place keeps the substituted
 * text out of the rest of the app and gives tests something they can mock.
 *
 * The string is raw `git describe` output, the same value
 * `GET /api/v2/diagnostics/info` reports for the firmware - `2.0.0` at a tag,
 * `2.0.0-3-g09a3691` past one, `2.0.0-dirty` from a modified tree, a bare commit
 * hash when no release tag is reachable, and `unknown` when there is no git at
 * all (the word the firmware uses for the same case, so the two still agree).
 */
export const APP_VERSION: string = __APP_VERSION__;
