import { test, expect } from '@playwright/test';
import { expectProblem, openApp, resetDevice } from './device';

/**
 * Listing only. QEMU emulates no I2S, so `POST /audios/{id}/play` would be
 * accepted and then silent, and there is nothing a browser could observe —
 * playback is covered on real hardware, by ear. Uploads are left out for the
 * same reason plus a second one: they write to the LittleFS image the whole
 * suite shares.
 */
test.beforeEach(async ({ request }) => {
  await resetDevice(request);
});

test('the library is the clips the LittleFS image carries, all shipped', async ({ page, request }) => {
  const { audios } = (await (await request.get('/api/v2/audios')).json()) as {
    audios: { id: number; title: string; readonly: boolean }[];
  };
  expect(audios.length).toBeGreaterThan(0);
  // Nothing is uploaded on a freshly flashed image.
  expect(audios.every((clip) => clip.readonly)).toBe(true);

  await openApp(page);
  await page.getByRole('link', { name: 'Audios' }).click();
  await expect(page).toHaveURL(/\/audios$/);

  const first = audios.reduce((lowest, clip) => (clip.id < lowest.id ? clip : lowest));
  await expect(page.getByTestId(`audios-row-${first.id}`)).toContainText(first.title);
  await expect(page.getByTestId(`audios-source-${first.id}`)).toHaveText('Shipped');

  await expect(page.locator('[data-testid^="audios-row-"]')).toHaveCount(audios.length);

  // Admin mode is off after `resetDevice`, so the rows are in their
  // controllable state: a Play button on every one, and - because a shipped
  // clip is refused a delete outright (D-23) - a Delete button on none.
  // Asserting only the second would also pass on a view-only render, where
  // nothing is offered.
  await expect(page.locator('[data-testid^="audios-play-"]')).toHaveCount(audios.length);
  await expect(page.getByTestId('audios-view-only')).toHaveCount(0);
  await expect(page.locator('[data-testid^="audios-delete-"]')).toHaveCount(0);
});

test('a shipped clip is refused a delete, not hidden behind a 404 (D-23)', async ({ request }) => {
  // The distinction the UI needs and a mock cannot settle: 409 means the clip
  // is there and the write is refused for a reason that never lifts, so a
  // client can say so instead of offering a refresh. 404 is left meaning it is
  // not there.
  const { audios } = (await (await request.get('/api/v2/audios')).json()) as {
    audios: { id: number; readonly: boolean }[];
  };
  const shipped = audios.find((clip) => clip.readonly)!;

  const refused = await request.delete(`/api/v2/audios/${shipped.id}/delete`);
  await expectProblem(refused, {
    type: '/problems/audio_readonly',
    title: 'Audio is read-only',
    status: 409,
    detail: 'Audio is read-only and cannot be deleted',
  });

  // Refused, not removed.
  const after = (await (await request.get('/api/v2/audios')).json()) as { audios: { id: number }[] };
  expect(after.audios.map((clip) => clip.id)).toContain(shipped.id);

  expect((await request.delete('/api/v2/audios/9999/delete')).status()).toBe(404);
});
