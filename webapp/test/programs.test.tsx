// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18082" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SettingsProvider } from '../src/context/SettingsContext';
import type { Program } from '../src/api/types';
import { ProgramsView } from '../src/routes/programs';
import { PROGRAM_FALT_TRANING } from './fixtures';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { enableAdminElsewhere, requestElsewhere } from './other-client';

// Distinct per suite: vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake (18080 useAdminStatus, 18081 audios, 18082 here).
const PORT = 18082;

/** Shipped: read-only, no file behind it, so it can only be loaded. */
const SHIPPED: Program = { ...PROGRAM_FALT_TRANING, id: 40, readonly: true };
/** Uploaded: the row that gets the Replace and Delete buttons. */
const UPLOADED: Program = { ...PROGRAM_FALT_TRANING, id: 140, title: 'Klubbserie', readonly: false };

let server: MockServer;
let queryClient: QueryClient;

function renderPrograms(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <ProgramsView />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

/** The list has arrived and the admin status query has settled. */
async function ready(): Promise<void> {
  await screen.findByTestId('programs-table');
  await waitFor(() => expect(screen.getByTestId(`program-row-${UPLOADED.id}`)).toBeTruthy());
}

/** Drive the hidden file input the way the browser would after a pick. */
async function pickFile(contents: unknown, name = 'program.json'): Promise<void> {
  const text = typeof contents === 'string' ? contents : JSON.stringify(contents);
  const input = screen.getByTestId('programs-file-input');
  const file = new File([text], name, { type: 'application/json' });

  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

function notice(): HTMLElement {
  return screen.getByTestId('programs-notice');
}

/** What the device holds now, read as another client would. */
async function programsOnDevice(): Promise<{ id: number; title: string; readonly: boolean }[]> {
  const { body } = await requestElsewhere(PORT, 'GET', '/api/v2/programs');
  return JSON.parse(body);
}

beforeAll(async () => {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: { [SHIPPED.id]: SHIPPED, [UPLOADED.id]: UPLOADED }, audios: [] },
  });
  await server.listen();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  server.reset();
  localStorage.clear();
  document.cookie = 'admin=; Path=/; Max-Age=0';
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
});

describe('the list', () => {
  it('shows every program, lowest id first, marked shipped or uploaded', async () => {
    renderPrograms();
    await ready();

    const rows = within(screen.getByTestId('programs-table')).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual(['40', '140']);

    expect(within(rows[0]).getByText('Shipped')).toBeTruthy();
    expect(within(rows[1]).getByText('Uploaded')).toBeTruthy();
  });

  it('offers Replace and Delete only where there is a file behind the program', async () => {
    renderPrograms();
    await ready();

    // A shipped program has no writable file: the device refuses both a delete
    // and a replace with a 409 that never lifts, so neither button is offered.
    expect(screen.queryByTestId(`program-replace-${SHIPPED.id}`)).toBeNull();
    expect(screen.queryByTestId(`program-delete-${SHIPPED.id}`)).toBeNull();
    expect(screen.getByTestId(`program-load-${SHIPPED.id}`)).toBeTruthy();

    expect(screen.getByTestId(`program-replace-${UPLOADED.id}`)).toBeTruthy();
    expect(screen.getByTestId(`program-delete-${UPLOADED.id}`)).toBeTruthy();
  });

  it('opens the full document, with counts the summary does not carry', async () => {
    renderPrograms();
    await ready();

    fireEvent.click(screen.getByText(UPLOADED.title));

    const meta = await screen.findByTestId('program-details-meta');
    const events = UPLOADED.series.reduce((count, series) => count + series.events.length, 0);
    expect(meta.textContent).toContain(`${UPLOADED.series.length} series`);
    expect(meta.textContent).toContain(`${events} events`);
    expect(screen.getByTestId('timeline')).toBeTruthy();
  });
});

describe('admin gating', () => {
  it('hides every write while admin mode is on and this browser has no token', async () => {
    await enableAdminElsewhere(PORT, 'range-2026');

    renderPrograms();
    await ready();

    await screen.findByTestId('programs-view-only');
    expect(screen.queryByTestId('programs-upload')).toBeNull();
    expect(screen.queryByTestId(`program-load-${SHIPPED.id}`)).toBeNull();
    expect(screen.queryByTestId(`program-delete-${UPLOADED.id}`)).toBeNull();
  });

  it('restores them once this browser holds a token', async () => {
    localStorage.setItem('rt_settings_admin_token', await enableAdminElsewhere(PORT, 'range-2026'));

    renderPrograms();
    await ready();

    expect(screen.getByTestId('programs-upload')).toBeTruthy();
    expect(screen.getByTestId(`program-delete-${UPLOADED.id}`)).toBeTruthy();
    expect(screen.queryByTestId('programs-view-only')).toBeNull();
  });

  it('loads a program on the device, presenting the token', async () => {
    localStorage.setItem('rt_settings_admin_token', await enableAdminElsewhere(PORT, 'range-2026'));

    renderPrograms();
    await ready();
    fireEvent.click(screen.getByTestId(`program-load-${SHIPPED.id}`));

    await waitFor(() => expect(notice().textContent).toContain(`Loaded "${SHIPPED.title}"`));
  });
});

describe('deleting', () => {
  it('asks first, then removes the program from the device', async () => {
    renderPrograms();
    await ready();

    fireEvent.click(screen.getByTestId(`program-delete-${UPLOADED.id}`));
    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain(UPLOADED.title);

    fireEvent.click(within(dialog).getByText('Delete'));

    await waitFor(() => expect(notice().textContent).toContain(`Deleted "${UPLOADED.title}"`));
    await waitFor(() => expect(screen.queryByTestId(`program-row-${UPLOADED.id}`)).toBeNull());
    expect(await programsOnDevice()).toEqual([expect.objectContaining({ id: SHIPPED.id })]);
  });

  it('leaves the program alone when the dialog is cancelled', async () => {
    renderPrograms();
    await ready();

    fireEvent.click(screen.getByTestId(`program-delete-${UPLOADED.id}`));
    fireEvent.click(within(await screen.findByTestId('confirm-dialog')).getByText('Cancel'));

    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect((await programsOnDevice()).map((p) => p.id)).toEqual([SHIPPED.id, UPLOADED.id]);
  });
});

describe('unloading (D-22)', () => {
  /** Have the device load a program, and tell this page as `useSSE` would. */
  async function loadedOnDevice(id: number): Promise<void> {
    await requestElsewhere(PORT, 'POST', `/api/v2/programs/${id}/load`);
    await act(async () => {
      queryClient.setQueryData(['state'], { loadedProgramId: id, programState: null, targetStatus: 'hidden' });
    });
    // The badge is the page's own proof that it has taken the state in.
    await waitFor(() => expect(within(screen.getByTestId(`program-row-${id}`)).getByText('Loaded')).toBeTruthy());
  }

  it('is offered on the loaded row and nowhere else', async () => {
    renderPrograms();
    await ready();
    expect(screen.queryByTestId(`program-unload-${UPLOADED.id}`)).toBeNull();

    await loadedOnDevice(UPLOADED.id);

    expect(screen.getByTestId(`program-unload-${UPLOADED.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`program-unload-${SHIPPED.id}`)).toBeNull();
  });

  it('clears the selection, which is what unblocks the replace this page refuses', async () => {
    renderPrograms();
    await ready();
    await loadedOnDevice(UPLOADED.id);

    // The refusal the notice tells the operator to escape from.
    const blocked = await requestElsewhere(PORT, 'PUT', `/api/v2/programs/${UPLOADED.id}`, {
      ...UPLOADED,
      id: undefined,
    });
    expect(blocked.status).toBe(409);

    fireEvent.click(screen.getByTestId(`program-unload-${UPLOADED.id}`));
    await waitFor(() => expect(notice().textContent).toContain('Nothing is loaded on the device now.'));

    const allowed = await requestElsewhere(PORT, 'PUT', `/api/v2/programs/${UPLOADED.id}`, {
      ...UPLOADED,
      id: undefined,
    });
    expect(allowed.status).toBe(200);
  });

  it('explains the 409 a run in progress answers with', async () => {
    renderPrograms();
    await ready();
    await loadedOnDevice(UPLOADED.id);
    await requestElsewhere(PORT, 'POST', '/api/v2/programs/start');

    fireEvent.click(screen.getByTestId(`program-unload-${UPLOADED.id}`));

    await waitFor(() => expect(notice().textContent).toContain('Pause the run first'));
    // Not the device's own sentence, and not a raw status: the escape is named.
    expect(notice().textContent).toContain('Pause');
  });
});

describe('uploading a new program', () => {
  it('reports the id the device assigned, not the one in the file', async () => {
    renderPrograms();
    await ready();

    fireEvent.click(screen.getByTestId('programs-upload'));
    await pickFile({ ...UPLOADED, id: 7, title: 'Nyuppladdad' });

    // POST always assigns, and it assigns the lowest free id from 100 up - so
    // the seeded 140 does not push the new one to 141.
    await waitFor(() => expect(notice().textContent).toContain('Uploaded "Nyuppladdad" as program 100.'));
    expect((await programsOnDevice()).map((p) => p.id)).toEqual([SHIPPED.id, 100, UPLOADED.id]);
  });

  it('says what the device will change before it changes it, and only then writes', async () => {
    renderPrograms();
    await ready();

    fireEvent.click(screen.getByTestId('programs-upload'));
    await pickFile({
      title: 'Med skräp',
      nickname: 'dropped',
      series: [{ name: 'Serie 1', events: [{ duration: 0 }] }],
    });

    const dialog = await screen.findByTestId('confirm-dialog');
    const warnings = within(dialog).getByTestId('upload-warnings').textContent ?? '';
    expect(warnings).toContain('/nickname');
    expect(warnings).toContain('store it as 1 ms');
    // Nothing has been written yet - the point of showing this first.
    expect((await programsOnDevice()).map((p) => p.id)).toEqual([SHIPPED.id, UPLOADED.id]);

    fireEvent.click(within(dialog).getByText('Upload anyway'));
    await waitFor(() => expect(notice().textContent).toContain('as program 100'));
  });

  it('sends nothing when the warnings are declined', async () => {
    renderPrograms();
    await ready();

    fireEvent.click(screen.getByTestId('programs-upload'));
    await pickFile({ title: 'Med skräp', nickname: 'dropped', series: [{ name: 'S', events: [{ duration: 1000 }] }] });

    fireEvent.click(within(await screen.findByTestId('confirm-dialog')).getByText('Cancel'));

    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect((await programsOnDevice()).map((p) => p.id)).toEqual([SHIPPED.id, UPLOADED.id]);
  });

  it('warns before an irreversible replace, not after it', async () => {
    renderPrograms();
    await ready();

    fireEvent.click(screen.getByTestId(`program-replace-${UPLOADED.id}`));
    await pickFile({ ...UPLOADED, title: 'Klubbserie 2026', series: [{ name: 'S', events: [{ duration: 0 }] }] });

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain('cannot be undone');
    // The stored document is still the old one while the dialog is up.
    expect(await programsOnDevice()).toContainEqual(expect.objectContaining({ id: UPLOADED.id, title: 'Klubbserie' }));

    fireEvent.click(within(dialog).getByText('Replace anyway'));
    await waitFor(() => expect(notice().textContent).toContain(`Replaced program ${UPLOADED.id}`));
  });

  it('refuses a file the device would not accept, naming what is wrong', async () => {
    renderPrograms();
    await ready();

    fireEvent.click(screen.getByTestId('programs-upload'));
    await pickFile({ description: 'no title, no series' }, 'broken.json');

    await waitFor(() => expect(notice().textContent).toContain('"broken.json" is not a program'));
    expect(notice().textContent).toContain('A program needs a title.');
    expect(notice().textContent).toContain('A program needs a "series" list.');
    // Nothing reached the device.
    expect((await programsOnDevice()).map((p) => p.id)).toEqual([SHIPPED.id, UPLOADED.id]);
  });
});

describe('replacing a program', () => {
  it('round-trips an edited document through PUT', async () => {
    renderPrograms();
    await ready();

    fireEvent.click(screen.getByTestId(`program-replace-${UPLOADED.id}`));
    await pickFile({ ...UPLOADED, title: 'Klubbserie 2026' });

    await waitFor(() => expect(notice().textContent).toContain(`Replaced program ${UPLOADED.id}`));
    await waitFor(() => expect(screen.getByText('Klubbserie 2026')).toBeTruthy());
    expect(await programsOnDevice()).toContainEqual(
      expect.objectContaining({ id: UPLOADED.id, title: 'Klubbserie 2026' }),
    );
  });

  it('explains the 409 a loaded program answers with, rather than showing it raw', async () => {
    renderPrograms();
    await ready();

    // As the device would report it over SSE once the program is loaded.
    await requestElsewhere(PORT, 'POST', `/api/v2/programs/${UPLOADED.id}/load`);
    act(() => {
      queryClient.setQueryData(['state'], {
        loadedProgramId: UPLOADED.id,
        programState: null,
        targetStatus: 'hidden',
      });
    });

    fireEvent.click(screen.getByTestId(`program-replace-${UPLOADED.id}`));
    await pickFile({ ...UPLOADED, title: 'Klubbserie 2026' });

    await waitFor(() => expect(notice().textContent).toContain('currently loaded on the device'));
    expect(notice().textContent).toContain('Unload it first');
    // The stored document is untouched.
    expect(await programsOnDevice()).toContainEqual(expect.objectContaining({ id: UPLOADED.id, title: 'Klubbserie' }));
  });

  it('refuses a file whose id points somewhere else, and offers to upload it instead', async () => {
    renderPrograms();
    await ready();

    fireEvent.click(screen.getByTestId(`program-replace-${UPLOADED.id}`));
    await pickFile({ ...UPLOADED, id: 999, title: 'Fel id' }, 'fel-id.json');

    await waitFor(() => expect(notice().textContent).toContain('declares id 999'));
    expect(notice().textContent).toContain('either the wrong file or the wrong row');
    // Refused before the request: the device still holds the old document.
    expect(await programsOnDevice()).toContainEqual(expect.objectContaining({ id: UPLOADED.id, title: 'Klubbserie' }));

    fireEvent.click(screen.getByTestId('programs-notice-action'));
    await waitFor(() => expect(notice().textContent).toContain('Uploaded "Fel id" as program 100.'));
  });
});
