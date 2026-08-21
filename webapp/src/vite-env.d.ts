/// <reference types="vite/client" />

/**
 * The release tag this bundle was built at, substituted by Vite's `define` at
 * build time (see `vite.config.ts`). Read it through `src/appVersion.ts` rather
 * than directly - a `define` is a literal substitution, so a module boundary is
 * what makes it mockable in a test.
 */
declare const __APP_VERSION__: string;

declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}
