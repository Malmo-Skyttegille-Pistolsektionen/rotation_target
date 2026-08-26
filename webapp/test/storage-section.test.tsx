// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useControlLockStatus.test.tsx.
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

  it('says how full each partition is as a percentage, not only in bytes', async () => {
    // "How full is it" is the form the question is actually asked in. The bar
    // already encodes it, and this is the only version available to somebody
    // who cannot see the bar.
    await deviceWith([{ name: 'storage', kind: 'data', sizeBytes: 1_000_000, usedBytes: 250_000 }]);
    renderSection();

    const storage = await screen.findByTestId('partition-storage');
    expect(within(storage).getByTestId('partition-storage-percent').textContent).toBe('25%');
  });

  // The two roundings somebody would act on, and act wrongly on: a partition
  // holding a few kilobytes is not empty, and one with room for another upload
  // is not full.
  it('never rounds a nearly-empty partition down to 0%', async () => {
    await deviceWith([{ name: 'storage', kind: 'data', sizeBytes: 1_000_000, usedBytes: 2_000 }]);
    renderSection();

    const storage = await screen.findByTestId('partition-storage');
    expect(within(storage).getByTestId('partition-storage-percent').textContent).toBe('<1%');
  });

  it('never rounds a nearly-full partition up to 100%', async () => {
    await deviceWith([{ name: 'storage', kind: 'data', sizeBytes: 1_000_000, usedBytes: 998_000 }]);
    renderSection();

    const storage = await screen.findByTestId('partition-storage');
    expect(within(storage).getByTestId('partition-storage-percent').textContent).toBe('>99%');
  });

  it('shows a genuinely full partition as 100%', async () => {
    await deviceWith([{ name: 'storage', kind: 'data', sizeBytes: 1_000_000, usedBytes: 1_000_000 }]);
    renderSection();

    const storage = await screen.findByTestId('partition-storage');
    expect(within(storage).getByTestId('partition-storage-percent').textContent).toBe('100%');
  });

  it('shows no percentage where the device cannot report what is used', async () => {
    await deviceWith();
    renderSection();

    const otadata = await screen.findByTestId('partition-otadata');
    expect(within(otadata).queryByTestId('partition-otadata-percent')).toBeNull();
  });

  it('stays quiet while there is room', async () => {
    await deviceWith([{ name: 'storage', kind: 'data', sizeBytes: 1_000_000, usedBytes: 500_000 }]);
    renderSection();

    const storage = await screen.findByTestId('partition-storage');
    expect(within(storage).queryByText(/Nearly full/)).toBeNull();
  });
});
