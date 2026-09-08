// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real - the firmware serves the
// bundle. Its own port: vitest runs files in parallel (see run.test.tsx).
// @vitest-environment-options { "url": "http://127.0.0.1:18094" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { updateBaseUrl } from '../src/api/client';
import { SettingsProvider } from '../src/context/SettingsContext';
import { useSSE } from '../src/hooks/useSSE';
import type { Program } from '../src/api/types';
import { RunView } from '../src/routes/run';
import { FakeEventSource } from './fake-event-source';
import { PROGRAM_FALT_TRANING } from './fixtures';
import { createFakeClock } from './mock-server/clock';
import { HARDWARE_DEFAULTS, createMockServer, type MockServer } from './mock-server/server';
import { openSSE, type SSEReader } from './mock-server/sse-reader';

const PORT = 18094;
const FALT: Program = { ...PROGRAM_FALT_TRANING, id: 40 };

/** Three banks, named the way a club with three lanes would name them. */
const BANKS = [
  { gpio: 5, activeLow: true, name: 'Vänster' },
  { gpio: 6, activeLow: true, name: 'Mitten' },
  { gpio: 7, activeLow: true, name: 'Höger' },
];

let server: MockServer;
let queryClient: QueryClient;
let stream: SSEReader;
let deliveredFrames = 0;

function Harness(): React.ReactNode {
  useSSE();
  return <RunView />;
}

function renderRun(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <Harness />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

async function pump(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    while (deliveredFrames < stream.frames.length) {
      const frame = stream.frames[deliveredFrames++];
      FakeEventSource.latest.emit(frame.event, frame.data);
    }
  });
}

async function until(condition: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await pump();
    if (condition()) return;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
  }
}

/** The cell for one bank, as an operator reads it off the strip. */
function cell(letter: string): HTMLElement {
  return screen.getByTestId(`run-bank-${letter}`);
}

function isShown(letter: string): boolean {
  return cell(letter).className.includes('badgeGreen');
}

beforeAll(async () => {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: {
      programs: { [FALT.id]: FALT },
      audios: [],
      hardware: { ...HARDWARE_DEFAULTS, targetGpio: 5, banks: BANKS },
    },
  });
  await server.listen();
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  FakeEventSource.reset();
  server.reset();
  localStorage.clear();
  document.cookie = 'control_lock=; Path=/; Max-Age=0';
  updateBaseUrl(window.location.origin);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // Opened per test rather than per suite, so the frame the device sends on
  // connect - the whole state, before anything has changed - is in the history
  // the app is fed.
  stream = await openSSE(PORT);
  deliveredFrames = 0;
});

afterEach(async () => {
  cleanup();
  stream.close();
  queryClient.unmount();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe('the target bank strip', () => {
  it('shows one cell per bank, with the name from the hardware configuration', async () => {
    renderRun();
    await until(() => screen.queryByTestId('run-bank-C') !== null, 'the strip to appear');

    for (const letter of ['A', 'B', 'C']) expect(cell(letter).textContent).toContain(letter);
    expect(screen.queryByTestId('run-bank-D')).toBeNull();
    // The name is in the cell at every width; CSS hides it below 768px, and the
    // title carries it regardless.
    await until(() => cell('A').textContent?.includes('Vänster') === true, 'the bank names');
    expect(cell('C').getAttribute('title')).toContain('Höger');
  });

  it('a cell toggles its own bank and leaves the others alone', async () => {
    renderRun();
    await until(() => screen.queryByTestId('run-bank-toggle-B') !== null, 'the bank buttons');
    expect(isShown('A')).toBe(false);
    expect(isShown('B')).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByTestId('run-bank-toggle-B'));
    });
    await until(() => isShown('B'), 'bank B to come on');

    expect(isShown('A')).toBe(false);
    expect(isShown('C')).toBe(false);
  });

  it('Show all and Hide all move every bank', async () => {
    renderRun();
    await until(() => screen.queryByTestId('run-targets-show-all') !== null, 'the all buttons');

    await act(async () => {
      fireEvent.click(screen.getByTestId('run-targets-show-all'));
    });
    await until(() => isShown('A') && isShown('B') && isShown('C'), 'every bank to come on');

    await act(async () => {
      fireEvent.click(screen.getByTestId('run-targets-hide-all'));
    });
    await until(() => !isShown('A') && !isShown('B') && !isShown('C'), 'every bank to go off');
  });

  // The strip replaces the single button, so the single button must be gone -
  // otherwise it is a fourth control that says "targets" and means something
  // else.
  it('replaces the single Toggle Targets button', async () => {
    renderRun();
    await until(() => screen.queryByTestId('run-target-group') !== null, 'the target group');

    expect(screen.queryByRole('button', { name: 'Toggle Targets' })).toBeNull();
  });

  // Control lock hides the actions; the strip in the header is a reading, not a
  // control, so it stays.
  it('hides the buttons under the control lock but keeps the reading', async () => {
    await fetch(`http://127.0.0.1:${String(PORT)}/api/v2/control-lock/enable`, {
      method: 'POST',
      body: JSON.stringify({ password: 'hunter2hunter2' }),
    });
    renderRun();
    await until(() => screen.queryByTestId('run-view-only') !== null, 'the view-only badge');

    expect(screen.queryByTestId('run-target-group')).toBeNull();
    expect(screen.getByTestId('run-bank-A')).toBeTruthy();
  });
});

/**
 * The compatibility assertion: a one-bank device - which is every device today
 * - must render the badge it always rendered, not a one-cell strip.
 */
describe('a device with one bank', () => {
  const ONE_PORT = 18095;
  let oneServer: MockServer;
  let oneStream: SSEReader;

  beforeEach(async () => {
    stream.close();
    oneServer = createMockServer({
      clock: createFakeClock(),
      port: ONE_PORT,
      seed: { programs: { [FALT.id]: FALT }, audios: [] },
    });
    await oneServer.listen();
    oneStream = await openSSE(ONE_PORT);
    updateBaseUrl(`http://127.0.0.1:${String(ONE_PORT)}`);
    stream = oneStream;
    deliveredFrames = 0;
  });

  afterEach(async () => {
    await oneServer.close();
  });

  it('renders the badge unchanged, with no letters and no strip', async () => {
    renderRun();
    await until(() => screen.queryByTestId('run-target-status') !== null, 'the badge');

    const badge = screen.getByTestId('run-target-status');
    expect(badge.tagName).toBe('STRONG');
    expect(badge.textContent).toBe('hidden');
    expect(badge.parentElement?.textContent).toBe('Targets:hidden');
    expect(screen.queryByTestId('run-bank-A')).toBeNull();
    expect(screen.queryByTestId('run-target-group')).toBeNull();
    expect(screen.getByRole('button', { name: 'Toggle Targets' })).toBeTruthy();
  });
});
