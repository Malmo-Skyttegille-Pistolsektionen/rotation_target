import type { APIRequestContext, APIResponse, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Helpers for driving the one shared device the suite runs against.
 *
 * State on the emulator survives between tests exactly as it does on the board
 * - there is no fresh fixture to hand out - so every spec calls `resetDevice`
 * in a `beforeAll` and leaves the device in the same state it wants to find.
 */

/** The password every spec turns the control lock on with. See `resetDevice`. */
export const CONTROL_LOCK_PASSWORD = 'e2e-secret';

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
 * Assert an RFC 9457 problem detail, media type included (D-19).
 *
 * `title` and `status` are fixed per `type` by `rt::ProblemType`
 * (`firmware/lib/rt_logic/problem.h`), so they are asserted too: this is the
 * only place the whole vocabulary meets the real firmware, and it is what
 * proves `test/mock-server/server.ts` is imitating rather than inventing.
 */
export async function expectProblem(
  response: APIResponse,
  expected: { type: string; title: string; status: number; detail?: string },
): Promise<void> {
  expect(response.status()).toBe(expected.status);
  expect(response.headers()['content-type']).toBe('application/problem+json');
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.type).toBe(expected.type);
  expect(body.title).toBe(expected.title);
  expect(body.status).toBe(expected.status);
  expect(typeof body.detail).toBe('string');
  if (expected.detail !== undefined) expect(body.detail).toBe(expected.detail);
  // D-19: no request ids on this device, so no `instance`.
  expect(body).not.toHaveProperty('instance');
}

/**
 * Put the device back to: control lock off, nothing running, nothing loaded.
 *
 * The control lock can only be turned off by whoever is holding it, and the suite
 * is the only thing that ever turns it on - always with `CONTROL_LOCK_PASSWORD` - so
 * `enable` (or `login`, when it is already on) always gets us a usable token.
 */
export async function resetDevice(request: APIRequestContext): Promise<void> {
  const enable = await request.post(`${API}/control-lock/enable`, {
    data: { password: CONTROL_LOCK_PASSWORD },
  });

  // 409: the lock was already on, from an earlier spec or a failed run.
  const session =
    enable.status() === 409
      ? await request.post(`${API}/control-lock/login`, { data: { password: CONTROL_LOCK_PASSWORD } })
      : enable;
  expect(session.ok(), `could not obtain a control lock session: ${session.status()}`).toBeTruthy();

  const { token } = (await session.json()) as { token: string };
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  // stop before reset: reset on a running program is rejected by the UI and
  // pointless on the device. Unload last of the three, because it is the one
  // that is refused while a run is in progress (D-22) - and it is what makes
  // "nothing loaded" above true rather than aspirational.
  await request.post(`${API}/programs/stop`, auth);
  await request.post(`${API}/programs/reset`, auth);
  const unload = await request.post(`${API}/programs/unload`, auth);
  expect(unload.ok(), `could not unload: ${unload.status()}`).toBeTruthy();

  const disable = await request.post(`${API}/control-lock/disable`, auth);
  expect(disable.ok(), `could not turn the control lock off: ${disable.status()}`).toBeTruthy();
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
export async function enableControlLockViaUi(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('control-lock-status')).toHaveText('OFF');
  await page.getByTestId('control-lock-password').fill(CONTROL_LOCK_PASSWORD);
  await page.getByRole('button', { name: 'Turn the lock on' }).click();
  await expect(page.getByTestId('control-lock-status')).toHaveText('ON ✓');
}
