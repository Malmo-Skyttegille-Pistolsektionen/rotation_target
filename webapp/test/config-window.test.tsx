// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://127.0.0.1:18097" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsProvider } from '../src/context/SettingsContext';
import { useConfigWindow } from '../src/hooks/useConfigWindow';
import { createFakeClock } from './mock-server/clock';
import { PROGRAM_FALT_TRANING } from './fixtures';
import type { Program } from '../src/api/types';
import { createMockServer, type MockServer } from './mock-server/server';

const PORT = 18097;

// One program, so a run can actually be started in the test below.
const PROGRAM: Program = { ...PROGRAM_FALT_TRANING, id: 1, readonly: false };

let server: MockServer;
let queryClient: QueryClient;

function Probe(): React.ReactNode {
  const { open, remainingSeconds } = useConfigWindow();
  return (
    <div>
      <span data-testid='open'>{String(open)}</span>
      <span data-testid='remaining'>{String(remainingSeconds)}</span>
    </div>
  );
}

async function device(open: boolean): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: { [PROGRAM.id]: PROGRAM }, audios: [], configWindowOpen: open },
  });
  await server.listen();
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <Probe />
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

describe('the configuration window', () => {
  it('reports the device as shut when nobody has pressed the button', async () => {
    await device(false);
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
    expect(screen.getByTestId('remaining').textContent).toBe('0');
  });

  // Reconfiguring the machine and operating it are different activities, and
  // these values only take effect at the next restart - so a change made
  // mid-run can only confuse whoever is on the line. The device closes the
  // window, so the app hides Expert mode rather than offering a dead form.
  it('reports the window shut while a program is running, even after a press', async () => {
    await device(true);
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('true'));

    const base = `http://127.0.0.1:${String(PORT)}/api/v2`;
    await fetch(`${base}/programs/${String(PROGRAM.id)}/load`, { method: 'POST' });
    // The id is required in the body; without it start answers 400 and the run
    // never begins - which is how the first version of this test "failed".
    const started = await fetch(`${base}/programs/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: PROGRAM.id }),
    });
    expect(started.status).toBe(200);

    // Refetch rather than waiting out the five-second poll. Waiting made this
    // test run for thirteen seconds of real time and starved the other suites
    // running beside it, which showed up as unrelated flakes elsewhere.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['hardware-config'] });
    });

    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
    expect(screen.getByTestId('remaining').textContent).toBe('0');

    // The device refuses too. Hiding the tab alone would be cosmetic.
    const refused = await fetch(`${base}/config/hardware`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Bana 1' }),
    });
    expect(refused.status).toBe(409);
    expect((await refused.json()).type).toBe('/problems/program_running');
  });

  // The poll runs every five seconds, so without a local tick the "countdown"
  // would jump 5:00 -> 4:55 and read as a broken clock.
  //
  // Real timers on purpose: the interval is created during render, and fake
  // timers installed afterwards do not control a timer that already exists -
  // which is exactly how this test first passed against a hook that did not
  // tick at all.
  it('ticks between polls rather than stepping by the poll interval', async () => {
    await device(true);
    await waitFor(() => expect(screen.getByTestId('remaining').textContent).toBe('300'));

    await waitFor(() => expect(Number(screen.getByTestId('remaining').textContent)).toBeLessThan(300), {
      timeout: 3000,
    });
  });
});
