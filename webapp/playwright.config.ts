import { defineConfig, devices } from '@playwright/test';

/**
 * The suite drives the real firmware, not a mock: `e2e/run-local.sh` builds
 * this webapp, bakes `dist` into the LittleFS image via `RT_WEBAPP_DIR`, boots
 * that image in QEMU and points the browser at the forwarded guest port. There
 * is exactly one device and its state persists between tests, which is what
 * the worker and retry settings below are about.
 */
export default defineConfig({
  testDir: './e2e',
  // One emulated device, one client. Parallel workers would race each other's
  // program state and the control lock.
  workers: 1,
  fullyParallel: false,
  // `.only` left in a spec would silently shrink the suite in CI.
  forbidOnly: !!process.env.CI,
  retries: 1,
  // The HTML report is what the workflow uploads when a run fails.
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  // Every spec resets the device before it runs, so a retry starts from a known
  // state rather than from whatever the failed attempt left behind.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.RT_E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'on-first-retry',
    // The device is on a LAN-ish origin with no TLS; nothing here needs a
    // service worker or a persisted profile.
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
