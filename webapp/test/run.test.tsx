// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18083" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { updateBaseUrl } from '../src/api/client';
import { SettingsProvider } from '../src/context/SettingsContext';
import { useSSE } from '../src/hooks/useSSE';
import type { Program, StateUpdatePayload } from '../src/api/types';
import { RunView } from '../src/routes/run';
import { FakeEventSource } from './fake-event-source';
import { PROGRAM_FALT_TRANING, PROGRAM_MILITARY_SNABBMATCH } from './fixtures';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { openSSE, type SSEReader } from './mock-server/sse-reader';
import { requestElsewhere } from './other-client';

// Distinct per suite: vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake (18080 useAdminStatus, 18081 audios, 18082 programs).
const PORT = 18083;

/** The two programs of issue #70, under the ids the device gives them. */
const MILITARY: Program = { ...PROGRAM_MILITARY_SNABBMATCH, id: 1 };
const FALT: Program = { ...PROGRAM_FALT_TRANING, id: 40 };
/** An uploaded one, so a test can have it deleted out from under the list. */
const UPLOADED: Program = { ...PROGRAM_FALT_TRANING, id: 140, title: 'Klubbserie', readonly: false };

const START_DELAY_SECONDS = 10;

let server: MockServer;
let queryClient: QueryClient;

/** The device's own stream, read over HTTP as a second client would read it. */
let stream: SSEReader;
/** How many of `stream.frames` have been handed to the app's EventSource. */
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

/**
 * One turn of node's IO, then every frame the device has broadcast since the
 * last turn, handed to the app's stream. The payloads are the mock's own, so
 * no test can invent a device state the device would never publish.
 *
 * `setImmediate` rather than a timeout, because the countdown tests fake
 * `setTimeout` and the sockets underneath still have to run. React's scheduler
 * falls back to `setTimeout(0)` in this environment, so a zero-length advance
 * lets a render through without moving the countdown.
 */
async function pump(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) vi.advanceTimersByTime(0);
    await new Promise((resolve) => setImmediate(resolve));
    while (deliveredFrames < stream.frames.length) {
      const frame = stream.frames[deliveredFrames++];
      FakeEventSource.latest.emit(frame.event, frame.data);
    }
  });
}

/** Pump until the device and the app agree with `condition`. */
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

/** What the operator reads off the badge. */
function shownProgramId(): string | null {
  return screen.getByTestId('run-program-id').textContent;
}

function programSelect(): HTMLSelectElement {
  return screen.getByTestId('run-program-select') as HTMLSelectElement;
}

function startButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement;
}

function startNotice(): string {
  return screen.getByTestId('run-start-notice').textContent ?? '';
}

/** The id in the first `stateUpdate` the device published with the program running. */
function startedProgramId(): number | null {
  const started = stream
    .payloads<StateUpdatePayload>('stateUpdate')
    .find((payload) => payload.programState?.running === true);
  return started ? (started.loadedProgramId ?? null) : null;
}

/** Pick a program in the dropdown the way a person does, and let the device confirm it. */
async function selectProgram(id: number): Promise<void> {
  await act(async () => {
    fireEvent.change(programSelect(), { target: { value: String(id) } });
  });
  await until(() => shownProgramId() === String(id), `the device to report program ${id} loaded`);
}

beforeAll(async () => {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: {
      programs: { [MILITARY.id]: MILITARY, [FALT.id]: FALT, [UPLOADED.id]: UPLOADED },
      audios: [],
    },
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
  localStorage.setItem('rt_settings_start_delay_seconds', String(START_DELAY_SECONDS));
  document.cookie = 'admin=; Path=/; Max-Age=0';
  updateBaseUrl(window.location.origin);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // The connection outlives the suite and `reset()` does not broadcast, so the
  // stream's history - the record each test asserts on - restarts here.
  await new Promise((resolve) => setImmediate(resolve));
  stream.frames.length = 0;
  deliveredFrames = 0;
});

afterEach(async () => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Mount the view, open its stream and wait for the programs list. */
async function ready(): Promise<void> {
  renderRun();
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
  act(() => FakeEventSource.latest.open());
  await waitFor(() => expect(programSelect().options.length).toBe(4));
}

/**
 * Fake `setTimeout` only. The countdown is the one thing in the view that runs
 * on a timer; node's sockets have to keep running, so nothing else is faked.
 */
function fakeCountdownTimer(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

async function pressStart(): Promise<void> {
  await act(async () => {
    fireEvent.click(startButton());
  });
}

/**
 * Run the countdown past zero. One `advanceTimersByTime` per second, each in
 * its own `act`: the view schedules the next tick from an effect, which does
 * not run until React has flushed the state change the previous tick made.
 */
async function runCountdownOut(): Promise<void> {
  for (let second = 0; second <= START_DELAY_SECONDS; second++) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  }
}

describe('the run view starts the program the device says is loaded', () => {
  it('sends start for the confirmed program after select, load and SSE confirmation', async () => {
    await ready();
    await selectProgram(FALT.id);

    await pressStart();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start Now' }));
    });
    await until(() => startedProgramId() !== null, 'the device to report the program running');

    expect(startedProgramId()).toBe(FALT.id);
  });

  it('drives the badge, the select and the timeline off that same loadedProgramId', async () => {
    await ready();
    await selectProgram(FALT.id);

    await waitFor(() => expect(screen.getByTestId('timeline').textContent).toContain(FALT.series[0].name));
    expect(shownProgramId()).toBe(String(FALT.id));
    expect(programSelect().value).toBe(String(FALT.id));
  });
});

describe('#70: the loaded program changes while the start-delay countdown runs', () => {
  it('aborts the countdown instead of starting whatever is loaded when it expires', async () => {
    await ready();
    await selectProgram(FALT.id);

    fakeCountdownTimer();
    await pressStart();
    expect(screen.getByText('Starting in...')).toBeTruthy();

    // Somebody else - a second tab, a phone on the range - loads program 1
    // during the countdown. The device publishes it and the page behind the
    // modal follows: the "Militär Snabbmatch (Loaded) / Program ID: 1" of #70.
    await requestElsewhere(PORT, 'POST', `/api/v2/programs/${MILITARY.id}/load`);
    await until(() => shownProgramId() === String(MILITARY.id), 'the device to report program 1 loaded');

    // `POST /programs/start` carries no id, so before the fix the expiring
    // countdown started program 1 - the one the operator never chose.
    await runCountdownOut();
    await quiesce();

    expect(startedProgramId()).toBeNull();
    expect(screen.queryByText('Starting in...')).toBeNull();
    expect(startNotice()).toContain('cancelled');
  });

  it('takes the countdown away rather than leaving a Start Now that would run the new program', async () => {
    await ready();
    await selectProgram(FALT.id);

    fakeCountdownTimer();
    await pressStart();

    await requestElsewhere(PORT, 'POST', `/api/v2/programs/${MILITARY.id}/load`);
    await until(() => shownProgramId() === String(MILITARY.id), 'the device to report program 1 loaded');

    // No modal left to press: the operator has to look at the page and choose
    // again, which is the whole point.
    expect(screen.queryByRole('button', { name: 'Start Now' })).toBeNull();
    await quiesce();
    expect(startedProgramId()).toBeNull();
  });

  it('cancels just the same when the switch comes from this page, as in the report', async () => {
    await ready();
    await selectProgram(FALT.id);

    fakeCountdownTimer();
    await pressStart();

    // The report's own steps: the interaction came from automation, which
    // dispatched a change straight at the select. A person cannot reach it -
    // `dialog.showModal()` makes the page behind the modal inert - but the
    // device ends up in the same place either way, so the UI has to.
    await act(async () => {
      fireEvent.change(programSelect(), { target: { value: String(MILITARY.id) } });
    });
    await until(() => shownProgramId() === String(MILITARY.id), 'the device to report program 1 loaded');

    await runCountdownOut();
    await quiesce();

    expect(startedProgramId()).toBeNull();
    expect(startNotice()).toContain('cancelled');
  });

  it('keeps counting down when the device reports a change other than the program', async () => {
    await ready();
    await selectProgram(FALT.id);

    fakeCountdownTimer();
    await pressStart();

    // Toggling targets is a stateUpdate carrying the same loadedProgramId. It
    // must not abort the countdown - only a program switch does.
    await requestElsewhere(PORT, 'POST', '/api/v2/targets/toggle');
    await until(() => screen.getByTestId('run-target-status').textContent === 'shown', 'the targets to show');
    expect(screen.getByText('Starting in...')).toBeTruthy();

    await runCountdownOut();
    await until(() => startedProgramId() !== null, 'the device to report the program running');

    expect(startedProgramId()).toBe(FALT.id);
  });
});

describe('#70: the window between picking a program and the device confirming it', () => {
  it('holds Start until the pick is confirmed, so it cannot start the previous program', async () => {
    await ready();
    await selectProgram(MILITARY.id);

    // The operator picks 40. The POST is in flight and no stateUpdate has
    // arrived, so the device still holds program 1: a Start here would run
    // program 1 while the operator is looking at their new pick.
    await act(async () => {
      fireEvent.change(programSelect(), { target: { value: String(FALT.id) } });
    });

    expect(programSelect().value).toBe(String(FALT.id));
    expect(shownProgramId()).toBe(String(MILITARY.id));
    expect(startButton().disabled).toBe(true);

    await until(() => shownProgramId() === String(FALT.id), 'the device to confirm program 40');
    expect(startButton().disabled).toBe(false);
  });

  it('releases Start again, with the reason, when the device refuses the load', async () => {
    await ready();
    await selectProgram(FALT.id);

    // Another client deletes the uploaded program this page still lists, so
    // the load comes back 404 and the device keeps program 40.
    await requestElsewhere(PORT, 'DELETE', `/api/v2/programs/${UPLOADED.id}/delete`);
    await act(async () => {
      fireEvent.change(programSelect(), { target: { value: String(UPLOADED.id) } });
    });
    await until(() => screen.queryByTestId('run-start-notice') !== null, 'the failure to be reported');

    expect(startNotice()).toContain('Klubbserie');
    expect(shownProgramId()).toBe(String(FALT.id));
    expect(programSelect().value).toBe(String(FALT.id));
    expect(startButton().disabled).toBe(false);
  });
});
