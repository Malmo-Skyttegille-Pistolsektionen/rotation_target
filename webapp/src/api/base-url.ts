/**
 * The origin the app was served from.
 *
 * Correct in both deployments, which is why it replaces the hardcoded
 * `http://localhost:8080`: on the device the app is served by the firmware
 * itself, and in development the Vite dev server listens on port 8080 and
 * hosts the mock API on that same origin (see `vite.config.ts`). The literal
 * was only ever a long-hand way of writing "where I came from", and it was
 * wrong everywhere except a dev machine — served from the device it made the
 * browser ask *itself* for `/api/v2`.
 *
 * A value stored on the settings page still overrides this, for serving the
 * app from somewhere other than the device.
 *
 * Kept in its own module rather than in `client.ts` to avoid an import cycle:
 * `client.ts` imports `useSettings`, so `SettingsContext` cannot import from
 * it — and `SettingsContext` needs this at module-initialisation time, which
 * is precisely when a cycle yields `undefined`.
 */
export const DEFAULT_BASE_URL =
  typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;
