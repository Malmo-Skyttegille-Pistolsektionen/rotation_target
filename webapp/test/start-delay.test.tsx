// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real - the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18090" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { updateBaseUrl } from '../src/api/client';
import { SettingsProvider } from '../src/context/SettingsContext';
import { StartDelayControl } from '../src/components/StartDelayControl';
import { useSSE } from '../src/hooks/useSSE';
import type { Program, StateUpdatePayload } from '../src/api/types';
import { RunView } from '../src/routes/run';
import { FakeEventSource } from './fake-event-source';
import { PROGRAM_FALT_TRANING } from './fixtures';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { openSSE, type SSEReader } from './mock-server/sse-reader';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake. This suite and about-section.test.tsx both claimed 18086
// and intermittently killed each other; whichever bound second failed all four
// of its tests with a message naming neither file. Moved here rather than
// there because about-section's number is written into three comments
// elsewhere.
//
// Taken: 18080 useAdminStatus, 18081 audios, 18082 programs, 18083
// program-editor, 18084 run, 18085 startup-issues, 18086 about-section,
// 18087, 18088, 18089, 18090 here, 18092 hardware-section, 18097 config-window.
// Pick a free number for a new suite, and grep before you do.
const PORT = 18090;

const STORAGE_KEY = 'rt_settings_start_delay_seconds';
const FALT: Program = { ...PROGRAM_FALT_TRANING, id: 40 };

let server: MockServer;
let queryClient: QueryClient;
let stream: SSEReader;
let deliveredFrames = 0;

function delayInput(): HTMLSelectElement {
  return screen.getByTestId('run-start-delay') as HTMLSelectElement;
}

function delayUnit(): string {
  return screen.getByTestId('run-start-delay-unit').textContent ?? '';
}

function stored(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Type into a number field the way the browser reports it. */
async function type(input: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
}

beforeAll(async () => {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: { [FALT.id]: FALT }, audios: [] },
  });
  await server.listen();
  stream = await openSSE(PORT);
});

afterAll(async () => {
  stream.close();
  await server.close();
});

beforeEach(async () => {
  FakeEventSource.reset();
  server.reset();
  localStorage.clear();
  document.cookie = 'admin=; Path=/; Max-Age=0';
  updateBaseUrl(window.location.origin);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  await new Promise((resolve) => setImmediate(resolve));
  stream.frames.length = 0;
  deliveredFrames = 0;
});

afterEach(() => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// --- the setting is one value, wherever it is edited -----------------------

// One editor now: the Settings page's copy was removed as duplication - the
// delay is a run-page control and that is where it is set.
describe('the start delay', () => {
  function renderBoth(): void {
    render(
      <SettingsProvider>
        <StartDelayControl />
      </SettingsProvider>,
    );
  }

  it('shows the stored value on the run control', () => {
    localStorage.setItem(STORAGE_KEY, '15');
    renderBoth();

    expect(delayInput().value).toBe('15');
  });

  // A browser that stored a value off the ladder before #195 - anything a
  // number field allowed - has to read back as something the dropdown can
  // select, or the control renders empty and the setting is unreachable.
  it('snaps a stored value that is not on the ladder to the nearest one', () => {
    localStorage.setItem(STORAGE_KEY, '7');
    renderBoth();

    expect(delayInput().value).toBe('5');
  });

  it('shows the default when nothing is stored', () => {
    renderBoth();
    expect(delayInput().value).toBe('10');
  });

  // A select commits a whole value, so the write is immediate - there is no
  // Save anywhere for this setting any more.
  it('persists an edit made on the run page at once, with no Save', async () => {
    renderBoth();

    await type(delayInput(), '25');

    expect(stored()).toBe('25');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('follows the same key changed in another tab', async () => {
    renderBoth();

    await act(async () => {
      localStorage.setItem(STORAGE_KEY, '40');
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: '40' }));
    });

    expect(delayInput().value).toBe('40');
  });

  // Out-of-range values are no longer reachable through the UI, but another
  // tab and an older build both still write straight to the key.
  it('clamps a stored value outside 0-60, whichever editor reads it', async () => {
    localStorage.setItem(STORAGE_KEY, '99');
    renderBoth();
    expect(delayInput().value).toBe('60');
    cleanup();

    localStorage.setItem(STORAGE_KEY, '-5');
    renderBoth();
    expect(delayInput().value).toBe('0');
  });

  it('offers no delay, then 5 s to 60 s, and nothing between', () => {
    renderBoth();

    const offered = Array.from(delayInput().options).map((option) => option.value);
    expect(offered).toEqual(['0', '5', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', '60']);
    expect(delayInput().options[0].textContent).toBe('No delay');
  });
});

// --- 0 is a value, and it says so ------------------------------------------

describe('0 means no countdown, and says so', () => {
  it('round-trips 0 and labels it on the run control', async () => {
    render(
      <SettingsProvider>
        <StartDelayControl />
      </SettingsProvider>,
    );

    await type(delayInput(), '0');

    expect(stored()).toBe('0');
    expect(delayUnit()).toContain('no delay');
    expect(delayUnit()).toContain('at once');
    expect(delayInput().value).toBe('0');
  });

  it('says seconds, not "no delay", for any non-zero value', async () => {
    render(
      <SettingsProvider>
        <StartDelayControl />
      </SettingsProvider>,
    );

    expect(delayUnit()).toBe('seconds');
    await type(delayInput(), '0');
    expect(delayUnit()).toContain('no delay');
    await type(delayInput(), '5');
    expect(delayUnit()).toBe('seconds');
  });

  it('is what a stored 0 reads back as, rather than the old 1-second floor', () => {
    localStorage.setItem(STORAGE_KEY, '0');
    render(
      <SettingsProvider>
        <StartDelayControl />
      </SettingsProvider>,
    );

    expect(delayInput().value).toBe('0');
    expect(delayUnit()).toContain('no delay');
  });
});

// --- and what Start then does ----------------------------------------------

describe('the run page starts on the delay it was set to', () => {
  function Harness(): React.ReactNode {
    useSSE();
    return <RunView />;
  }

  function deliverFrames(): void {
    while (deliveredFrames < stream.frames.length) {
      const frame = stream.frames[deliveredFrames++];
      FakeEventSource.latest.emit(frame.event, frame.data);
    }
  }

  async function pump(): Promise<void> {
    await act(async () => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(0);
      await new Promise((resolve) => setImmediate(resolve));
      deliverFrames();
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

  /** Give the device and the app every chance to act, for asserting that neither did. */
  async function quiesce(ms = 200): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) await pump();
  }

  function programSelect(): HTMLSelectElement {
    return screen.getByTestId('run-program-select') as HTMLSelectElement;
  }

  function startedProgramId(): number | null {
    const started = stream
      .payloads<StateUpdatePayload>('stateUpdate')
      .find((payload) => payload.programState?.running === true);
    return started ? (started.loadedProgramId ?? null) : null;
  }

  /** Mount the view with `seconds` already stored, and load the program. */
  async function ready(seconds: number): Promise<void> {
    localStorage.setItem(STORAGE_KEY, String(seconds));
    render(
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <Harness />
        </SettingsProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    act(() => FakeEventSource.latest.open());
    await waitFor(() => expect(programSelect().options.length).toBe(2));

    await act(async () => {
      fireEvent.change(programSelect(), { target: { value: String(FALT.id) } });
    });
    await until(
      () => screen.getByTestId('run-program-id').textContent === String(FALT.id),
      'the device to report the program loaded',
    );
  }

  async function pressStart(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    });
  }

  it('is on the run page, beside Start', async () => {
    await ready(10);

    expect(delayInput().value).toBe('10');
    // Same control row as the button it governs.
    const actions = screen.getByRole('button', { name: 'Start' }).parentElement;
    expect(actions?.contains(delayInput())).toBe(true);
  });

  it('opens the countdown for a non-zero delay', async () => {
    await ready(5);
    await pressStart();

    expect(screen.getByText('Starting in...')).toBeTruthy();
    // By testid, not by text: the delay ladder now offers a <option>5</option>
    // on the page behind the modal.
    expect(screen.getByTestId('countdown-seconds').textContent).toBe('5');
  });

  it('starts at once, with no countdown, when the delay is 0', async () => {
    await ready(0);
    expect(delayUnit()).toContain('no delay');

    await pressStart();
    expect(screen.queryByText('Starting in...')).toBeNull();

    await until(() => startedProgramId() !== null, 'the device to report the program running');
    expect(startedProgramId()).toBe(FALT.id);
  });

  it('starts at once after the delay is set to 0 on the run page itself', async () => {
    await ready(10);
    await type(delayInput(), '0');

    await pressStart();
    expect(screen.queryByText('Starting in...')).toBeNull();
    await until(() => startedProgramId() !== null, 'the device to report the program running');
  });

  it('freezes the control while a countdown runs, and counts out the length it was pressed on', async () => {
    await ready(5);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await pressStart();

    // The modal makes the page behind it inert, and the control says so.
    expect(delayInput().disabled).toBe(true);

    // Another tab moves the setting to a minute. The countdown captured 5 s
    // when Start was pressed and is not renegotiating it.
    await act(async () => {
      localStorage.setItem(STORAGE_KEY, '60');
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: '60' }));
    });

    for (let second = 0; second <= 5; second++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    await until(() => startedProgramId() !== null, 'the device to report the program running');

    // ...and the next start is the new value's.
    expect(screen.queryByText('Starting in...')).toBeNull();
    expect(delayInput().disabled).toBe(false);
    expect(delayInput().value).toBe('60');
  });

  it('leaves the control editable while a program runs, for the next start', async () => {
    await ready(0);
    await pressStart();
    await until(
      () => screen.queryByRole('button', { name: 'Pause' }) !== null,
      'the device to report the program running',
    );

    expect(delayInput().disabled).toBe(false);
    await type(delayInput(), '10');
    expect(stored()).toBe('10');
    await quiesce(50);
  });
});
