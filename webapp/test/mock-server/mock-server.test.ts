import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StateUpdatePayload } from '../../src/api/types';
import { PROGRAM_FALT_TRANING } from '../fixtures';
import { createFakeClock, type FakeClock } from './clock';
import { createMockServer, loadSeedFromDisk, type MockServer } from './server';
import { flushIO, openSSE, type SSEReader } from './sse-reader';

/** The app's tsconfig targets ES2020, so no `Array.prototype.at`. */
function last<T>(items: T[]): T {
  return items[items.length - 1];
}

// Fältträning series 1 is 28 s of wall clock on the dev server. Every
// simulated second below costs microseconds instead, which is the whole point
// of the clock seam.
const FALT_SERIES_MS = 28000;

let clock: FakeClock;
let server: MockServer;
let base: string;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, init);
}

beforeEach(async () => {
  clock = createFakeClock(1_000_000);
  server = createMockServer({ clock, seed: { programs: { 40: PROGRAM_FALT_TRANING }, audios: [] } });
  base = `http://127.0.0.1:${await server.listen()}/api/v2`;
});

afterEach(async () => {
  await server.close();
});

describe('REST surface', () => {
  it('lists programs as summaries, without the series payload', async () => {
    const res = await api('/programs');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 40, title: 'Fältträning', description: expect.any(String), readonly: true },
    ]);
  });

  it('serves the full program by id and 404s an unknown one', async () => {
    const program = await (await api('/programs/40')).json();
    expect(program.series).toHaveLength(PROGRAM_FALT_TRANING.series.length);
    expect((await api('/programs/999')).status).toBe(404);
  });

  it('rejects a start with no program loaded', async () => {
    const res = await api('/programs/start', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No program loaded' });
  });

  it('bounds-checks skip_to', async () => {
    await api('/programs/40/load', { method: 'POST' });
    expect((await api('/programs/series/1/skip_to', { method: 'POST' })).status).toBe(200);
    expect((await api('/programs/series/99/skip_to', { method: 'POST' })).status).toBe(400);
  });

  it('gates writes on a token once admin mode is enabled', async () => {
    const { token } = await (
      await api('/admin-mode/enable', { method: 'POST', body: JSON.stringify({ password: 'range-2026' }) })
    ).json();

    expect((await api('/admin-mode/status')).status).toBe(200);
    expect((await api('/programs')).status).toBe(200);
    expect((await api('/programs/40/load', { method: 'POST' })).status).toBe(401);
    expect(
      (await api('/programs/40/load', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(200);
  });
});

describe('simulation on a fake clock', () => {
  let sse: SSEReader;

  beforeEach(async () => {
    sse = await openSSE(server.port);
    await flushIO();
  });

  afterEach(() => sse.close());

  it('sends the full state on connect', async () => {
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')[0]).toEqual({
      loadedProgramId: null,
      programState: null,
      targetStatus: 'hidden',
    });
  });

  it('walks the whole 28 s series, event by event, in no real time', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await api('/programs/start', { method: 'POST' });
    await flushIO();

    clock.advance(FALT_SERIES_MS);
    await flushIO();

    const updates = sse.payloads<StateUpdatePayload>('stateUpdate');
    const running = updates.filter((u) => u.programState?.running);

    // A stateUpdate for every whole second of the series (the load and start
    // frames plus 27 ticks; the 28 s tick completes it instead).
    expect(running.map((u) => u.programState!.tickerSeconds)).toEqual(Array.from({ length: 28 }, (_, i) => i));

    // Targets follow the events: hidden for 10 s, then alternating 3 s.
    const shownAt = running.filter((u) => u.targetStatus === 'shown').map((u) => u.programState!.tickerSeconds);
    expect(shownAt).toEqual([10, 11, 12, 16, 17, 18, 22, 23, 24]);

    // Event index is derived, not counted.
    expect(running.find((u) => u.programState!.tickerSeconds === 17)!.programState!.currentEventIndex).toBe(3);
  });

  it('pauses at the start of the next series when one completes', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await api('/programs/start', { method: 'POST' });
    clock.advance(FALT_SERIES_MS);
    await flushIO();

    const completed = last(sse.payloads<StateUpdatePayload>('stateUpdate'));
    expect(completed.programState).toEqual({
      running: false,
      currentSeriesIndex: 1,
      currentEventIndex: 0,
      tickerSeconds: null,
    });
    expect(completed.targetStatus).toBe('hidden');
  });

  it('stop pauses and start resumes from the same second', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await api('/programs/start', { method: 'POST' });
    clock.advance(12_000);
    await api('/programs/stop', { method: 'POST' });
    await flushIO();

    const paused = last(sse.payloads<StateUpdatePayload>('stateUpdate'));
    expect(paused.programState).toMatchObject({ running: false, tickerSeconds: 12, currentEventIndex: 1 });

    // Time passing while paused must not move the run on.
    clock.advance(60_000);
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState!.tickerSeconds).toBe(12);

    await api('/programs/start', { method: 'POST' });
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState).toMatchObject({
      running: true,
      tickerSeconds: 12,
      currentEventIndex: 1,
    });
  });

  it('reset rewinds to the top of the series', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await api('/programs/start', { method: 'POST' });
    clock.advance(12_000);
    await api('/programs/stop', { method: 'POST' });
    await api('/programs/reset', { method: 'POST' });
    await flushIO();

    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState).toEqual({
      running: false,
      currentSeriesIndex: 0,
      currentEventIndex: 0,
      tickerSeconds: null,
    });
  });

  it('heartbeats on the 10 s cadence, off the same clock', async () => {
    clock.advance(35_000);
    await flushIO();
    expect(sse.payloads<{ id: number }>('heartbeat').map((h) => h.id)).toEqual([1, 2, 3]);
  });
});

describe('disk seed', () => {
  it('exposes uploaded audio under the firmware upload path', () => {
    const { audios } = loadSeedFromDisk();
    const writable = audios.filter((a) => !a.readonly);
    expect(writable).not.toHaveLength(0);
    // `RT_UPLOADS_AUDIO_DIR` in firmware/main/config.h — the mock used to say
    // `/storage/uploaded/`, which exists nowhere on the device.
    expect(writable.every((a) => a.filename.startsWith('/storage/uploads/audio/'))).toBe(true);
  });
});
