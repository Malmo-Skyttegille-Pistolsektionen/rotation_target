// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider } from '../src/context/SettingsContext';
import { StandaloneEditorApp } from '../src/standalone/StandaloneEditorApp';

/**
 * `ProgramEditor` calls `useBlocker()` unconditionally, which needs a router
 * in context — the same single-route, in-memory setup `editor-main.tsx` uses
 * for real. There is no device anywhere in this suite, unlike
 * `program-editor.test.tsx`: that is the entire point of this build.
 */
function renderApp(): void {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: StandaloneEditorApp });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsProvider>
        <RouterProvider router={router} />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

/** The router's initial match resolves asynchronously, even for one route on memory history. */
async function ready(): Promise<void> {
  await screen.findByTestId('picker-new');
}

function type(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

const MINIMAL_PROGRAM_JSON = JSON.stringify({
  title: 'Testserie',
  description: '',
  series: [{ name: 'S1', optional: false, events: [{ duration: 1000, command: 'show' }] }],
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * A repository with two programs. The listing is the contents API; the two
 * titles come from `raw.githubusercontent.com`, which is deliberately a
 * different host - the whole lazy-title design rests on those not spending API
 * quota.
 */
function stubRepo(options: { titlesFail?: boolean } = {}): ReturnType<typeof vi.fn> {
  const listing = JSON.stringify([
    { name: '2.json', path: 'p/2.json', type: 'file', download_url: 'https://raw/2' },
    { name: '40.json', path: 'p/40.json', type: 'file', download_url: 'https://raw/40' },
  ]);
  const titles: Record<string, string> = {
    'https://raw/2': JSON.stringify({ id: 2, title: 'Provserie' }),
    'https://raw/40': JSON.stringify({ id: 40, title: 'Fältträning' }),
  };

  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://api.github.com/')) return Promise.resolve(new Response(listing, { status: 200 }));
    if (options.titlesFail) return Promise.resolve(new Response('nope', { status: 500 }));
    return Promise.resolve(new Response(titles[url] ?? '{}', { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the picker', () => {
  it('offers one repo card, a local file, and new', async () => {
    renderApp();
    await ready();
    // One card, not two (#221). "This repo" was never anything but a set of
    // defaults once the path and ref became fields.
    expect(screen.getByTestId('picker-repo')).toBeTruthy();
    expect(screen.getByTestId('picker-file')).toBeTruthy();
    expect(screen.getByTestId('picker-new')).toBeTruthy();
  });

  // Somebody browsing our programs should press Browse and touch nothing.
  it('pre-fills the repo fields with this project, and the ref with nothing', async () => {
    renderApp();
    await ready();
    expect((screen.getByTestId('picker-repo-owner') as HTMLInputElement).value).toBe(
      'Malmo-Skyttegille-Pistolsektionen',
    );
    expect((screen.getByTestId('picker-repo-repo') as HTMLInputElement).value).toBe('rotation_target');
    expect((screen.getByTestId('picker-repo-path') as HTMLInputElement).value).toBe('resources/programs/files');
    // Empty means the default branch, which is what somebody wants unless they
    // say otherwise.
    expect((screen.getByTestId('picker-repo-ref') as HTMLInputElement).value).toBe('');
  });

  it('carries the path and ref into the listing request', async () => {
    const fetchMock = stubRepo();
    renderApp();
    await ready();

    type('picker-repo-path', 'other/programs');
    type('picker-repo-ref', 'v1.2.3');
    fireEvent.click(screen.getByTestId('picker-repo-browse'));

    await screen.findByTestId('picker-repo-files');
    const listingCall = fetchMock.mock.calls.find((call) => String(call[0]).startsWith('https://api.github.com/'));
    expect(String(listingCall?.[0])).toBe(
      'https://api.github.com/repos/Malmo-Skyttegille-Pistolsektionen/rotation_target/contents/other/programs?ref=v1.2.3',
    );
  });

  it('upgrades each row from its filename to its title as the titles arrive', async () => {
    stubRepo();
    renderApp();
    await ready();
    fireEvent.click(screen.getByTestId('picker-repo-browse'));

    // Not "2.json" and "40.json" - the whole point of #221 is that you cannot
    // tell Provserie from Fältträning without opening both.
    expect((await screen.findByTestId('picker-repo-file-2.json')).textContent).toBe('2 — Provserie');
    expect(screen.getByTestId('picker-repo-file-40.json').textContent).toBe('40 — Fältträning');
  });

  // The list has to be usable under a rate limit, an offline moment, or a file
  // somebody broke - which means degrading to exactly today's behaviour rather
  // than failing the browse.
  it('keeps the filename when a title cannot be read, and lists anyway', async () => {
    stubRepo({ titlesFail: true });
    renderApp();
    await ready();
    fireEvent.click(screen.getByTestId('picker-repo-browse'));

    const row = await screen.findByTestId('picker-repo-file-2.json');
    expect(row.textContent).toBe('2.json');
    expect(screen.queryByTestId('picker-repo-error')).toBeNull();
  });
});

describe('starting a new program', () => {
  it('asks for an id, then opens the same ProgramEditor the device build uses', async () => {
    renderApp();
    await ready();
    fireEvent.click(screen.getByTestId('picker-new-start'));

    // No id yet - "Open in editor" is refused until one is typed.
    expect((screen.getByTestId('picker-confirm-open') as HTMLButtonElement).disabled).toBe(true);
    type('picker-confirm-id', '42');
    expect((screen.getByTestId('picker-confirm-open') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('picker-confirm-open'));

    expect(screen.getByTestId('editor-heading').textContent).toContain('Program 42');
    // Not "Save" or "Create" - those imply a device on the other end of the click.
    expect(screen.getByTestId('editor-save').textContent).toBe('Continue');
  });

  it('offers Download and a pull request link for a small program, with no device call anywhere', async () => {
    renderApp();
    await ready();
    fireEvent.click(screen.getByTestId('picker-new-start'));
    type('picker-confirm-id', '42');
    fireEvent.click(screen.getByTestId('picker-confirm-open'));

    fireEvent.click(screen.getByTestId('editor-tab-json'));
    type('editor-json', MINIMAL_PROGRAM_JSON);
    fireEvent.click(screen.getByTestId('editor-save'));

    const panel = await screen.findByTestId('export-panel');
    expect(within(panel).getByTestId('export-download').textContent).toBe('Download 42.json');
    const link = within(panel).getByTestId('export-pr-link') as HTMLAnchorElement;
    expect(link.href).toContain('github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target/new/main');
    expect(link.href).toContain('filename=resources%2Fprograms%2Ffiles%2F42.json');
  });

  it('refuses an empty document, the same validation the device build uses', async () => {
    renderApp();
    await ready();
    fireEvent.click(screen.getByTestId('picker-new-start'));
    type('picker-confirm-id', '42');
    fireEvent.click(screen.getByTestId('picker-confirm-open'));

    fireEvent.click(screen.getByTestId('editor-save'));

    expect(screen.getByTestId('editor-notice').textContent).toContain('cannot be saved yet');
    expect(screen.queryByTestId('export-panel')).toBeNull();
  });
});

describe('opening a file that is not a valid program', () => {
  it('shows the same parse errors the device build would, before the editor opens', async () => {
    renderApp();
    await ready();
    const input = screen.getByTestId('picker-file-input') as HTMLInputElement;
    const file = new File(['not json'], 'broken.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByTestId('picker-confirm-invalid')).toBeTruthy();
    expect(screen.queryByTestId('editor-heading')).toBeNull();
  });
});
