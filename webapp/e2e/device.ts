import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Helpers for driving the one shared device the suite runs against.
 *
 * State on the emulator survives between tests exactly as it does on the board
 * - there is no fresh fixture to hand out - so every spec calls `resetDevice`
 * in a `beforeAll` and leaves the device in the same state it wants to find.
 */

/** The password every spec enables admin mode with. See `resetDevice`. */
export const ADMIN_PASSWORD = 'e2e-secret';

/**
 * Program 40 "Fältträning": the shortest shipped program, and the only one
 * whose first event boundary lands inside a test's patience. Series 1 is
 * `hide` for 7 s and then `show` for 4 s, so a start is observable as
 * `tickerSeconds` climbing from 0 and `targetStatus` flipping hidden -> shown
 * at t=7 s. Everything else ships a 5 s+ lead-in followed by minute-long
 * series.
 */
export const TEST_PROGRAM = {
  id: 40,
  title: 'Fältträning',
  /** Index of the first event that shows the targets, and when it starts. */
  firstShowAtSeconds: 7,
} as const;

/** The shipped LittleFS image carries exactly these, one JSON file each. */
export const SHIPPED_PROGRAM_IDS = [1, 2, 20, 40, 50, 100, 101];

const API = '/api/v2';

/**
 * Put the device back to: admin mode off, nothing running, nothing loaded.
 *
 * Admin mode can only be turned off by an authenticated admin, and the suite
 * is the only thing that ever turns it on - always with `ADMIN_PASSWORD` - so
 * `enable` (or `login`, when it is already on) always gets us a usable token.
 */
export async function resetDevice(request: APIRequestContext): Promise<void> {
  const enable = await request.post(`${API}/admin-mode/enable`, {
    data: { password: ADMIN_PASSWORD },
  });

  // 409: admin mode was already on, from an earlier spec or a failed run.
  const session =
    enable.status() === 409
      ? await request.post(`${API}/admin-mode/login`, { data: { password: ADMIN_PASSWORD } })
      : enable;
  expect(session.ok(), `could not obtain an admin session: ${session.status()}`).toBeTruthy();

  const { token } = (await session.json()) as { token: string };
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  // stop before reset: reset on a running program is rejected by the UI and
  // pointless on the device.
  await request.post(`${API}/programs/stop`, auth);
  await request.post(`${API}/programs/reset`, auth);

  const disable = await request.post(`${API}/admin-mode/disable`, auth);
  expect(disable.ok(), `could not disable admin mode: ${disable.status()}`).toBeTruthy();
}

/**
 * Open the app.
 *
 * Always at `/`: the firmware serves the bundle with a plain static handler
 * and no SPA fallback, so a deep link like `/run` is a 404 from LittleFS. `/`
 * returns `index.html`, which client-side redirects to `/run`.
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/run$/);
}

/** Walk the documented enable flow through the Settings UI. */
export async function enableAdminViaUi(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('admin-status')).toHaveText('OFF');
  await page.getByTestId('admin-password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Enable Admin Mode' }).click();
  await expect(page.getByTestId('admin-status')).toHaveText('ON ✓');
}
