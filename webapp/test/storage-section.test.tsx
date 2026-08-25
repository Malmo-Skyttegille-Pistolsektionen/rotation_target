// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18087" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DiagnosticsInfo } from '../src/api/types';
import { SettingsProvider } from '../src/context/SettingsContext';
import { StorageSection } from '../src/components/StorageSection';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake. Pick the next free number for a new suite.
const PORT = 18087;

let server: MockServer;
let queryClient: QueryClient;

async function deviceWith(partitions?: DiagnosticsInfo['partitions']): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: {}, audios: [], partitions },
  });
  await server.listen();
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <StorageSection />
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

describe('per-partition space on Settings', () => {
  it('reports every partition the device has, not just the filesystem', async () => {
    await deviceWith();
    renderSection();

    // The whole point of the issue: the filesystem was the only one reported,
    // and the app slots are what say whether an OTA image will fit. (The
    // filesystem is `userdata` since #227 - it holds uploads and nothing
    // else.)
    expect(await screen.findByTestId('partition-userdata')).toBeTruthy();
    expect(screen.getByTestId('partition-ota_0')).toBeTruthy();
    expect(screen.getByTestId('partition-ota_1')).toBeTruthy();
    expect(screen.getByTestId('partition-nvs')).toBeTruthy();
  });

  it('marks which app slot the device booted from', async () => {
    await deviceWith();
    renderSection();

    const running = await screen.findByTestId('partition-ota_0');
    expect(within(running).getByText('running')).toBeTruthy();
    expect(within(screen.getByTestId('partition-ota_1')).queryByText('running')).toBeNull();
  });

  it('says it cannot tell rather than drawing an empty bar', async () => {
    // An empty bar reads as "nothing used", which is a stronger claim than
    // "we cannot tell" - otadata genuinely reports no usage.
    await deviceWith();
    renderSection();

    const otadata = await screen.findByTestId('partition-otadata');
    expect(within(otadata).getByText(/cannot report/)).toBeTruthy();
    expect(within(otadata).queryByRole('progressbar')).toBeNull();
  });

  it('warns in words before an upload fails, not in colour', async () => {
    // The Three Signals Rule: green and amber already mean target state and
    // delay-armed, so "nearly full" has to be legible without them - which is
    // also the only version a colourblind operator can read.
    await deviceWith([{ name: 'storage', kind: 'data', sizeBytes: 1_000_000, usedBytes: 950_000 }]);
    renderSection();

    const storage = await screen.findByTestId('partition-storage');
    expect(within(storage).getByText(/Nearly full/)).toBeTruthy();
  });

  it('stays quiet while there is room', async () => {
    await deviceWith([{ name: 'storage', kind: 'data', sizeBytes: 1_000_000, usedBytes: 500_000 }]);
    renderSection();

    const storage = await screen.findByTestId('partition-storage');
    expect(within(storage).queryByText(/Nearly full/)).toBeNull();
  });
});
