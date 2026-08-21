import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { expectProblem, openApp, resetDevice, SHIPPED_PROGRAM_IDS } from './device';

/**
 * The two things about program storage that only the real firmware can settle.
 *
 * Both are places where a mock is free to be plausible and wrong, and where
 * being wrong is invisible until a club member hits it: which id an upload gets
 * when there are gaps in the range, and what happens to a `command` the
 * firmware does not recognise.
 */

const API = '/api/v2';

function documentWith(title: string, command?: string): Record<string, unknown> {
  return {
    title,
    description: 'e2e',
    readonly: false,
    series: [{ name: 'Serie 1', optional: false, events: [{ duration: 1000, ...(command ? { command } : {}) }] }],
  };
}

async function upload(request: APIRequestContext, title: string, command?: string): Promise<number> {
  const res = await request.post(`${API}/programs`, { data: documentWith(title, command) });
  expect(res.status(), `upload of "${title}" was refused`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

/** Everything this spec uploaded, whatever order the assertions left it in. */
async function removeUploads(request: APIRequestContext): Promise<void> {
  const programs = (await (await request.get(`${API}/programs`)).json()) as { id: number; readonly: boolean }[];
  for (const program of programs) {
    if (!program.readonly && !SHIPPED_PROGRAM_IDS.includes(program.id)) {
      await request.delete(`${API}/programs/${program.id}/delete`);
    }
  }
}

test.beforeEach(async ({ request }) => {
  await resetDevice(request);
  await removeUploads(request);
});

// Per test, not once at the end: the device is shared with every other spec,
// and `load.spec.ts` asserts the program list is exactly the shipped seven.
test.afterEach(async ({ request }) => {
  await removeUploads(request);
});

test('an upload through the UI lands on the id the device chose', async ({ page, request }) => {
  await openApp(page);
  await page.getByRole('link', { name: 'Programs' }).click();
  await expect(page.getByTestId('programs-table')).toBeVisible();

  await page.getByTestId('programs-file-input').setInputFiles({
    name: 'e2e-upload.json',
    mimeType: 'application/json',
    // The id in the document is ignored; 9999 makes that visible if it is not.
    buffer: Buffer.from(JSON.stringify({ ...documentWith('E2E Upload'), id: 9999 })),
  });

  // 100 and 101 are shipped, so the first free id from 100 up is 102.
  await expect(page.getByTestId('programs-notice')).toContainText('as program 102');
  await expect(page.getByTestId('program-row-102')).toContainText('E2E Upload');
  await expect(page.getByTestId('program-row-102')).toContainText('Uploaded');
  await expect(page.getByTestId('program-row-9999')).toHaveCount(0);

  const stored = (await (await request.get(`${API}/programs/102`)).json()) as { id: number; readonly: boolean };
  expect(stored).toMatchObject({ id: 102, readonly: false });
});

test('a freed id is handed back out, not stepped past', async ({ request }) => {
  expect(await upload(request, 'Gap A')).toBe(102);
  expect(await upload(request, 'Gap B')).toBe(103);
  expect(await upload(request, 'Gap C')).toBe(104);

  expect((await request.delete(`${API}/programs/103/delete`)).status()).toBe(200);

  // Highest-in-use + 1 would answer 105 here. The device scans up from 100.
  expect(await upload(request, 'Gap D')).toBe(103);
});

test('a command the firmware does not recognise is refused, on upload and on replace', async ({ request }) => {
  // Not kept and not dropped: only "show" and "hide" are commands, and a typo
  // such as "shwo" has to fail at upload rather than become a target that
  // silently never turns mid-exercise.
  const refused = await request.post(`${API}/programs`, { data: documentWith('Odd command', 'sideways') });
  expect(refused.status()).toBe(400);

  // Nothing was stored, so the id it would have taken is still free.
  const id = await upload(request, 'Good command', 'show');
  expect(id).toBe(102);

  // And a replace is refused the same way, leaving the stored program alone.
  const put = await request.put(`${API}/programs/${id}`, { data: documentWith('Odd command', 'diagonally') });
  expect(put.status()).toBe(400);

  const stored = (await (await request.get(`${API}/programs/${id}`)).json()) as {
    title: string;
    series: { events: { command?: string }[] }[];
  };
  expect(stored.title).toBe('Good command');
  expect(stored.series[0].events[0].command).toBe('show');
});

test('a shipped program is refused a delete, not hidden behind a 404 (D-23)', async ({ request }) => {
  // 409 and 404 mean two different things now: refused because it is shipped,
  // and not there. The Programs tab needs exactly that distinction to choose
  // between "offer upload-as-new" and "refresh the list".
  const refused = await request.delete(`${API}/programs/40/delete`);
  await expectProblem(refused, {
    type: '/problems/program_readonly',
    title: 'Program is read-only',
    status: 409,
    detail: 'Program is read-only and cannot be deleted',
  });

  // Refused, not removed: it is still listed and still served in full.
  expect((await request.get(`${API}/programs/40`)).status()).toBe(200);

  expect((await request.delete(`${API}/programs/9999/delete`)).status()).toBe(404);
});

test('an upload by another client reaches an open page over SSE (D-24)', async ({ page, request }) => {
  // The two-devices-at-the-range case: a laptop uploads, and the phone already
  // showing the list has to find out. Before `libraryChanged` the phone kept
  // its list until somebody reloaded it.
  await openApp(page);
  await page.getByRole('link', { name: 'Programs' }).click();
  await expect(page.getByTestId('programs-table')).toBeVisible();
  await expect(page.getByTestId('program-row-102')).toHaveCount(0);

  const id = await upload(request, 'From the other client');
  expect(id).toBe(102);

  // No reload, no navigation, no polling: the device said the library changed
  // and this page re-read the list.
  await expect(page.getByTestId('program-row-102')).toContainText('From the other client');

  // ...and the same in reverse when it goes away.
  expect((await request.delete(`${API}/programs/${id}/delete`)).status()).toBe(200);
  await expect(page.getByTestId('program-row-102')).toHaveCount(0);
});

/**
 * The editor, against the real thing: a program typed into the browser, parsed
 * by the firmware, stored on flash and loaded back for a run.
 *
 * The mock can only agree with the app about what a document means. This is
 * the one that settles it — `rt::parse_program` reads what the editor wrote,
 * and `loadedProgramId` comes back over SSE from the device's own run state.
 */
test('a program authored in the editor is stored and loaded by the device', async ({ page, request }) => {
  await openApp(page);
  await page.getByRole('link', { name: 'Programs' }).click();
  await expect(page.getByTestId('programs-table')).toBeVisible();

  await page.getByTestId('programs-new').click();
  await page.getByTestId('editor-title').fill('E2E Editor');
  await page.getByTestId('editor-description').fill('authored in the browser');
  await page.getByTestId('editor-series-0-name').fill('Serie 1');
  await page.getByTestId('editor-event-0-0-duration').fill('1000');
  await page.getByTestId('editor-event-0-0-command-hide').check();

  await page.getByTestId('editor-series-0-add-event').click();
  await page.getByTestId('editor-event-0-1-duration').fill('2000');
  await page.getByTestId('editor-event-0-1-command-show').check();

  await page.getByTestId('editor-save').click();

  // 100 and 101 are shipped, so the first free id from 100 up is 102.
  await expect(page.getByTestId('programs-notice')).toContainText('as program 102');

  const stored = (await (await request.get(`${API}/programs/102`)).json()) as Record<string, unknown>;
  expect(stored).toMatchObject({
    id: 102,
    title: 'E2E Editor',
    description: 'authored in the browser',
    readonly: false,
    series: [
      {
        name: 'Serie 1',
        optional: false,
        events: [
          { duration: 1000, command: 'hide' },
          { duration: 2000, command: 'show' },
        ],
      },
    ],
  });

  // Loadable, which is the part a stored-but-unparseable document would fail:
  // the badge is driven by `loadedProgramId` arriving over SSE from the device.
  await page.getByTestId('program-load-102').click();
  await expect(page.getByTestId('program-row-102')).toContainText('Loaded');
});
