import { test, expect } from '@playwright/test';
import { openApp } from './device';

/**
 * The webapp and the firmware are one artifact under one tag (D-29), and this
 * is the check that says so against the real thing: the bundle the browser is
 * running was baked into the LittleFS image of the firmware answering the API,
 * so the version it displays must be exactly the one the device reports.
 *
 * A failure here means the two `git describe` invocations - Vite's in
 * `vite.config.ts` and CMake's in `firmware/CMakeLists.txt` - disagreed at
 * build time, which is the one way a released image could ship a bundle
 * claiming a version the device does not have.
 */
test('the app reports the same version as the firmware it ships inside', async ({ page, request }) => {
  const info = await (await request.get('/api/v2/diagnostics/info')).json();
  expect(typeof info.version).toBe('string');

  await openApp(page);
  await page.getByRole('link', { name: 'Settings' }).click();

  await expect(page.getByTestId('version-app')).toHaveText(info.version);
  await expect(page.getByTestId('version-firmware')).toHaveText(info.version);
  await expect(page.getByTestId('version-mismatch')).toHaveCount(0);
});
