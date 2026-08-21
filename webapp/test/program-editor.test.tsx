// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real - the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18083" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SettingsProvider } from '../src/context/SettingsContext';
import type { AudioFile, Program } from '../src/api/types';
import { ProgramsView } from '../src/routes/programs';
import { PROGRAM_FALT_TRANING } from './fixtures';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { requestElsewhere } from './other-client';

// Distinct per suite: vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake (18082 is programs.test.tsx).
const PORT = 18083;

/** Shipped: read-only, so editing it can only mean editing a copy. */
const SHIPPED: Program = { ...PROGRAM_FALT_TRANING, id: 40, readonly: true };
/** Uploaded: the row that gets Edit, Replace and Delete. */
const UPLOADED: Program = { ...PROGRAM_FALT_TRANING, id: 140, title: 'Klubbserie', readonly: false };

const AUDIOS: AudioFile[] = [
  { id: 26, title: 'Ladda!', filename: '/storage/shipped/audio/26.wav', readonly: true },
  { id: 33, title: 'Eld!', filename: '/storage/shipped/audio/33.wav', readonly: true },
];

let server: MockServer;
let queryClient: QueryClient;

/**
 * The tab inside a router, because the editor blocks navigation while the
 * draft is unsaved and that is one of the things worth asserting. Two routes
 * and a link is the whole app as far as this suite is concerned.
 */
function renderApp(): void {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Link to='/audios'>Audios</Link>
        <Outlet />
      </>
    ),
  });
  const programsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/programs', component: ProgramsView });
  const audiosRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/audios',
    component: () => <p>The audios tab</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([programsRoute, audiosRoute]),
    history: createMemoryHistory({ initialEntries: ['/programs'] }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <RouterProvider router={router} />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

/** The list has arrived. */
async function ready(): Promise<void> {
  await screen.findByTestId('programs-table');
  await waitFor(() => expect(screen.getByTestId(`program-row-${UPLOADED.id}`)).toBeTruthy());
}

/** Open the editor on a row, and wait for the document to arrive. */
async function openEditor(id: number): Promise<void> {
  fireEvent.click(screen.getByTestId(`program-edit-${id}`));
  await screen.findByTestId('editor-title');
}

function type(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function editorNotice(): HTMLElement {
  return screen.getByTestId('editor-notice');
}

async function storedProgram(id: number): Promise<Program> {
  const { body } = await requestElsewhere(PORT, 'GET', `/api/v2/programs/${id}`);
  return JSON.parse(body) as Program;
}

async function programIds(): Promise<number[]> {
  const { body } = await requestElsewhere(PORT, 'GET', '/api/v2/programs');
  return (JSON.parse(body) as { id: number }[]).map((program) => program.id);
}

beforeAll(async () => {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: { [SHIPPED.id]: SHIPPED, [UPLOADED.id]: UPLOADED }, audios: AUDIOS },
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

describe('getting into the editor', () => {
  it('offers Edit on an uploaded program and a copy on a shipped one', async () => {
    renderApp();
    await ready();

    expect(screen.getByTestId(`program-edit-${UPLOADED.id}`).textContent).toBe('Edit…');
    // Shipped programs have no file behind them to write back, so the only
    // edit available is one that lands as a new program.
    expect(screen.getByTestId(`program-edit-${SHIPPED.id}`).textContent).toBe('Edit a copy…');
  });

  it('starts a new program on one series with one event, and no id or read-only field', async () => {
    renderApp();
    await ready();

    fireEvent.click(screen.getByTestId('programs-new'));

    await screen.findByTestId('editor-title');
    expect(screen.getByTestId('editor-heading').textContent).toBe('New program');
    expect(screen.getByTestId('editor-event-0-0-duration')).toHaveProperty('value', '1000');
    // The device assigns both; a field for either is a control that does
    // nothing (#73).
    expect(screen.queryByLabelText(/read-only/i)).toBeNull();
    expect(screen.queryByLabelText(/^id$/i)).toBeNull();
  });

  it('opens an existing program from the device, not from the summary in the list', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);

    expect(screen.getByTestId('editor-heading').textContent).toBe(`Editing program ${UPLOADED.id}`);
    expect(screen.getByTestId('editor-title')).toHaveProperty('value', UPLOADED.title);
    // The list only carries summaries; the series came from `GET /programs/{id}`.
    expect(screen.getByTestId('editor-series-0-name')).toHaveProperty('value', UPLOADED.series[0].name);
  });
});

describe('creating a program', () => {
  it('sends what was typed and reports the id the device assigned', async () => {
    renderApp();
    await ready();
    fireEvent.click(screen.getByTestId('programs-new'));
    await screen.findByTestId('editor-title');

    type('editor-title', 'Klubbmästerskap');
    type('editor-description', 'Två serier');
    type('editor-series-0-name', 'Serie 1');
    type('editor-event-0-0-duration', '2500');
    fireEvent.click(screen.getByTestId('editor-event-0-0-command-show'));

    fireEvent.click(screen.getByTestId('editor-series-0-add-event'));
    type('editor-event-0-1-duration', '3000');
    fireEvent.click(screen.getByTestId('editor-event-0-1-command-hide'));

    fireEvent.click(screen.getByTestId('editor-save'));

    // POST assigns the lowest free id from 100 up, so it is 100 and not 141.
    await waitFor(() =>
      expect(screen.getByTestId('programs-notice').textContent).toContain('Saved "Klubbmästerskap" as program 100.'),
    );
    expect(await storedProgram(100)).toMatchObject({
      title: 'Klubbmästerskap',
      description: 'Två serier',
      series: [
        {
          name: 'Serie 1',
          optional: false,
          events: [
            { duration: 2500, command: 'show' },
            { duration: 3000, command: 'hide' },
          ],
        },
      ],
    });
  });

  it('writes no command at all for "no change"', async () => {
    renderApp();
    await ready();
    fireEvent.click(screen.getByTestId('programs-new'));
    await screen.findByTestId('editor-title');

    type('editor-title', 'Paus');
    type('editor-series-0-name', 'Serie 1');
    // The default, but assert it explicitly: since #80 the firmware refuses
    // anything that is not `show`, `hide` or absent, so "no change" has to be
    // an absent key rather than a null or an empty string.
    fireEvent.click(screen.getByTestId('editor-event-0-0-command-none'));
    fireEvent.click(screen.getByTestId('editor-save'));

    await waitFor(() => expect(screen.getByTestId('programs-notice').textContent).toContain('as program 100'));
    const stored = await storedProgram(100);
    expect(Object.keys(stored.series[0].events[0])).toEqual(['duration']);
  });

  it('picks audio clips by id and title, and keeps the order they were added in', async () => {
    renderApp();
    await ready();
    fireEvent.click(screen.getByTestId('programs-new'));
    await screen.findByTestId('editor-title');
    // The picker is fed from `GET /audios`.
    await waitFor(() =>
      expect(within(screen.getByTestId('editor-event-0-0-audio-add')).getByText(/Ladda!/)).toBeTruthy(),
    );

    type('editor-title', 'Med ljud');
    type('editor-series-0-name', 'Serie 1');
    type('editor-event-0-0-audio-add', '33');
    type('editor-event-0-0-audio-add', '26');

    expect(screen.getByTestId('editor-event-0-0-audio-ids').textContent).toContain('33 · Eld!');
    fireEvent.click(screen.getByTestId('editor-event-0-0-audio-26-earlier'));
    fireEvent.click(screen.getByTestId('editor-save'));

    await waitFor(() => expect(screen.getByTestId('programs-notice').textContent).toContain('as program 100'));
    expect((await storedProgram(100)).series[0].events[0].audio_ids).toEqual([26, 33]);
  });

  it('takes a shipped program as the starting point of a new one', async () => {
    renderApp();
    await ready();
    await openEditor(SHIPPED.id);

    expect(screen.getByTestId('editor-heading').textContent).toContain(`copied from "${SHIPPED.title}"`);
    expect(screen.getByTestId('editor-title')).toHaveProperty('value', `${SHIPPED.title} (copy)`);

    fireEvent.click(screen.getByTestId('editor-save'));

    await waitFor(() => expect(screen.getByTestId('programs-notice').textContent).toContain('as program 100'));
    // The copy is its own program: the shipped one is untouched and still shipped.
    expect(await programIds()).toEqual([SHIPPED.id, 100, UPLOADED.id]);
    expect(await storedProgram(SHIPPED.id)).toMatchObject({ title: SHIPPED.title, readonly: true });
    expect(await storedProgram(100)).toMatchObject({ readonly: false });
  });
});

describe('saving an edit', () => {
  it('replaces the stored document through PUT and reports what came back', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);

    type('editor-title', 'Klubbserie 2026');
    fireEvent.click(screen.getByTestId('editor-save'));

    await waitFor(() => expect(editorNotice().textContent).toContain(`Saved program ${UPLOADED.id}`));
    expect(await storedProgram(UPLOADED.id)).toMatchObject({ id: UPLOADED.id, title: 'Klubbserie 2026' });
    // Saved means clean: closing now asks nothing.
    expect(screen.queryByTestId('editor-dirty')).toBeNull();
  });

  it('explains the 409 a loaded program answers with, and keeps the edits', async () => {
    renderApp();
    await ready();

    await requestElsewhere(PORT, 'POST', `/api/v2/programs/${UPLOADED.id}/load`);
    await openEditor(UPLOADED.id);
    type('editor-title', 'Klubbserie 2026');
    fireEvent.click(screen.getByTestId('editor-save'));

    await waitFor(() => expect(editorNotice().textContent).toContain('currently loaded on the device'));
    expect(editorNotice().textContent).toContain('Unload it first');
    // The editor stays open on the refused edit: closing it would throw away
    // the work the device just declined to store.
    expect(screen.getByTestId('editor-title')).toHaveProperty('value', 'Klubbserie 2026');
    expect(await storedProgram(UPLOADED.id)).toMatchObject({ title: UPLOADED.title });
  });
});

describe('what the device would change', () => {
  it('shows the clamp before the save, and only writes once it is accepted', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);

    type('editor-event-0-0-duration', '0');
    fireEvent.click(screen.getByTestId('editor-save'));

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(within(dialog).getByTestId('editor-warnings').textContent).toContain('store it as 1 ms');
    // Nothing written yet - the point of asking first.
    expect((await storedProgram(UPLOADED.id)).series[0].events[0].duration).toBe(UPLOADED.series[0].events[0].duration);

    fireEvent.click(within(dialog).getByText('Save anyway'));
    await waitFor(() => expect(editorNotice().textContent).toContain(`Saved program ${UPLOADED.id}`));
    expect((await storedProgram(UPLOADED.id)).series[0].events[0].duration).toBe(1);
  });

  it('sends nothing when the clamp is declined', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);

    type('editor-event-0-0-duration', '0');
    fireEvent.click(screen.getByTestId('editor-save'));
    fireEvent.click(within(await screen.findByTestId('confirm-dialog')).getByText('Cancel'));

    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect((await storedProgram(UPLOADED.id)).series[0].events[0].duration).toBe(UPLOADED.series[0].events[0].duration);
  });

  it('still saves a stored program whose series was already unnamed', async () => {
    // The device accepts this document, and this app's own upload path would
    // store it. Refusing it here would make it uneditable: correcting the
    // description would be blocked on a series the author never touched.
    const flawed: Program = { ...UPLOADED, series: [{ name: '', optional: false, events: [{ duration: 1000 }] }] };
    await requestElsewhere(PORT, 'PUT', `/api/v2/programs/${UPLOADED.id}`, flawed);

    renderApp();
    await ready();
    await openEditor(UPLOADED.id);

    type('editor-description', 'Rättad beskrivning');
    fireEvent.click(screen.getByTestId('editor-save'));

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(within(dialog).getByTestId('editor-carried').textContent).toContain('Series 1 needs a name.');

    fireEvent.click(within(dialog).getByText('Save anyway'));
    await waitFor(() => expect(editorNotice().textContent).toContain(`Saved program ${UPLOADED.id}`));
    expect(await storedProgram(UPLOADED.id)).toMatchObject({ description: 'Rättad beskrivning' });
  });

  it('refuses a series this session left unnamed, which the device itself would accept', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);

    type('editor-series-0-name', '');
    fireEvent.click(screen.getByTestId('editor-save'));

    await waitFor(() => expect(editorNotice().textContent).toContain('cannot be saved yet'));
    expect(editorNotice().textContent).toContain('Series 1 needs a name.');
    expect(await storedProgram(UPLOADED.id)).toMatchObject({ title: UPLOADED.title });
  });
});

describe('the duration field', () => {
  it('keeps what was typed, so the validator is what explains a bad value', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);

    // A number input would have blanked this itself and left the field showing
    // text the model no longer held.
    type('editor-event-0-0-duration', '12x');
    expect(screen.getByTestId('editor-event-0-0-duration')).toHaveProperty('value', '12x');
    expect(screen.getByTestId('editor-event-0-0-seconds').textContent).toBe('—');

    fireEvent.click(screen.getByTestId('editor-save'));

    await waitFor(() => expect(editorNotice().textContent).toContain('cannot be saved yet'));
    expect(editorNotice().textContent).toContain('whole number');
  });
});

describe('the JSON view', () => {
  it('carries edits back into the form when the Editor tab is opened again', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);

    fireEvent.click(screen.getByTestId('editor-tab-json'));
    const text = (screen.getByTestId('editor-json') as HTMLTextAreaElement).value;
    expect(JSON.parse(text)).not.toHaveProperty('id');

    type('editor-json', text.replace(UPLOADED.title, 'Från JSON'));
    fireEvent.click(screen.getByTestId('editor-tab-editor'));

    expect(screen.getByTestId('editor-title')).toHaveProperty('value', 'Från JSON');
  });

  it('leaves the form alone when the text is not a program, and says why', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);

    fireEvent.click(screen.getByTestId('editor-tab-json'));
    type('editor-json', '{ "title": "Trasig" }');
    expect(screen.getByTestId('editor-json-errors').textContent).toContain('A program needs a "series" list.');

    fireEvent.click(screen.getByTestId('editor-tab-editor'));

    // Still on the JSON tab, with the form untouched behind it.
    expect(screen.getByTestId('editor-json')).toBeTruthy();
    expect(editorNotice().textContent).toContain('the form was left as it was');
  });
});

describe('the unsaved-changes guard', () => {
  it('asks before closing an editor with edits in it', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);
    type('editor-title', 'Inte sparad');

    fireEvent.click(screen.getByTestId('editor-cancel'));

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain('Discard unsaved changes?');
    fireEvent.click(within(dialog).getByText('Cancel'));

    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(screen.getByTestId('editor-title')).toHaveProperty('value', 'Inte sparad');

    fireEvent.click(screen.getByTestId('editor-cancel'));
    fireEvent.click(within(await screen.findByTestId('confirm-dialog')).getByText('Discard'));
    await waitFor(() => expect(screen.queryByTestId('program-editor')).toBeNull());
  });

  it('counts unapplied JSON as an unsaved edit', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);

    // Typed into the JSON tab and never applied: the draft is untouched, so
    // the only record of the edit is the textarea. `handleSave` would send it,
    // which is exactly why closing must not drop it in silence.
    fireEvent.click(screen.getByTestId('editor-tab-json'));
    const text = (screen.getByTestId('editor-json') as HTMLTextAreaElement).value;
    type('editor-json', text.replace(UPLOADED.title, 'Bara i JSON'));

    fireEvent.click(screen.getByTestId('editor-cancel'));

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain('Discard unsaved changes?');
    fireEvent.click(within(dialog).getByText('Cancel'));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());

    // And navigating away is blocked on the same edit.
    await act(async () => {
      fireEvent.click(screen.getByText('Audios'));
    });
    expect((await screen.findByTestId('confirm-dialog')).textContent).toContain('Leave the editor?');
  });

  it('closes without asking when nothing was changed', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);

    fireEvent.click(screen.getByTestId('editor-cancel'));

    await waitFor(() => expect(screen.queryByTestId('program-editor')).toBeNull());
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('blocks a navigation away from the tab until the edits are given up', async () => {
    renderApp();
    await ready();
    await openEditor(UPLOADED.id);
    type('editor-title', 'Inte sparad');

    await act(async () => {
      fireEvent.click(screen.getByText('Audios'));
    });

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain('Leave the editor?');

    fireEvent.click(within(dialog).getByText('Cancel'));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(screen.getByTestId('program-editor')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Audios'));
    });
    fireEvent.click(within(await screen.findByTestId('confirm-dialog')).getByText('Leave'));

    await waitFor(() => expect(screen.getByText('The audios tab')).toBeTruthy());
  });
});
