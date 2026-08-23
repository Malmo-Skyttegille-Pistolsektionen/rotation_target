import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AudioFile, DiagnosticsInfo, LibraryChangedPayload, StateUpdatePayload } from '../../src/api/types';
import { PROGRAM_FALT_TRANING } from '../fixtures';
import { createFakeClock, type FakeClock } from './clock';
import { HARDWARE_DEFAULTS, createMockServer, loadSeedFromDisk, type MockServer } from './server';
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

/** `POST /programs/start` for a named program - the body is required (D-27). */
async function start(id: number, init?: RequestInit): Promise<Response> {
  return api('/programs/start', { method: 'POST', body: JSON.stringify({ id }), ...init });
}

/**
 * `POST /programs/series/{index}/skip_to` for a named program - the body is
 * required, same shape as `start` (D-27, #105).
 */
async function skipTo(index: number, id: number, init?: RequestInit): Promise<Response> {
  return api(`/programs/series/${String(index)}/skip_to`, {
    method: 'POST',
    body: JSON.stringify({ id }),
    ...init,
  });
}

/**
 * Asserts the whole RFC 9457 problem document, media type included (D-19).
 *
 * The whole document rather than just the `type`: `title` and `status` are
 * fixed per type by the firmware and must not vary between occurrences, and
 * `detail` is what a user is shown. The same four assertions run against the
 * real firmware in `e2e/`, which is what keeps this mock honest.
 */
async function expectProblem(
  res: Response,
  expected: { type: string; title: string; status: number; detail: string },
): Promise<void> {
  expect(res.status).toBe(expected.status);
  expect(res.headers.get('content-type')).toBe('application/problem+json');
  expect(await res.json()).toEqual(expected);
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
    await expectProblem(await start(40), {
      type: '/problems/no_program_loaded',
      title: 'No program loaded',
      status: 400,
      detail: 'No program loaded',
    });
  });

  // --- D-27: a start names the program it is for ---------------------------

  it('rejects a start with no body, a non-object body or a non-integer id', async () => {
    await api('/programs/40/load', { method: 'POST' });
    const malformed = 'Expected a JSON body naming the program to start: {"id": <id>}';

    for (const body of [undefined, '', 'not json', '[]', '{}', '{"id":null}', '{"id":"40"}', '{"id":40.5}']) {
      const res = await api('/programs/start', { method: 'POST', body });
      expect(res.status, `body: ${String(body)}`).toBe(400);
      expect(await res.json()).toMatchObject({
        type: '/problems/start_id_required',
        status: 400,
        detail: malformed,
      });
    }
  });

  it('refuses a start for a program the device no longer holds, naming both', async () => {
    await api('/programs/40/load', { method: 'POST' });

    const res = await start(1);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      type: '/problems/start_program_mismatch',
      status: 409,
      detail: 'Start refused: the device has program 40 loaded, not program 1',
    });
  });

  it('leaves the run untouched when it refuses, and the right id still starts', async () => {
    await api('/programs/40/load', { method: 'POST' });
    const sse = await openSSE(server.port);
    const before = sse.payloads<StateUpdatePayload>('stateUpdate').length;

    expect((await start(1)).status).toBe(409);
    await flushIO();
    // A refused start publishes nothing: nothing about the device changed.
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')).toHaveLength(before);
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState?.running).toBe(false);

    expect((await start(40)).status).toBe(200);
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState?.running).toBe(true);

    sse.close();
  });

  it('refuses a stale start even while a run is in progress', async () => {
    await api('/programs/40/load', { method: 'POST' });
    expect((await start(40)).status).toBe(200);

    // Never "fine, it is running": the caller asked for a different program.
    expect((await start(1)).status).toBe(409);
  });

  it('answers 400 rather than 409 when nothing is loaded at all', async () => {
    // The more precise diagnosis wins: the client has to load something, not
    // re-read what is loaded.
    expect((await start(1)).status).toBe(400);
  });

  it('bounds-checks skip_to', async () => {
    await api('/programs/40/load', { method: 'POST' });
    expect((await skipTo(1, 40)).status).toBe(200);
    expect((await skipTo(99, 40)).status).toBe(400);
  });

  // --- #105: a skip names the program the index is for, mirroring D-27 -----

  it('rejects a skip_to with no body, a non-object body or a non-integer id', async () => {
    await api('/programs/40/load', { method: 'POST' });
    const malformed = 'Expected a JSON body naming the program to skip: {"id": <id>}';

    for (const body of [undefined, '', 'not json', '[]', '{}', '{"id":null}', '{"id":"40"}', '{"id":40.5}']) {
      const res = await api('/programs/series/1/skip_to', { method: 'POST', body });
      expect(res.status, `body: ${String(body)}`).toBe(400);
      expect(await res.json()).toMatchObject({
        type: '/problems/skip_id_required',
        status: 400,
        detail: malformed,
      });
    }
  });

  it('refuses a skip for a program the device no longer holds, naming both', async () => {
    await api('/programs/40/load', { method: 'POST' });

    const res = await skipTo(1, 1);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      type: '/problems/skip_program_mismatch',
      status: 409,
      detail: 'Skip refused: the device has program 40 loaded, not program 1',
    });
  });

  it('leaves the selection untouched when a skip refuses, and the right id still skips', async () => {
    await api('/programs/40/load', { method: 'POST' });
    const sse = await openSSE(server.port);
    const before = sse.payloads<StateUpdatePayload>('stateUpdate').length;

    expect((await skipTo(1, 1)).status).toBe(409);
    await flushIO();
    // A refused skip publishes nothing: nothing about the device changed.
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')).toHaveLength(before);
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState?.currentSeriesIndex).toBe(0);

    expect((await skipTo(1, 40)).status).toBe(200);
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState?.currentSeriesIndex).toBe(1);

    sse.close();
  });

  it('answers 400 rather than 409 when nothing is loaded at all', async () => {
    // The more precise diagnosis wins, same precedence as start's.
    expect((await skipTo(0, 1)).status).toBe(400);
  });

  it('refuses a mismatched skip ahead of an out-of-bounds index', async () => {
    await api('/programs/40/load', { method: 'POST' });

    // The id check runs before the bounds check, so a wrong program and an
    // out-of-range index both being true still answers the mismatch.
    const res = await skipTo(99, 1);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ type: '/problems/skip_program_mismatch' });
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
          { duration: 9_000_000, command: 'hide' },
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
            { duration: 3600000, command: 'hide' },
          ],
        },
      ],
    });
  });

  // The anchor has to survive a round trip through storage. It is the field
  // the firmware parsed but did not serialise, so a mock that drops it would
  // agree with that bug rather than with the fix.
  it('carries timer_start_index through an upload, and refuses one past the end', async () => {
    const anchored = (timer_start_index: unknown) => ({
      title: 'Anchored',
      series: [
        {
          name: 'Serie 1',
          timer_start_index,
          events: [
            { duration: 7000, command: 'hide' },
            { duration: 4000, command: 'show' },
          ],
        },
      ],
    });

    const { id } = await (await upload(anchored(1))).json();
    expect((await (await api(`/programs/${id}`)).json()).series[0].timer_start_index).toBe(1);

    // Absent stays absent rather than becoming an explicit 0.
    const { id: plain } = await (await upload(anchored(undefined))).json();
    expect((await (await api(`/programs/${plain}`)).json()).series[0]).not.toHaveProperty('timer_start_index');

    // Refused rather than clamped: 2 names an event this series does not have.
    expect((await upload(anchored(2))).status).toBe(400);
    expect((await upload(anchored(-1))).status).toBe(400);
  });

  it('rejects an upload that is not a JSON object', async () => {
    expect((await upload('[]')).status).toBe(400);
    expect((await api('/programs', { method: 'POST' })).status).toBe(400);
  });

  // `parse_command` in firmware/lib/rt_logic/program.cpp: a command it does not
  // recognise is a typo, not an instruction, and fails the whole program.
  it('refuses a command that is not show or hide, on create and on replace', async () => {
    const withCommand = (command: unknown) => ({
      ...document,
      series: [{ name: 'Serie 1', optional: false, events: [{ duration: 1000, command }] }],
    });

    for (const command of ['sideways', 'Show', 'SHOW', 'show ', 5, true, ['show']]) {
      expect((await upload(withCommand(command))).status, `command ${JSON.stringify(command)}`).toBe(400);
    }

    // Absent, null and "" all mean "leave the targets where they are".
    for (const command of [null, '']) {
      const created = await upload(withCommand(command));
      expect(created.status, `command ${JSON.stringify(command)}`).toBe(201);
      const { id } = await created.json();
      expect((await (await api(`/programs/${id}`)).json()).series[0].events[0]).toEqual({ duration: 1000 });

      const replaced = await api(`/programs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(withCommand('sideways')),
      });
      expect(replaced.status).toBe(400);
      // Not the id-mismatch error, though the body still carries the fixture's
      // id 7: `update_uploaded` parses before it compares ids.
      await expectProblem(replaced, {
        type: '/problems/program_invalid',
        title: 'Invalid program',
        status: 400,
        detail: 'Invalid program',
      });

      // And the stored program is untouched by the refused replace.
      expect((await (await api(`/programs/${id}`)).json()).series[0].events[0]).toEqual({ duration: 1000 });
    }
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
    await expectProblem(mismatched, {
      type: '/problems/program_id_mismatch',
      title: 'Program id does not match the path',
      status: 400,
      detail: 'Program id in the document does not match the path',
    });
  });

  it('refuses to replace a shipped program, and 404s an unknown one', async () => {
    const shipped = await api('/programs/40', { method: 'PUT', body: JSON.stringify(document) });
    // `type` alone — the two sentences are not what distinguishes them.
    await expectProblem(shipped, {
      type: '/problems/program_readonly',
      title: 'Program is read-only',
      status: 409,
      detail: 'Program is read-only and cannot be updated',
    });

    expect((await api('/programs/999', { method: 'PUT', body: JSON.stringify(document) })).status).toBe(404);
  });

  it('refuses to replace the loaded program until something else is loaded (D-15)', async () => {
    const { id } = await (await upload()).json();
    await api(`/programs/${id}/load`, { method: 'POST' });

    const refused = await api(`/programs/${id}`, { method: 'PUT', body: JSON.stringify({ ...document, id }) });
    await expectProblem(refused, {
      type: '/problems/program_loaded',
      title: 'Program is loaded',
      status: 409,
      detail: 'Program is loaded; unload it before updating',
    });

    // The way out is POST /programs/unload (D-22); loading something else does
    // it too, and is what this asserts because it also proves the refusal is
    // about *this* program being loaded.
    await api('/programs/40/load', { method: 'POST' });
    expect((await api(`/programs/${id}`, { method: 'PUT', body: JSON.stringify({ ...document, id }) })).status).toBe(
      200,
    );
  });

  it('deletes an uploaded program, and tells "gone" apart from "read-only" (D-23)', async () => {
    const { id } = await (await upload()).json();

    expect((await api(`/programs/${id}/delete`, { method: 'DELETE' })).status).toBe(200);
    expect((await api(`/programs/${id}`)).status).toBe(404);
    // Now it really is gone, which is the one thing 404 means.
    expect((await api(`/programs/${id}/delete`, { method: 'DELETE' })).status).toBe(404);

    // A shipped program is refused, not hidden: it exists, GET still serves it,
    // and only the write is refused - so a client can tell "refused because it
    // is shipped" from "not there" and offer upload-as-new instead of a refresh.
    const shipped = await api('/programs/40/delete', { method: 'DELETE' });
    await expectProblem(shipped, {
      type: '/problems/program_readonly',
      title: 'Program is read-only',
      status: 409,
      detail: 'Program is read-only and cannot be deleted',
    });
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

describe('unloading (D-22)', () => {
  async function loadFalt(): Promise<void> {
    expect((await api('/programs/40/load', { method: 'POST' })).status).toBe(200);
  }

  it('clears the selection and publishes it', async () => {
    await loadFalt();
    const sse = await openSSE(server.port);
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).loadedProgramId).toBe(40);

    const res = await api('/programs/unload', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Program unloaded' });

    await flushIO();
    const published = last(sse.payloads<StateUpdatePayload>('stateUpdate'));
    expect(published.loadedProgramId).toBeNull();
    expect(published.programState).toBeNull();

    sse.close();
  });

  it('leaves the targets where the run left them - unloading moves no hardware', async () => {
    await loadFalt();
    await api('/targets/show', { method: 'POST' });

    await api('/programs/unload', { method: 'POST' });
    const sse = await openSSE(server.port);
    await flushIO();
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')[0].targetStatus).toBe('shown');

    sse.close();
  });

  it('answers 200 and publishes nothing when nothing is loaded', async () => {
    const sse = await openSSE(server.port);
    await flushIO();
    // The connect frame, and nothing after it.
    const before = sse.payloads<StateUpdatePayload>('stateUpdate').length;

    const res = await api('/programs/unload', { method: 'POST' });
    expect(res.status).toBe(200);
    // The same message either way: a 200 says "nothing is loaded now", not
    // "something was unloaded just now". That is what makes a retry safe.
    expect(await res.json()).toEqual({ message: 'Program unloaded' });

    await flushIO();
    // A repeat frame would teach clients that a stateUpdate need not mean a
    // state update.
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')).toHaveLength(before);

    sse.close();
  });

  it('refuses a run in progress, and the refusal lifts with a stop', async () => {
    await loadFalt();
    await start(40);

    const refused = await api('/programs/unload', { method: 'POST' });
    await expectProblem(refused, {
      type: '/problems/program_running',
      title: 'A program is running',
      status: 409,
      detail: 'A program is running - stop it before unloading',
    });
    // Nothing happened to the run.
    const sse = await openSSE(server.port);
    await flushIO();
    expect(sse.payloads<StateUpdatePayload>('stateUpdate')[0].programState?.running).toBe(true);
    sse.close();

    await api('/programs/stop', { method: 'POST' });
    expect((await api('/programs/unload', { method: 'POST' })).status).toBe(200);
  });

  it('is gated on the admin token like every other mutation', async () => {
    const { token } = await (
      await api('/admin-mode/enable', { method: 'POST', body: JSON.stringify({ password: 'range-2026' }) })
    ).json();

    expect((await api('/programs/unload', { method: 'POST' })).status).toBe(401);
    expect(
      (await api('/programs/unload', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(200);
  });
});

describe('libraryChanged (D-24)', () => {
  /** A clip library, which the default seed deliberately does not have. */
  const SEED_AUDIOS: AudioFile[] = [
    { id: 3, title: 'Eld upphör', filename: '/storage/shipped/audio/3.wav', readonly: true },
    { id: 100, title: 'Klubbmästerskap', filename: '/storage/uploads/audio/100.wav', readonly: false },
  ];

  const document = {
    title: 'Klubbserie',
    description: 'Uploaded from a file',
    series: [{ name: 'Serie 1', optional: false, events: [{ duration: 1000, command: 'show' }] }],
  };

  let audioServer: MockServer;
  let audioBase: string;
  let sse: SSEReader;

  beforeEach(async () => {
    audioServer = createMockServer({ clock, seed: { programs: { 40: PROGRAM_FALT_TRANING }, audios: SEED_AUDIOS } });
    audioBase = `http://127.0.0.1:${await audioServer.listen()}/api/v2`;
    sse = await openSSE(audioServer.port);
    await flushIO();
  });

  afterEach(async () => {
    sse.close();
    await audioServer.close();
  });

  function call(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${audioBase}${path}`, init);
  }

  function kinds(): string[] {
    return sse.payloads<LibraryChangedPayload>('libraryChanged').map((payload) => payload.kind);
  }

  /**
   * A minimal RIFF/WAVE body in a multipart envelope the mock will accept.
   * Every byte in it is ASCII or NUL, so a plain string is byte-for-byte what
   * a file would be - and `fetch` takes one without a Buffer conversion.
   */
  function wavUpload(title: string): { body: string; headers: Record<string, string> } {
    const boundary = '----rtmock';
    const wav = `RIFF${'\0'.repeat(4)}WAVE${'\0'.repeat(52)}`;
    const body =
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\n\r\n` +
      `${wav}\r\n--${boundary}--\r\n`;
    return { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
  }

  it('names the program library on create, replace and delete', async () => {
    const { id } = await (await call('/programs', { method: 'POST', body: JSON.stringify(document) })).json();
    await flushIO();
    expect(kinds()).toEqual(['program']);

    await call(`/programs/${id}`, { method: 'PUT', body: JSON.stringify(document) });
    await flushIO();
    expect(kinds()).toEqual(['program', 'program']);

    await call(`/programs/${id}/delete`, { method: 'DELETE' });
    await flushIO();
    expect(kinds()).toEqual(['program', 'program', 'program']);
  });

  it('names the audio library on upload and delete', async () => {
    const { body, headers } = wavUpload('Nytt klipp');
    const created = await call('/audios', { method: 'POST', body, headers });
    expect(created.status).toBe(201);
    await flushIO();
    expect(kinds()).toEqual(['audio']);

    expect((await call('/audios/100/delete', { method: 'DELETE' })).status).toBe(200);
    await flushIO();
    expect(kinds()).toEqual(['audio', 'audio']);
  });

  it('says nothing about the library when the device only changes what it is doing', async () => {
    await call('/programs/40/load', { method: 'POST' });
    await call('/programs/start', { method: 'POST', body: JSON.stringify({ id: 40 }) });
    await call('/programs/stop', { method: 'POST' });
    await call('/programs/reset', { method: 'POST' });
    await call('/programs/series/1/skip_to', { method: 'POST', body: JSON.stringify({ id: 40 }) });
    await call('/programs/unload', { method: 'POST' });
    await call('/targets/toggle', { method: 'POST' });
    await flushIO();

    expect(kinds()).toEqual([]);
    // ...and every one of those did publish run state, so the stream is alive.
    expect(sse.payloads<StateUpdatePayload>('stateUpdate').length).toBeGreaterThan(1);
  });

  it('emits both events when the loaded program is deleted, for its two reasons', async () => {
    const { id } = await (await call('/programs', { method: 'POST', body: JSON.stringify(document) })).json();
    await call(`/programs/${id}/load`, { method: 'POST' });
    await flushIO();
    const stateFrames = sse.payloads<StateUpdatePayload>('stateUpdate').length;

    await call(`/programs/${id}/delete`, { method: 'DELETE' });
    await flushIO();

    expect(sse.payloads<StateUpdatePayload>('stateUpdate').length).toBe(stateFrames + 1);
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).loadedProgramId).toBeNull();
    // The create emitted one too, so the delete is the second.
    expect(kinds()).toEqual(['program', 'program']);
  });

  it('stays silent on a refused write - a 409 changed nothing', async () => {
    expect((await call('/programs/40/delete', { method: 'DELETE' })).status).toBe(409);
    expect((await call('/audios/3/delete', { method: 'DELETE' })).status).toBe(409);
    await flushIO();
    expect(kinds()).toEqual([]);
  });

  it('refuses a shipped clip with 409, ahead of every other reason (D-23)', async () => {
    const refused = await call('/audios/3/delete', { method: 'DELETE' });
    await expectProblem(refused, {
      type: '/problems/audio_readonly',
      title: 'Audio is read-only',
      status: 409,
      detail: 'Audio is read-only and cannot be deleted',
    });
    // Still there, and still listed - it was refused, not hidden.
    const { audios } = (await (await call('/audios')).json()) as { audios: AudioFile[] };
    expect(audios.map((clip) => clip.id)).toContain(3);

    // 404 is left meaning exactly one thing.
    expect((await call('/audios/999/delete', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('diagnostics (D-25)', () => {
  it('serves no startup issues for a clean boot', async () => {
    const info = (await (await api('/diagnostics/info')).json()) as DiagnosticsInfo;
    expect(info.startupIssues).toEqual([]);
    expect(info.programCount).toBe(1);
  });

  it('serves what the boot scan could not read, bounded and oldest-dropped', async () => {
    const issues = Array.from({ length: 10 }, (_, index) => ({
      code: 'program_invalid',
      message: 'Program file is malformed and was skipped',
      context: { file: `/storage/uploads/programs/${index}.json` },
    }));
    const bounded = createMockServer({ clock, seed: { programs: {}, audios: [], startupIssues: issues } });
    const port = await bounded.listen();

    const info = (await (await fetch(`http://127.0.0.1:${port}/api/v2/diagnostics/info`)).json()) as DiagnosticsInfo;
    // Eight kept, the oldest two dropped: the array reflects where the scan
    // finished, and an array of exactly eight may be a truncated one.
    expect(info.startupIssues).toHaveLength(8);
    expect(info.startupIssues[0].context).toEqual({ file: '/storage/uploads/programs/2.json' });
    expect(info.startupIssues[7].context).toEqual({ file: '/storage/uploads/programs/9.json' });

    await bounded.close();
  });

  it('is public - no token needed once admin mode is on', async () => {
    await api('/admin-mode/enable', { method: 'POST', body: JSON.stringify({ password: 'range-2026' }) });
    const res = await api('/diagnostics/info');
    expect(res.status).toBe(200);
    expect(((await res.json()) as DiagnosticsInfo).adminModeEnabled).toBe(true);
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
    await start(40);
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
    await start(40);
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
    await start(40);
    clock.advance(12_000);
    await api('/programs/stop', { method: 'POST' });
    await flushIO();

    const paused = last(sse.payloads<StateUpdatePayload>('stateUpdate'));
    expect(paused.programState).toMatchObject({ running: false, tickerMs: 12_000, currentEventIndex: 1 });

    // Time passing while paused must not move the run on.
    clock.advance(60_000);
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState!.tickerMs).toBe(12_000);

    await start(40);
    await flushIO();
    expect(last(sse.payloads<StateUpdatePayload>('stateUpdate')).programState).toMatchObject({
      running: true,
      tickerMs: 12_000,
      currentEventIndex: 1,
    });
  });

  it('reset rewinds to the top of the series', async () => {
    await api('/programs/40/load', { method: 'POST' });
    await start(40);
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

/**
 * Hardware configuration (#144).
 *
 * The refusals here are the ones whose recovery needs a USB cable, so they are
 * worth pinning in the mock as well as the firmware - a value the device
 * refuses and the mock accepts is a webapp test that passes against a device
 * that would have said no.
 */
describe('hardware configuration', () => {
  async function put(body: unknown): Promise<Response> {
    return api('/config/hardware', { method: 'PUT', body: JSON.stringify(body) });
  }

  async function read(): Promise<Record<string, never>> {
    return (await (await api('/config/hardware')).json()) as Record<string, never>;
  }

  it('starts on the compiled defaults, with nothing overridden', async () => {
    const state = await read();
    expect(state).toMatchObject({
      active: HARDWARE_DEFAULTS,
      saved: HARDWARE_DEFAULTS,
      defaults: HARDWARE_DEFAULTS,
      overridden: false,
      restartRequired: false,
    });
  });

  // The gap between a save and the reboot that adopts it is the one thing a
  // client must not hide: a pin change that appears to have done nothing is
  // how somebody ends up reflashing a working device.
  it('reports restartRequired between a save and the restart that adopts it', async () => {
    expect((await put({ targetGpio: 7 })).status).toBe(200);

    const afterSave = await read();
    expect(afterSave).toMatchObject({
      active: { targetGpio: HARDWARE_DEFAULTS.targetGpio },
      saved: { targetGpio: 7 },
      overridden: true,
      restartRequired: true,
    });

    server.restart();
    const afterRestart = await read();
    expect(afterRestart).toMatchObject({
      active: { targetGpio: 7 },
      saved: { targetGpio: 7 },
      restartRequired: false,
    });
  });

  it('keeps the fields a request does not mention', async () => {
    expect((await put({ displayName: 'Bana 1' })).status).toBe(200);
    expect((await put({ targetGpio: 9 })).status).toBe(200);

    const state = await read();
    expect(state).toMatchObject({ saved: { targetGpio: 9, displayName: 'Bana 1' } });
  });

  // 26-32 are the module's own flash and PSRAM; driving one does not fail to
  // move a target, it stops the device booting.
  it('refuses a GPIO that would stop the device booting, without storing anything', async () => {
    for (const gpio of [26, 30, 32, 22, 25]) {
      const refused = await put({ targetGpio: gpio });
      await expectProblem(refused, {
        type: '/problems/hardware_config_invalid',
        title: 'Invalid hardware configuration',
        status: 400,
        detail:
          "That GPIO is wired to the module's flash or PSRAM, or does not exist on this chip. Driving it stops the device booting.",
      });
    }
    expect(await read()).toMatchObject({ saved: HARDWARE_DEFAULTS, overridden: false });
  });

  it('refuses a GPIO off the chip, and one that cannot drive an output', async () => {
    expect((await put({ targetGpio: 49 })).status).toBe(400);
    expect((await put({ targetGpio: -1 })).status).toBe(400);
    expect((await put({ targetGpio: 46 })).status).toBe(400);
  });

  // The hostname is the setup AP's SSID prefix as well as the mDNS name, so a
  // value that is not a legal DNS label makes the device harder to reach.
  it('refuses a hostname that is not a legal label', async () => {
    for (const hostname of ['', 'Rotation', 'has space', '-leading', 'trailing-', 'a'.repeat(21)]) {
      expect((await put({ hostname })).status).toBe(400);
    }
    expect((await put({ hostname: 'bana-1' })).status).toBe(200);
  });

  it('takes any display name up to its length', async () => {
    expect((await put({ displayName: 'Malmö Skyttegille — bana 1' })).status).toBe(200);
    expect((await put({ displayName: 'x'.repeat(41) })).status).toBe(400);
  });

  it('resets to the compiled defaults, and says a restart is needed', async () => {
    expect((await put({ targetGpio: 7, displayName: 'Bana 1' })).status).toBe(200);
    server.restart();

    expect((await api('/config/hardware/reset', { method: 'POST' })).status).toBe(200);
    expect(await read()).toMatchObject({
      saved: HARDWARE_DEFAULTS,
      overridden: false,
      restartRequired: true,
    });
  });

  it('gates writes on the admin token, but not the read', async () => {
    expect((await api('/admin-mode/enable', { method: 'POST', body: JSON.stringify({ password: 'pw' }) })).status).toBe(
      200,
    );

    expect((await api('/config/hardware')).status).toBe(200);
    expect((await put({ targetGpio: 7 })).status).toBe(401);
    expect((await api('/config/hardware/reset', { method: 'POST' })).status).toBe(401);
  });
});
