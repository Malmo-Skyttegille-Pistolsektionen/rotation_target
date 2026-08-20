import { test, expect } from '@playwright/test';
import { openApp, resetDevice, SHIPPED_PROGRAM_IDS } from './device';

test.beforeEach(async ({ request }) => {
  await resetDevice(request);
});

test('the app is served out of the LittleFS image, pre-compressed', async ({ page }) => {
  // Recorded before the navigation so the module script's response is caught.
  const bundle = page.waitForResponse((r) => /\/assets\/main-.*\.js$/.test(new URL(r.url()).pathname));

  const index = await page.goto('/');
  expect(index?.status()).toBe(200);

  // `/` is index.html and the router takes it to /run from there. It has to be
  // `/` and not a deep link: the firmware serves the bundle with a plain static
  // handler and no SPA fallback, so GET /run is a 404 out of LittleFS.
  await expect(page).toHaveURL(/\/run$/);
  await expect(page.getByRole('heading', { name: 'Run Program' })).toBeVisible();

  // The firmware build gzips the text assets and ships only the `.gz`
  // (firmware/CMakeLists.txt); the static handler serves them with this header.
  // A Vite dev server would not be answering here at all - this is the byte
  // stream the board hands a phone.
  const headers = await (await bundle).allHeaders();
  expect(headers['content-encoding']).toBe('gzip');
});

test('a deep link is a 404 - the bundle has no SPA fallback', async ({ request }) => {
  // Pinning the known limitation rather than papering over it: if a rewrite is
  // ever added to `register_static_routes`, this test is where it surfaces.
  const deepLink = await request.get('/run');
  expect(deepLink.status()).toBe(404);
});

test('the program list is the seven shipped programs', async ({ page, request }) => {
  const fromApi = (await (await request.get('/api/v2/programs')).json()) as { id: number; title: string }[];
  expect(fromApi.map((p) => p.id).sort((a, b) => a - b)).toEqual(SHIPPED_PROGRAM_IDS);

  await openApp(page);

  const select = page.getByTestId('run-program-select');
  // The first option is the disabled "Choose program" placeholder.
  await expect(select.locator('option')).toHaveCount(fromApi.length + 1);

  const values = await select
    .locator('option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ''));
  expect(values.map(Number).sort((a, b) => a - b)).toEqual(SHIPPED_PROGRAM_IDS);

  for (const program of fromApi) {
    await expect(select.locator(`option[value="${program.id}"]`)).toContainText(program.title);
  }
});
