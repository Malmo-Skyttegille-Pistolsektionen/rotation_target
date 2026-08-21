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

describe('program storage', () => {
  /** A document with everything the device is documented to ignore or fix up. */
  const document = {
    id: 7,
    readonly: true,
    title: 'Klubbserie',
    description: 'Uploaded from a file',
    nickname: 'dropped',
    series: [
      {
        name: 'Serie 1',
        optional: true,
        colour: 'dropped',
        events: [
          { duration: 0, command: 'show', audio_ids: [26], start: true },
          { duration: 9_000_000, command: 'sideways' },
        ],
      },
    ],
  };

  async function upload(body: unknown = document): Promise<Response> {
    return api('/programs', { method: 'POST', body: JSON.stringify(body) });
  }

  it("assigns the lowest free id from 100 up and ignores the document's", async () => {
    const res = await upload();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 100 });

    expect(await (await upload()).json()).toEqual({ id: 101 });
    expect(await (await upload()).json()).toEqual({ id: 102 });

    // A freed id is handed straight back out - the firmware scans up from 100
    // rather than counting from the highest in use.
    await api('/programs/101/delete', { method: 'DELETE' });
    expect(await (await upload()).json()).toEqual({ id: 101 });
  });

  it('stores what it parsed: unknown fields dropped, duration clamped, never read-only', async () => {
    const { id } = await (await upload()).json();

    expect(await (await api(`/programs/${id}`)).json()).toEqual({
      id,
      title: 'Klubbserie',
      description: 'Uploaded from a file',
      readonly: false,
      series: [
        {
          name: 'Serie 1',
          optional: true,
          events: [
            { duration: 1, command: 'show', audio_ids: [26] },
            // Kept verbatim, as the firmware keeps it: only show/hide act.
            { duration: 3600000, command: 'sideways' },
          ],
        },
      ],
    });
  });

  it('rejects an upload that is not a JSON object', async () => {
    expect((await upload('[]')).status).toBe(400);
    expect((await api('/programs', { method: 'POST' })).status).toBe(400);
  });

  it('replaces through PUT and answers with the stored form', async () => {
    const { id } = await (await upload()).json();

    const res = await api(`/programs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...document, id, title: 'Klubbserie v2' }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe('Klubbserie v2');
    expect((await (await api(`/programs/${id}`)).json()).title).toBe('Klubbserie v2');
  });

  it('keeps the path id when the body declares none, and 400s a body that declares another', async () => {
    const { id } = await (await upload()).json();

    const kept = await api(`/programs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title: 'No id here', description: '', readonly: false, series: [] }),
    });
    expect(kept.status).toBe(200);
    expect((await kept.json()).id).toBe(id);

    const mismatched = await api(`/programs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...document, id: id + 1 }),
    });
    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toEqual({ error: 'Program id in the document does not match the path' });
  });

  it('refuses to replace a shipped program, and 404s an unknown one', async () => {
    const shipped = await api('/programs/40', { method: 'PUT', body: JSON.stringify(document) });
    expect(shipped.status).toBe(409);
    expect(await shipped.json()).toEqual({ error: 'Program is read-only and cannot be updated' });

    expect((await api('/programs/999', { method: 'PUT', body: JSON.stringify(document) })).status).toBe(404);
  });

  it('refuses to replace the loaded program until something else is loaded (D-15)', async () => {
    const { id } = await (await upload()).json();
    await api(`/programs/${id}/load`, { method: 'POST' });

    const refused = await api(`/programs/${id}`, { method: 'PUT', body: JSON.stringify({ ...document, id }) });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'Program is loaded; unload it before updating' });

    // There is no unload endpoint in v2: loading something else is the way out.
    await api('/programs/40/load', { method: 'POST' });
    expect((await api(`/programs/${id}`, { method: 'PUT', body: JSON.stringify({ ...document, id }) })).status).toBe(
      200,
    );
  });

  it('deletes an uploaded program and hides a shipped one behind the same 404', async () => {
    const { id } = await (await upload()).json();

    expect((await api(`/programs/${id}/delete`, { method: 'DELETE' })).status).toBe(200);
    expect((await api(`/programs/${id}`)).status).toBe(404);
    expect((await api(`/programs/${id}/delete`, { method: 'DELETE' })).status).toBe(404);

    const shipped = await api('/programs/40/delete', { method: 'DELETE' });
    expect(shipped.status).toBe(404);
    expect((await api('/programs/40')).status).toBe(200);
  });

  it('unloads the loaded program when it is deleted, and says so', async () => {
    const { id } = await (await upload()).json();
    await api(`/programs/${id}/load`, { method: 'POST' });

    const sse = await openSSE(server.port);
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).loadedProgramId).toBe(id);

    await api(`/programs/${id}/delete`, { method: 'DELETE' });
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).loadedProgramId).toBeNull();

    sse.close();
  });

  it('gates create, replace and delete on the admin token', async () => {
    const { id } = await (await upload()).json();
    const { token } = await (
      await api('/admin-mode/enable', { method: 'POST', body: JSON.stringify({ password: 'range-2026' }) })
    ).json();
    const authorized = { Authorization: `Bearer ${token}` };

    expect((await api('/programs', { method: 'POST', body: JSON.stringify(document) })).status).toBe(401);
    expect((await api(`/programs/${id}`, { method: 'PUT', body: JSON.stringify({ ...document, id }) })).status).toBe(
      401,
    );
    expect((await api(`/programs/${id}/delete`, { method: 'DELETE' })).status).toBe(401);

    expect(
      (await api('/programs', { method: 'POST', body: JSON.stringify(document), headers: authorized })).status,
    ).toBe(201);
    expect(
      (await api(`/programs/${id}`, { method: 'PUT', body: JSON.stringify({ ...document, id }), headers: authorized }))
        .status,
    ).toBe(200);
    expect((await api(`/programs/${id}/delete`, { method: 'DELETE', headers: authorized })).status).toBe(200);
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

    // One stateUpdate per whole second of the series - 28 frames, not one per
    // simulated millisecond. The ticker carries ms; the cadence stays 1 Hz.
    expect(running.map((u) => u.programState!.tickerMs)).toEqual(Array.from({ length: 28 }, (_, i) => i * 1000));

    // Targets follow the events: hidden for 10 s, then alternating 3 s.
    const shownAt = running.filter((u) => u.targetStatus === 'shown').map((u) => u.programState!.tickerMs);
    expect(shownAt).toEqual([10_000, 11_000, 12_000, 16_000, 17_000, 18_000, 22_000, 23_000, 24_000]);

    // Event index is derived, not counted.
    expect(running.find((u) => u.programState!.tickerMs === 17_000)!.programState!.currentEventIndex).toBe(3);
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
      tickerMs: null,
    });
    expect(completed.targetStatus).toBe('hidden');
  });

  it('stop pauses and start resumes from the same millisecond', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await api('/programs/start', { method: 'POST' });
    clock.advance(12_000);
    await api('/programs/stop', { method: 'POST' });
    await flushIO();

    const paused = last(sse.payloads<StateUpdatePayload>('stateUpdate'));
    expect(paused.programState).toMatchObject({ running: false, tickerMs: 12_000, currentEventIndex: 1 });

    // Time passing while paused must not move the run on.
    clock.advance(60_000);
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState!.tickerMs).toBe(12_000);

    await api('/programs/start', { method: 'POST' });
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState).toMatchObject({
      running: true,
      tickerMs: 12_000,
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
      tickerMs: null,
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
