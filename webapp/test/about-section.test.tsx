// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real - the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18086" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_VERSION } from '../src/appVersion';
import type { DiagnosticsInfo } from '../src/api/types';
import { SettingsProvider } from '../src/context/SettingsContext';
import { AboutSection } from '../src/components/AboutSection';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer, type MockSeed } from './mock-server/server';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake (18080 useAdminStatus, 18081 audios, 18082 programs,
// 18083 program-editor, 18084 run, 18085 startup-issues, 18086 here). Pick the
// next free number for a new suite.
const PORT = 18086;

let server: MockServer;
let queryClient: QueryClient;

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

/** A browser that exposes the clipboard API and then refuses to use it. */
function refuseTheClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.reject(new Error('not a secure context')) },
    configurable: true,
  });
}

/** A device reporting `version` from `GET /diagnostics/info`. */
async function deviceReporting(firmwareVersion: string, build?: MockSeed['build']): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: {}, audios: [], firmwareVersion, ...(build === undefined ? {} : { build }) },
  });
  await server.listen();
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <AboutSection />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard');
  } else {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  }
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  await server.close();
});

describe('D-29: one tag, so the app and the device report one version', () => {
  it('shows the version this bundle was built at', async () => {
    await deviceReporting(APP_VERSION);
    renderSection();

    // `vitest.config.ts` substitutes `__APP_VERSION__` with a literal, so the
    // assertion goes through the same constant the component reads rather than
    // repeating that literal here.
    expect((await screen.findByTestId('version-app')).textContent).toBe(APP_VERSION);
  });

  it('says nothing about a mismatch when the device agrees', async () => {
    await deviceReporting(APP_VERSION);
    renderSection();

    // The row exists immediately showing "Checking…", so wait on its text
    // rather than on the element.
    await waitFor(() => {
      expect(screen.getByTestId('version-firmware').textContent).toBe(APP_VERSION);
    });
    expect(screen.queryByTestId('version-mismatch')).toBeNull();
  });

  it('flags a device running a different build', async () => {
    await deviceReporting('9.9.9-4-gdeadbee');
    renderSection();

    await waitFor(() => {
      expect(screen.getByTestId('version-firmware').textContent).toBe('9.9.9-4-gdeadbee');
    });
    expect(screen.getByTestId('version-mismatch')).toBeTruthy();
  });

  it('does not claim a mismatch before the device has answered', async () => {
    await deviceReporting('9.9.9-4-gdeadbee');
    renderSection();

    // Synchronously after the first render the query is still pending, so
    // `undefined !== APP_VERSION` must not be read as a disagreement.
    expect(screen.getByTestId('version-firmware').textContent).toBe('Checking…');
    expect(screen.queryByTestId('version-mismatch')).toBeNull();
  });
});

describe('#228: the About disclosure', () => {
  it('stays collapsed until asked', async () => {
    await deviceReporting(APP_VERSION);
    renderSection();

    expect(await screen.findByTestId('build-details-toggle')).toBeTruthy();
    expect(screen.queryByTestId('build-details')).toBeNull();
  });

  it('renders every detail key the device sent, without knowing any of them', async () => {
    // The whole point of the untyped half: a key the app has never heard of
    // still reaches the table. `xyzzy.unknown.key` is not in the contract, is
    // not in generated.d.ts, and must show up anyway.
    const build: NonNullable<DiagnosticsInfo['build']> = {
      version: APP_VERSION,
      commit: 'ab12cde',
      dirty: false,
      buildTime: '2026-08-21T09:12:44Z',
      details: { 'git.branch': 'main', 'xyzzy.unknown.key': 'still rendered' },
    };
    await deviceReporting(APP_VERSION, build);
    renderSection();

    fireEvent.click(await screen.findByTestId('build-details-toggle'));

    const panel = screen.getByTestId('build-details');
    expect(panel.textContent).toContain('git.branch');
    expect(panel.textContent).toContain('xyzzy.unknown.key');
    expect(panel.textContent).toContain('still rendered');
  });

  it('marks a build made from a modified tree', async () => {
    await deviceReporting(APP_VERSION, {
      version: APP_VERSION,
      commit: 'ab12cde',
      dirty: true,
      buildTime: '2026-08-21T09:12:44Z',
      details: {},
    });
    renderSection();

    expect(await screen.findByTestId('build-dirty')).toBeTruthy();
  });

  it('says nothing about a modified tree when the build was clean', async () => {
    await deviceReporting(APP_VERSION);
    renderSection();

    await screen.findByTestId('build-details-toggle');
    expect(screen.queryByTestId('build-dirty')).toBeNull();
  });

  // `build` is optional in the contract precisely so this device exists.
  it('degrades to the bare version on firmware from before #228', async () => {
    await deviceReporting(APP_VERSION, null);
    renderSection();

    await waitFor(() => {
      expect(screen.getByTestId('version-firmware').textContent).toBe(APP_VERSION);
    });
    expect(screen.queryByTestId('build-details-toggle')).toBeNull();
    expect(screen.queryByTestId('build-dirty')).toBeNull();
  });

  it('copies the block when the browser lets it', async () => {
    await deviceReporting(APP_VERSION);
    renderSection();

    fireEvent.click(await screen.findByTestId('build-details-toggle'));
    fireEvent.click(screen.getByTestId('build-copy'));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Copied');
    });
    expect(screen.queryByTestId('build-plain')).toBeNull();
  });

  // The device is served over plain HTTP at `rotation-target.local`, where
  // `navigator.clipboard` does not exist and `execCommand` is all there is. If
  // that fails too, the operator must be left with something they can select
  // rather than an error - the text is the whole point of the button.
  it('offers the text for manual selection when the browser will not copy', async () => {
    // Both routes have to fail. happy-dom has no `document.execCommand` at
    // all, so refusing the clipboard API is enough to reach the fallback of
    // the fallback - which is exactly the device's situation with one browser
    // less.
    refuseTheClipboard();

    await deviceReporting(APP_VERSION);
    renderSection();

    fireEvent.click(await screen.findByTestId('build-details-toggle'));
    fireEvent.click(screen.getByTestId('build-copy'));

    const plain = await screen.findByTestId('build-plain');
    expect(plain.textContent).toContain('build.idf.version');
    expect(plain.textContent).toContain(APP_VERSION);
  });
});
