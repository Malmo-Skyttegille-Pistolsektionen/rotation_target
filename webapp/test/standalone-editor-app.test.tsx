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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});

describe('the picker', () => {
  it('offers this repo, another repo, a local file, and new', async () => {
    renderApp();
    await ready();
    expect(screen.getByTestId('picker-repo-canonical')).toBeTruthy();
    expect(screen.getByTestId('picker-repo-other')).toBeTruthy();
    expect(screen.getByTestId('picker-file')).toBeTruthy();
    expect(screen.getByTestId('picker-new')).toBeTruthy();
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
