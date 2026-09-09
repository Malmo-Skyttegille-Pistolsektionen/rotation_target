// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useControlLockStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18091" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SettingsProvider } from '../src/context/SettingsContext';
import type { Program, StateUpdatePayload } from '../src/api/types';
import { RunView } from '../src/routes/run';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';

// Distinct per suite: vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake.
const PORT = 18091;

/**
 * The run page against a known device bank count. The state is seeded into the
 * query the SSE hook writes - the same door a real frame comes through - so
 * these cases are reachable without standing up a stream and a device for each.
 *
 * `targetBanks` is on every frame, one key per bank, so the only way to know
 * no bank count is to have had no frame at all - which is `null`, not a frame
 * with the map left out. A one-bank device reports itself as `{A: ...}`.
 */
const BANKED: Program = {
  id: 141,
  title: 'Fältträning, 4 mål',
  description: '',
  readonly: false,
  series: [
    {
      name: 'Station 1',
      optional: false,
      events: [
        { duration: 4000, command: 'hide', banks: { A: 'show' } },
        { duration: 4000, command: 'hide', banks: { D: 'show' } },
      ],
    },
  ],
};

let server: MockServer;
let queryClient: QueryClient;

function seedState(targetBanks: Record<string, 'shown' | 'hidden'> | null): void {
  const state: StateUpdatePayload | null = targetBanks
    ? {
        loadedProgramId: BANKED.id,
        programState: { running: false, currentSeriesIndex: 0, currentEventIndex: 0, tickerMs: 0 },
        targetBanks,
      }
    : null;
  queryClient.setQueryData(['state'], state);
}

function renderView(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <RunView />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

async function renderRun(targetBanks: Record<string, 'shown' | 'hidden'>): Promise<void> {
  seedState(targetBanks);
  renderView();
  await waitFor(() => expect(screen.getByTestId('timeline')).toBeTruthy());
}

function startButton(): HTMLButtonElement {
  return screen.getByTestId('run-start') as HTMLButtonElement;
}

beforeAll(async () => {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: { [BANKED.id]: BANKED }, audios: [] },
  });
  await server.listen();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  server.reset();
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
});

describe('a loaded program that needs banks this device does not have', () => {
  it('says so, and refuses the start rather than the load', async () => {
    await renderRun({ A: 'shown', B: 'hidden' });

    expect(screen.getByTestId('run-banks-notice').textContent).toContain(
      'needs banks A–D. This device has A–B, so it cannot be started here.',
    );
    expect(startButton().disabled).toBe(true);
  });

  // Clamping to the two banks present would drop the overrides that are the
  // reason it will not start, which is the one thing the operator is here to
  // see. The program is drawn as written.
  it('draws the program as written, not as this device could run it', async () => {
    await renderRun({ A: 'shown', B: 'hidden' });
    expect(document.querySelectorAll('.lane')).toHaveLength(4);
  });

  // Before the first frame the device has said neither what it drives nor what
  // it has loaded, so there is nothing to refuse and nothing to say. Not a
  // one-bank device: that sends `{A: ...}`, which is the case below.
  it('says nothing while no frame has arrived', async () => {
    seedState(null);
    renderView();
    await waitFor(() => expect(screen.getByTestId('run-target-status')).toBeTruthy());

    expect(screen.queryByTestId('run-banks-notice')).toBeNull();
    // Disabled because nothing is loaded - not because a bank count was
    // guessed out of an absence.
    expect(startButton().disabled).toBe(true);
  });

  it('refuses it on a one-bank device, which reports itself with one key', async () => {
    await renderRun({ A: 'shown' });

    expect(screen.getByTestId('run-banks-notice').textContent).toContain('This device has one bank (A)');
    expect(startButton().disabled).toBe(true);
  });

  it('says nothing on a device that has the banks', async () => {
    await renderRun({ A: 'shown', B: 'shown', C: 'shown', D: 'shown' });

    expect(screen.queryByTestId('run-banks-notice')).toBeNull();
    expect(startButton().disabled).toBe(false);
    expect(document.querySelectorAll('.lane')).toHaveLength(4);
  });
});
