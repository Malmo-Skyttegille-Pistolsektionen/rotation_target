// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18084" }
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
// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake (18080 useAdminStatus, 18081 audios, 18082 programs,
// 18083 program-editor, 18084 here). Pick the next free number for a new suite.
const PORT = 18084;

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

/**
 * Wait for the device to broadcast, *without* handing the frame on. Lets a
 * test choose the exact task the app learns about it in.
 */
async function awaitBroadcast(): Promise<void> {
  const seen = stream.frames.length;
  const deadline = Date.now() + 3000;
  while (stream.frames.length === seen) {
    await new Promise((resolve) => setImmediate(resolve));
    if (Date.now() >= deadline) throw new Error('the device never broadcast');
  }
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
  return screen.queryByTestId('run-start-notice')?.textContent ?? '';
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

    // Before #92 the expiring countdown started program 1 - the one the
    // operator never chose. The cancel is what keeps them from watching a
    // countdown that is already doomed; #95's id in the body is what makes it
    // safe even when they do.
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

  it('counts all the way down through stateUpdates that leave the program alone', async () => {
    await ready();
    await selectProgram(FALT.id);

    fakeCountdownTimer();
    await pressStart();

    // Toggling targets is a stateUpdate carrying the same loadedProgramId: it
    // must neither cancel the countdown nor restart its one-second timer. One
    // between every pair of ticks is the shape that used to hang the modal
    // forever, back when the effect depended on the react-query mutation
    // object and so re-ran - clearing the pending timeout - on every render.
    // A stateUpdate every 700 ms of device time, for twice as long as the
    // countdown lasts. The interval is the point: a timer that restarts on
    // each one gets a fresh full second every 700 ms and so never completes,
    // and the modal hangs on the same number for ever.
    const STEP_MS = 700;
    const steps = Math.ceil((2 * START_DELAY_SECONDS * 1000) / STEP_MS);
    for (let step = 0; step < steps && startedProgramId() === null; step++) {
      const before = screen.getByTestId('run-target-status').textContent;
      await requestElsewhere(PORT, 'POST', '/api/v2/targets/toggle');
      await until(() => screen.getByTestId('run-target-status').textContent !== before, 'the targets to flip');

      await act(async () => {
        vi.advanceTimersByTime(STEP_MS);
      });
    }

    await until(() => startedProgramId() !== null, 'the device to report the program running');
    expect(startedProgramId()).toBe(FALT.id);
  });
});

describe('#70: the last instant of the countdown', () => {
  it('does not start when the switch and the due timer land in the same task', async () => {
    await ready();
    await selectProgram(FALT.id);

    fakeCountdownTimer();
    await pressStart();

    // Down to the final second, device still on 40.
    for (let second = 1; second < START_DELAY_SECONDS; second++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(screen.getByText('Starting in...')).toBeTruthy();

    // The switch arrives, and the last tick comes due before React has been
    // re-rendered with it: react-query defers subscriber notification through
    // `notifyManager`, so the render-phase cancel has not run yet. The timer
    // callback therefore closes over a state that is already out of date -
    // which is why the start is decided against the cache, not the closure.
    await requestElsewhere(PORT, 'POST', `/api/v2/programs/${MILITARY.id}/load`);
    await awaitBroadcast();
    await act(async () => {
      deliverFrames();
      vi.advanceTimersByTime(1000);
    });
    await quiesce();

    expect(startedProgramId()).toBeNull();
    expect(startNotice()).toContain('cancelled');
  });

  it('does not start on state it can no longer trust, when the stream dropped', async () => {
    await ready();
    await selectProgram(FALT.id);

    fakeCountdownTimer();
    await pressStart();

    // `useSSE` parks 'error' and waits five seconds before reconnecting -
    // longer than a short start delay, so whatever we last heard may well be
    // out of date by the time the countdown expires.
    await act(async () => {
      FakeEventSource.latest.error();
    });

    await runCountdownOut();
    await quiesce();

    expect(startedProgramId()).toBeNull();
    expect(startNotice()).toContain('lost contact');
  });

  it('says the program was unloaded, not swapped, when the device ends up holding none', async () => {
    await ready();
    await selectProgram(UPLOADED.id);

    fakeCountdownTimer();
    await pressStart();

    // Deleting the loaded program unloads it, and the device publishes that.
    await requestElsewhere(PORT, 'DELETE', `/api/v2/programs/${UPLOADED.id}/delete`);
    await until(() => shownProgramId() === '-', 'the device to report nothing loaded');

    await runCountdownOut();
    await quiesce();

    expect(startedProgramId()).toBeNull();
    expect(startNotice()).toContain('unloaded');
  });
});

describe('#95: the device refuses a start for a program it no longer holds', () => {
  /**
   * The window no client-side check can close: another client has loaded a
   * different program and the `stateUpdate` saying so has not reached this page
   * yet, so every guard in the view is satisfied and the start goes out anyway.
   * Held back deliberately here; on a range it is just latency.
   */
  async function switchProgramBehindThePage(): Promise<void> {
    await requestElsewhere(PORT, 'POST', `/api/v2/programs/${MILITARY.id}/load`);
    await awaitBroadcast();
  }

  it('answers 409 and the page shows the device sentence, naming both programs', async () => {
    localStorage.setItem('rt_settings_start_delay_seconds', '0');
    await ready();
    await selectProgram(FALT.id);

    await switchProgramBehindThePage();
    // The page still believes 40 is loaded - which is why its own guards pass.
    expect(shownProgramId()).toBe(String(FALT.id));

    await pressStart();
    await until(() => startNotice().includes('Start refused'), 'the device refusal to reach the page');

    expect(startNotice()).toContain(`program ${MILITARY.id} loaded`);
    expect(startNotice()).toContain(`not program ${FALT.id}`);
  });

  it('and nothing runs: the refusal is the device\'s, not the browser\'s', async () => {
    localStorage.setItem('rt_settings_start_delay_seconds', '0');
    await ready();
    await selectProgram(FALT.id);

    await switchProgramBehindThePage();
    await pressStart();
    await quiesce();

    // Neither program started - not the one that was armed, and not the one
    // the device happened to be holding.
    expect(startedProgramId()).toBeNull();
  });

  it('sends the armed id, so the same press starts the program that is loaded', async () => {
    localStorage.setItem('rt_settings_start_delay_seconds', '0');
    await ready();
    await selectProgram(MILITARY.id);

    await pressStart();
    await until(() => startedProgramId() !== null, 'the device to report the program running');

    expect(startedProgramId()).toBe(MILITARY.id);
    expect(startNotice()).toBe('');
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

  it('releases Start when the answer arrives coalesced with a later switch', async () => {
    await ready();
    await selectProgram(MILITARY.id);

    await act(async () => {
      fireEvent.change(programSelect(), { target: { value: String(FALT.id) } });
    });
    expect(startButton().disabled).toBe(true);

    // The device loads 40, then another client loads 140 - and both frames
    // reach the app in one task, so it never renders with 40 loaded. Waiting
    // for the picked id to show up exactly would wedge Start off for good.
    await awaitBroadcast();
    await requestElsewhere(PORT, 'POST', `/api/v2/programs/${UPLOADED.id}/load`);
    await awaitBroadcast();
    await act(async () => {
      deliverFrames();
    });
    await quiesce();

    expect(shownProgramId()).toBe(String(UPLOADED.id));
    expect(programSelect().value).toBe(String(UPLOADED.id));
    expect(startButton().disabled).toBe(false);
  });

  it('releases Start when the pick is the program already loaded', async () => {
    await ready();
    await selectProgram(FALT.id);

    // Picking the loaded program again still fires a change event - React
    // routes every `change` on a `<select>` to onChange, whether or not the
    // value moved, so the device answers with the id it already had. Waiting
    // for it to report something *different* holds Start off for ever, which
    // is what QEMU caught: the E2E spec re-selects the loaded program.
    await act(async () => {
      fireEvent.change(programSelect(), { target: { value: String(FALT.id) } });
    });
    await until(() => !startButton().disabled, 'Start to come back');

    expect(shownProgramId()).toBe(String(FALT.id));
    expect(programSelect().value).toBe(String(FALT.id));
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

describe('D-22: unloading from the run controls', () => {
  /** The control D-22 added: clears the device's loaded program without loading another. */
  function unloadButton(): HTMLButtonElement {
    return screen.getByTestId('run-unload') as HTMLButtonElement;
  }

  it('is offered only once the device says something is loaded', async () => {
    await ready();
    expect(unloadButton().disabled).toBe(true);

    await selectProgram(FALT.id);
    expect(unloadButton().disabled).toBe(false);
  });

  it('clears the selection, and the view follows the device rather than itself', async () => {
    await ready();
    await selectProgram(FALT.id);

    await act(async () => {
      fireEvent.click(unloadButton());
    });
    // Nothing is optimistic: the badge only clears because the device
    // published `loadedProgramId: null`.
    await until(() => shownProgramId() === '-', 'the device to report nothing loaded');

    expect(programSelect().value).toBe('');
    expect(startButton().disabled).toBe(true);
    expect(startNotice()).toContain('Nothing is loaded');
  });

  it('cancels a start-delay countdown, since unloading is what it was armed against', async () => {
    await ready();
    await selectProgram(FALT.id);

    fakeCountdownTimer();
    await pressStart();
    expect(screen.getByText('Starting in...')).toBeTruthy();

    await act(async () => {
      fireEvent.click(unloadButton());
    });
    await until(() => shownProgramId() === '-', 'the device to report nothing loaded');

    // The render-phase guard above already covered a *device-side* unload
    // (deleting the loaded program); D-22's button is the first way from
    // inside this page, and it must not leave a countdown running towards a
    // start for a program that is no longer there.
    expect(screen.queryByText('Starting in...')).toBeNull();
    await runCountdownOut();
    await quiesce();

    expect(startedProgramId()).toBeNull();
    // The unload's own 200 does not talk over this: a cancelled countdown is
    // the half the operator cannot see for themselves.
    expect(startNotice()).toContain('the device unloaded the program during the countdown');
  });

  it('refuses mid-run, says to stop first, and leaves the run alone', async () => {
    await ready();
    await selectProgram(FALT.id);

    await pressStart();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start Now' }));
    });
    await until(
      () => screen.queryByRole('button', { name: 'Pause' }) !== null,
      'the device to report the program running',
    );

    await act(async () => {
      fireEvent.click(unloadButton());
    });
    await waitFor(() => expect(startNotice()).toContain('Pause the run first'));

    // The series is still going: unloading is bookkeeping and must not end it.
    expect(shownProgramId()).toBe(String(FALT.id));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();

    // And the escape really is one button away.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    });
    await until(() => screen.queryByRole('button', { name: 'Start' }) !== null, 'the run to pause');
    await act(async () => {
      fireEvent.click(unloadButton());
    });
    await until(() => shownProgramId() === '-', 'the device to report nothing loaded');
  });
});

describe('D-24: the library changes under an open page', () => {
  /** GETs of the program list, as seen on the wire. */
  function listFetches(spy: { mock: { calls: unknown[][] } }): number {
    return spy.mock.calls.filter(
      (call) =>
        String(call[0]).endsWith('/api/v2/programs') && (call[1] as RequestInit | undefined)?.method === undefined,
    ).length;
  }

  it("shows another client's upload without anybody reloading the page", async () => {
    await ready();
    expect(programSelect().options.length).toBe(4);

    // The laptop at the other end of the range uploads a program. Before
    // `libraryChanged` this phone kept showing three until it was reloaded.
    await requestElsewhere(PORT, 'POST', '/api/v2/programs', {
      title: 'Ny klubbserie',
      description: 'from the other client',
      series: [{ name: 'Serie 1', optional: false, events: [{ duration: 1000, command: 'show' }] }],
    });

    await until(() => programSelect().options.length === 5, 'the picker to gain the uploaded program');
    expect(programSelect().textContent).toContain('Ny klubbserie');
  });

  it('refetches nothing when the device only changes what it is doing', async () => {
    await ready();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // Load, start, pause, unload: four mutations, four stateUpdates, and no
    // reason to re-read a list that did not change.
    await selectProgram(FALT.id);
    await pressStart();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start Now' }));
    });
    await until(
      () => screen.queryByRole('button', { name: 'Pause' }) !== null,
      'the device to report the program running',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    });
    await until(() => screen.queryByRole('button', { name: 'Start' }) !== null, 'the run to pause');
    await act(async () => {
      fireEvent.click(screen.getByTestId('run-unload'));
    });
    await until(() => shownProgramId() === '-', 'the device to report nothing loaded');
    await quiesce();

    expect(listFetches(fetchSpy)).toBe(0);
    expect(stream.frames.filter((frame) => frame.event === 'libraryChanged')).toHaveLength(0);
  });
});
