// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real - the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18086" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { updateBaseUrl } from '../src/api/client';
import { SettingsProvider } from '../src/context/SettingsContext';
import { StartDelayControl } from '../src/components/StartDelayControl';
import { StartDelaySection } from '../src/components/StartDelaySection';
import { useSSE } from '../src/hooks/useSSE';
import type { Program, StateUpdatePayload } from '../src/api/types';
import { RunView } from '../src/routes/run';
import { FakeEventSource } from './fake-event-source';
import { PROGRAM_FALT_TRANING } from './fixtures';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { openSSE, type SSEReader } from './mock-server/sse-reader';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake (18080 useAdminStatus, 18081 audios, 18082 programs,
// 18083 program-editor, 18084 run, 18085 startup-issues, 18086 here).
// Pick the next free number for a new suite.
const PORT = 18086;

const STORAGE_KEY = 'rt_settings_start_delay_seconds';
const FALT: Program = { ...PROGRAM_FALT_TRANING, id: 40 };

let server: MockServer;
let queryClient: QueryClient;
let stream: SSEReader;
let deliveredFrames = 0;

function delayInput(): HTMLInputElement {
  return screen.getByTestId('run-start-delay') as HTMLInputElement;
}

function delayUnit(): string {
  return screen.getByTestId('run-start-delay-unit').textContent ?? '';
}

function settingsInput(): HTMLInputElement {
  return screen.getByTestId('settings-start-delay') as HTMLInputElement;
}

function stored(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Type into a number field the way the browser reports it. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
}

async function blur(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    fireEvent.blur(input);
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

describe('the start delay is one setting with two editors', () => {
  /** The run control and the settings section, side by side under one provider. */
  function renderBoth(): void {
    render(
      <SettingsProvider>
        <StartDelayControl />
        <StartDelaySection />
      </SettingsProvider>,
    );
  }

  it('shows the stored value on the run control', () => {
    localStorage.setItem(STORAGE_KEY, '7');
    renderBoth();

    expect(delayInput().value).toBe('7');
    expect(settingsInput().value).toBe('7');
  });

  it('shows the default when nothing is stored', () => {
    renderBoth();
    expect(delayInput().value).toBe('10');
  });

  it('persists an edit made on the run page and shows it in the settings section', async () => {
    renderBoth();

    await type(delayInput(), '25');

    expect(stored()).toBe('25');
    // No Save on the run page, and no navigation: the settings section is
    // reading the same context value.
    expect(settingsInput().value).toBe('25');
  });

  it('shows an edit saved in the settings section on the run control', async () => {
    renderBoth();

    await type(settingsInput(), '3');
    // Settings keeps its explicit Save, so nothing has moved yet.
    expect(delayInput().value).toBe('10');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(stored()).toBe('3');
    expect(delayInput().value).toBe('3');
  });

  it('follows the same key changed in another tab', async () => {
    renderBoth();

    await act(async () => {
      localStorage.setItem(STORAGE_KEY, '42');
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: '42' }));
    });

    expect(delayInput().value).toBe('42');
    expect(settingsInput().value).toBe('42');
  });

  it('clamps to the advertised 0-60 range, whichever editor is used', async () => {
    renderBoth();

    await type(delayInput(), '99');
    expect(stored()).toBe('60');
    await blur(delayInput());
    expect(delayInput().value).toBe('60');

    await type(delayInput(), '-5');
    expect(stored()).toBe('0');
  });

  it('keeps a half-typed field editable without writing rubbish', async () => {
    renderBoth();

    // `type=number` reports '' for a cleared field. Clearing it to type a new
    // number must not be read as 0 - the one value that means "no countdown".
    await type(delayInput(), '');
    expect(delayInput().value).toBe('');
    expect(stored()).toBeNull();

    await blur(delayInput());
    expect(delayInput().value).toBe('10');
  });
});

// --- 0 is a value, and it says so ------------------------------------------

describe('0 means no countdown, in both places', () => {
  it('round-trips 0 and labels it, on the run control and in settings', async () => {
    render(
      <SettingsProvider>
        <StartDelayControl />
        <StartDelaySection />
      </SettingsProvider>,
    );

    await type(delayInput(), '0');

    expect(stored()).toBe('0');
    expect(delayUnit()).toContain('no delay');
    expect(delayUnit()).toContain('at once');
    expect(screen.getByTestId('settings-start-delay-immediate').textContent).toContain('at once');
    expect(settingsInput().value).toBe('0');
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
    await ready(4);
    await pressStart();

    expect(screen.getByText('Starting in...')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
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
    await ready(3);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await pressStart();

    // The modal makes the page behind it inert, and the control says so.
    expect(delayInput().disabled).toBe(true);

    // Another tab moves the setting to a minute. The countdown captured 3 s
    // when Start was pressed and is not renegotiating it.
    await act(async () => {
      localStorage.setItem(STORAGE_KEY, '60');
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: '60' }));
    });

    for (let second = 0; second <= 3; second++) {
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
    await type(delayInput(), '8');
    expect(stored()).toBe('8');
    await quiesce(50);
  });
});
