// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real - the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18086" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_VERSION } from '../src/appVersion';
import { SettingsProvider } from '../src/context/SettingsContext';
import { VersionSection } from '../src/components/VersionSection';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake (18080 useAdminStatus, 18081 audios, 18082 programs,
// 18083 program-editor, 18084 run, 18085 startup-issues, 18086 here). Pick the
// next free number for a new suite.
const PORT = 18086;

let server: MockServer;
let queryClient: QueryClient;

/** A device reporting `version` from `GET /diagnostics/info`. */
async function deviceReporting(firmwareVersion: string): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: {}, audios: [], firmwareVersion },
  });
  await server.listen();
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <VersionSection />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
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
