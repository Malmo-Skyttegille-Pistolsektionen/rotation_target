import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN_PASSWORD, enableAdminViaUi, openApp, resetDevice, TEST_PROGRAM } from './device';

test.beforeEach(async ({ request }) => {
  await resetDevice(request);
});

/** The field timeline's cursor, as a percentage of the series duration. */
async function readCursorPercent(page: Page): Promise<number | null> {
  const cursor = page.getByTestId('timeline-cursor');
  if ((await cursor.count()) === 0) {
    return null;
  }
  const left = await cursor.evaluate((el) => (el as HTMLElement).style.left);
  const percent = Number(left.replace(/%$/, ''));
  return Number.isFinite(percent) ? percent : null;
}

/** `null` until the first `stateUpdate` carrying a ticker arrives. */
async function readTicker(page: Page): Promise<number | null> {
  const ticker = page.getByTestId('run-ticker');
  if ((await ticker.count()) === 0) {
    return null;
  }
  const text = await ticker.textContent();
  const seconds = Number(text?.replace(/s$/, ''));
  return Number.isFinite(seconds) ? seconds : null;
}

test('load, start, watch the timeline advance off real SSE, stop', async ({ page }, testInfo) => {
  await openApp(page);
  await enableAdminViaUi(page);
  await page.getByRole('link', { name: 'Run' }).click();

  // --- load ------------------------------------------------------------
  await page.getByTestId('run-program-select').selectOption(String(TEST_PROGRAM.id));

  // Not optimistic UI: `loadedProgramId` only exists in the `stateUpdate`
  // payload, so this asserting means the POST reached the device and the
  // device pushed its new state back down the stream.
  await expect(page.getByTestId('run-program-id')).toHaveText(String(TEST_PROGRAM.id));
  await expect(page.getByTestId('run-target-status')).toHaveText('hidden');
  // The timeline renders once the loaded program has been fetched back: four
  // series for program 40, the first of them named by the shipped JSON.
  await expect(page.getByTestId('timeline-series')).toHaveCount(4);
  await expect(page.getByTestId('timeline').getByText('Series 1 (show=4, hide=3)')).toBeVisible();

  // --- start -----------------------------------------------------------
  // Start opens the countdown modal (settings default: 10 s). "Start Now" is
  // the same POST without the wait.
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Starting in...')).toBeVisible();
  await page.getByRole('button', { name: 'Start Now' }).click();

  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  // --- the ticker really advances, once a second, off the device --------
  // Sampled rather than asserted once: a single "it changed" would also pass
  // against a client-side timer. This records the whole sequence the firmware
  // published, and the report carries it.
  const samples: { ticker: number | null; targets: string | null; cursorPercent: number | null }[] = [];
  const deadline = Date.now() + 20_000;
  let sawShown = false;
  while (Date.now() < deadline) {
    const ticker = await readTicker(page);
    const targets = await page.getByTestId('run-target-status').textContent();
    const cursorPercent = await readCursorPercent(page);
    const last = samples[samples.length - 1];
    if (!last || last.ticker !== ticker || last.targets !== targets) {
      samples.push({ ticker, targets, cursorPercent });
    }
    if (targets === 'shown') {
      sawShown = true;
      break;
    }
    await page.waitForTimeout(250);
  }

  await testInfo.attach('sse-samples', {
    body: JSON.stringify(samples, null, 2),
    contentType: 'application/json',
  });
  console.log('SSE-driven samples:', JSON.stringify(samples));

  const tickerValues = samples.map((s) => s.ticker).filter((t): t is number => t !== null);
  // The device publishes tickerMs: 0 with `running: true`, so the run
  // starts from the beginning rather than from wherever the last one stopped.
  expect(tickerValues[0]).toBeLessThanOrEqual(1);
  // Strictly increasing - not oscillating, not repeated, not a stale replay.
  for (let i = 1; i < tickerValues.length; i++) {
    expect(tickerValues[i]).toBeGreaterThan(tickerValues[i - 1]);
  }
  // Five seconds of the device's own clock, five distinct published values.
  expect(tickerValues.length).toBeGreaterThanOrEqual(5);
  expect(tickerValues[tickerValues.length - 1] - tickerValues[0]).toBeGreaterThanOrEqual(5);

  // The timeline cursor is positioned from the same tickerSeconds, so it moves
  // with it: this is the "timeline advances" claim, asserted on the DOM.
  const cursors = samples.map((s) => s.cursorPercent).filter((c): c is number => c !== null);
  expect(cursors.length).toBeGreaterThanOrEqual(5);
  for (let i = 1; i < cursors.length; i++) {
    expect(cursors[i]).toBeGreaterThan(cursors[i - 1]);
  }

  // Series 1 of program 40 is `hide` for 7 s and then `show`. The transition
  // landing on that second is the executor's scheduling, observed end to end.
  expect(sawShown, 'targets never came up within 20 s of starting').toBeTruthy();
  const shownAt = samples.find((s) => s.targets === 'shown')?.ticker;
  expect(shownAt).not.toBeNull();
  expect(shownAt).toBeGreaterThanOrEqual(TEST_PROGRAM.firstShowAtSeconds - 1);
  expect(shownAt).toBeLessThanOrEqual(TEST_PROGRAM.firstShowAtSeconds + 1);

  // --- stop ------------------------------------------------------------
  await page.getByRole('button', { name: 'Pause' }).click();

  // `running: false` in the next stateUpdate is what puts Start back.
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();

  // And it has genuinely stopped: the ticker is frozen, not merely re-labelled.
  const frozen = await readTicker(page);
  await page.waitForTimeout(3_000);
  expect(await readTicker(page)).toBe(frozen);
});

/**
 * Issue #70: `POST /programs/start` carries no program id, so a start decided
 * before a start delay runs whatever the device holds when the delay expires.
 * A second client switching the program in that window used to mean the range
 * got a program nobody had chosen.
 */
test('a program switch during the start delay cancels the start', async ({ page, request }) => {
  const OTHER_PROGRAM_ID = 1;
  const START_DELAY_SECONDS = 5;

  // The settings page writes this key; setting it here keeps the test's fixed
  // wait short without giving up the delay the scenario needs.
  await page.addInitScript((seconds: number) => {
    localStorage.setItem('rt_settings_start_delay_seconds', String(seconds));
  }, START_DELAY_SECONDS);

  await openApp(page);
  await enableAdminViaUi(page);
  await page.getByRole('link', { name: 'Run' }).click();

  await page.getByTestId('run-program-select').selectOption(String(TEST_PROGRAM.id));
  await expect(page.getByTestId('run-program-id')).toHaveText(String(TEST_PROGRAM.id));

  // Another client on the range - a second tab, somebody's phone. Its session
  // is opened before the countdown starts, so only the load itself has to fit
  // inside the delay.
  const session = await request.post('/api/v2/admin-mode/login', { data: { password: ADMIN_PASSWORD } });
  expect(session.ok(), `could not log in as a second client: ${session.status()}`).toBeTruthy();
  const { token } = (await session.json()) as { token: string };

  // The delay means the modal is up and the start still pending while the
  // rest of this runs.
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Starting in...')).toBeVisible();

  // It loads a different program. The device publishes it and this page follows.
  const load = await request.post(`/api/v2/programs/${OTHER_PROGRAM_ID}/load`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(load.ok(), `the second client could not load a program: ${load.status()}`).toBeTruthy();

  await expect(page.getByTestId('run-program-id')).toHaveText(String(OTHER_PROGRAM_ID));
  await expect(page.getByText('Starting in...')).toBeHidden();
  await expect(page.getByTestId('run-start-notice')).toContainText('cancelled');

  // Well past the moment the countdown would have expired: the device never
  // started anything. `run-ticker` only renders once a stateUpdate carries a
  // ticker, which a run is the only thing that produces.
  await page.waitForTimeout((START_DELAY_SECONDS + 2) * 1000);
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await expect(page.getByTestId('run-ticker')).toHaveCount(0);
});

test('backend_issue is not covered here', () => {
  // The only producers of `backend_issue` are the audio and storage paths
  // (main/io/audio.cpp). QEMU emulates no I2S, so `RT_AUDIO_ENABLED` is off in
  // the simulator profile and the event cannot be provoked from outside the
  // device. Covered by the firmware host tests and by the webapp unit tests
  // against the mock instead.
  test.skip(true, 'needs audio hardware to trigger - not emulated by QEMU');
});
