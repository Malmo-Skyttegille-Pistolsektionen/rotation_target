import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CONTROL_LOCK_PASSWORD, enableControlLockViaUi, openApp, resetDevice } from './device';

const STALE_TOKEN_KEY = 'rt_settings_control_lock_token';

test.beforeEach(async ({ request }) => {
  await resetDevice(request);
});

test('enable, logout to view-only, log back in, disable', async ({ page, request }) => {
  await openApp(page);
  await enableControlLockViaUi(page);

  // The server is the source of truth, so the state machine is observable from
  // outside the browser too.
  expect(await (await request.get('/api/v2/control-lock/status')).json()).toEqual({ enabled: true });

  // Logging out drops this client's token only; the lock stays on for everyone.
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByTestId('control-lock-status')).toHaveText('ON 🔒');
  expect(await (await request.get('/api/v2/control-lock/status')).json()).toEqual({ enabled: true });

  // ...and the Run page hides the controls behind the view-only badge.
  await page.getByRole('link', { name: 'Run' }).click();
  await expect(page.getByTestId('run-view-only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle Targets' })).toHaveCount(0);
  await expect(page.getByTestId('run-program-select')).toHaveCount(0);

  // Log back in with the same password the enable set.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByTestId('control-lock-password').fill(CONTROL_LOCK_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByTestId('control-lock-status')).toHaveText('ON ✓');

  await page.getByRole('link', { name: 'Run' }).click();
  await expect(page.getByRole('button', { name: 'Toggle Targets' })).toBeVisible();

  // Disable puts the device back to full public access.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Turn the lock off' }).click();
  await expect(page.getByTestId('control-lock-status')).toHaveText('OFF');
  expect(await (await request.get('/api/v2/control-lock/status')).json()).toEqual({ enabled: false });
});

test('a wrong password is rejected and leaves the client view-only', async ({ page }) => {
  await openApp(page);
  await enableControlLockViaUi(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByTestId('control-lock-status')).toHaveText('ON 🔒');

  await page.getByTestId('control-lock-password').fill('not-the-password');
  await page.getByRole('button', { name: 'Log in' }).click();

  // The device's own message, surfaced by the API client's error extraction.
  await expect(page.getByText('Invalid password')).toBeVisible();
  await expect(page.getByTestId('control-lock-status')).toHaveText('ON 🔒');
});

test('a mutation with a stale control lock session fails into view-only, not a broken page', async ({ page }) => {
  await openApp(page);
  await enableControlLockViaUi(page);
  await page.getByRole('link', { name: 'Run' }).click();
  await expect(page.getByRole('button', { name: 'Toggle Targets' })).toBeVisible();

  const before = await targetStatus(page);

  // Impersonate a session the device no longer honours: the cookie goes, and
  // the remembered bearer token is replaced with one the device never issued.
  // The UI still believes it can control - the 401 is what corrects it.
  await page.context().clearCookies();
  await page.evaluate((key) => localStorage.setItem(key, 'stale-token-that-was-never-issued'), STALE_TOKEN_KEY);
  // A fresh load, not `page.reload()`: the URL is /run by then and the device
  // has no SPA fallback for it (see load.spec.ts).
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Toggle Targets' })).toBeVisible();

  await page.getByRole('button', { name: 'Toggle Targets' }).click();

  // Graceful: the 401 clears the token and the page falls back to view-only.
  // Not a blank screen, not an unhandled rejection, not a stuck spinner.
  await expect(page.getByTestId('run-view-only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle Targets' })).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), STALE_TOKEN_KEY)).toBeNull();

  // And the device did not act on the rejected request.
  expect(await targetStatus(page)).toBe(before);
});

async function targetStatus(page: Page): Promise<string | null> {
  return page.getByTestId('run-target-status').textContent();
}
