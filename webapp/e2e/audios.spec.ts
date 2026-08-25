import { test, expect } from '@playwright/test';
import { expectProblem, openApp, resetDevice } from './device';

/**
 * `POST /audios/{id}/play` is not covered here: QEMU emulates no I2S, so it
 * would be accepted and then silent, and there is nothing a browser could
 * observe - playback is covered on real hardware, by ear.
 */
test.beforeEach(async ({ request }) => {
  await resetDevice(request);
});

/** A PCM16 mono WAV with enough samples to be a plausible upload, no more. */
function minimalWav(dataBytes = 8): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24); // sample rate
  header.writeUInt32LE(32000, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes)]);
}

test('an upload through the UI reaches the device (#250)', async ({ page }) => {
  // #250: a standard multipart body was silently dropped before it ever
  // reached the file-writing path, and nothing exercised the real client
  // (the mock server never reproduced this - it is not multipart at all).
  // The regression this guards is the file arriving; getting a 201 back
  // needs a real DAC. QEMU sets CONFIG_RT_AUDIO_ENABLED=n, which stubs
  // `audio::probe_wav` to always refuse (firmware/main/io/audio.cpp) - so the
  // signal here is landing on that refusal instead of on "No file uploaded".
  // A real board accepts this exact clip and returns 201.
  await openApp(page);
  await page.getByRole('link', { name: 'Audios' }).click();
  await expect(page).toHaveURL(/\/audios$/);

  await page.getByTestId('audios-upload-file').setInputFiles({
    name: 'e2e-clip.wav',
    mimeType: 'audio/wav',
    buffer: minimalWav(),
  });
  await page.getByTestId('audios-upload-title').fill('E2E Clip');
  await page.getByTestId('audios-upload-submit').click();

  await expect(page.getByTestId('audios-feedback')).toContainText('Unsupported audio format');
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
