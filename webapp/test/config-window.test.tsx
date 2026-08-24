// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://127.0.0.1:18097" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsProvider } from '../src/context/SettingsContext';
import { useConfigWindow } from '../src/hooks/useConfigWindow';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';

const PORT = 18097;

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
    seed: { programs: {}, audios: [], configWindowOpen: open },
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
