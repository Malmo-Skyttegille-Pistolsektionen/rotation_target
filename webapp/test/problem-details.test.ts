import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, client, problemType } from '../src/api/client';
import type { Problem } from '../src/api/types';
import { failureNotice, unloadFailureNotice, updateFailureNotice } from '../src/lib/program-notices';

/**
 * RFC 9457 problem details (D-19).
 *
 * The bug this closes: the two `409`s `PUT /programs/{id}` answers were told
 * apart by running `/read-only|readonly|shipped/i` over the device's English.
 * Rewording either sentence silently swapped the explanations, and neither
 * could ever be translated. These tests assert the branches key off `type` by
 * proving they still pick the right one when the wording is wrong.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function problem(type: string, detail: string, status: number, title = 'Title'): Problem {
  return { type, title, status, detail };
}

function apiError(type: string, detail: string, status: number): ApiError {
  return new ApiError(status, detail, problem(type, detail, status));
}

describe('problemType', () => {
  it('reads the type off an ApiError that carries a problem', () => {
    expect(problemType(apiError('/problems/program_loaded', 'whatever', 409))).toBe('/problems/program_loaded');
  });

  it('is null for an ApiError with no problem body', () => {
    expect(problemType(new ApiError(409, 'Conflict'))).toBeNull();
  });

  it('is null for anything that is not an ApiError', () => {
    expect(problemType(new Error('boom'))).toBeNull();
    expect(problemType('boom')).toBeNull();
    expect(problemType(null)).toBeNull();
  });
});

describe('updateFailureNotice branches on type, not on wording', () => {
  it('explains a shipped program from the type alone', () => {
    // The detail says nothing about being shipped. Under the old regex this
    // fell through to the "loaded" explanation - the exact silent
    // mis-explanation D-19 exists to end.
    const notice = updateFailureNotice(apiError('/problems/program_readonly', 'Nope.', 409), 7);
    expect(notice.message).toContain('shipped with the firmware');
    expect(notice.message).toContain('Upload the file as a new program instead');
  });

  it('explains a loaded program from the type alone', () => {
    // And this detail *does* say "read-only", which the old regex would have
    // matched, showing the shipped explanation for a loaded program.
    const notice = updateFailureNotice(apiError('/problems/program_loaded', 'read-only, sort of', 409), 7);
    expect(notice.message).toContain('currently loaded on the device');
    expect(notice.message).toContain('Unload it first');
  });

  it('reports a program that is gone', () => {
    const notice = updateFailureNotice(apiError('/problems/program_not_found', 'Program not found', 404), 7);
    expect(notice.message).toBe('Program 7 is no longer on the device.');
  });

  it('falls back to detail for a 409 type it has no explanation for', () => {
    const notice = updateFailureNotice(apiError('/problems/program_invalid', 'Invalid program', 400), 7);
    expect(notice.message).toContain('Could not replace program 7.');
    expect(notice.message).toContain('Invalid program');
  });
});

describe('unloadFailureNotice', () => {
  it('names the escape for a run in progress', () => {
    const notice = unloadFailureNotice(apiError('/problems/program_running', 'A program is running', 409));
    expect(notice.message).toContain('Pause the run first');
  });

  it('falls back to detail for any other refusal', () => {
    const notice = unloadFailureNotice(apiError('/problems/admin_credentials_required', 'Nope', 401));
    expect(notice.message).toContain('Could not unload the program.');
  });
});

describe('failureNotice', () => {
  it('sends an unauthenticated caller to Settings', () => {
    const notice = failureNotice(apiError('/problems/admin_credentials_required', 'Nope', 401), 'Could not load.');
    expect(notice.message).toContain('sign in under Settings');
  });

  it('shows detail for everything else', () => {
    const notice = failureNotice(apiError('/problems/audio_playing', 'Audio is currently playing', 409), 'Could not delete.');
    expect(notice.message).toBe('Could not delete. Audio is currently playing');
  });
});

describe('a type this client has never heard of', () => {
  // The contract's enum is open: a client can be older than the firmware it is
  // talking to, and it must still be able to say something useful.
  const unknown = apiError('/problems/quantum_flux_capacitor_jammed', 'The flux capacitor jammed.', 409);

  it('is still carried through as a problem', () => {
    expect(problemType(unknown)).toBe('/problems/quantum_flux_capacitor_jammed');
    expect(unknown.problem?.status).toBe(409);
  });

  it('falls back to showing detail rather than matching a branch by accident', () => {
    expect(updateFailureNotice(unknown, 7).message).toBe('Could not replace program 7. The flux capacitor jammed.');
    expect(unloadFailureNotice(unknown).message).toBe('Could not unload the program. The flux capacitor jammed.');
    expect(failureNotice(unknown, 'Could not do it.').message).toBe('Could not do it. The flux capacitor jammed.');
  });
});

describe('the client parses the wire document', () => {
  function respond(body: string, init: ResponseInit): void {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, init)));
  }

  const problemInit = { status: 409, headers: { 'Content-Type': 'application/problem+json' } };

  async function reject(): Promise<ApiError> {
    try {
      await client('/programs/unload', { method: 'POST' });
    } catch (err) {
      return err as ApiError;
    }
    throw new Error('the call should have rejected');
  }

  it('carries type, title, status and detail off a problem body', async () => {
    respond(
      JSON.stringify({
        type: '/problems/program_running',
        title: 'A program is running',
        status: 409,
        detail: 'A program is running - stop it before unloading',
      }),
      problemInit,
    );
    const err = await reject();
    expect(err.status).toBe(409);
    expect(err.problem).toEqual({
      type: '/problems/program_running',
      title: 'A program is running',
      status: 409,
      detail: 'A program is running - stop it before unloading',
    });
    // `message` stays the string to display, so every banner that renders it
    // keeps working without knowing about problem details at all.
    expect(err.message).toBe('A program is running - stop it before unloading');
  });

  it('reads a problem served under the wrong media type', async () => {
    // Parsed by shape, not by Content-Type: an intermediary that rewrites the
    // header must not cost the client its discriminator.
    respond(
      JSON.stringify({ type: '/problems/audio_playing', title: 'Audio is currently playing', status: 409, detail: 'd' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );
    expect(problemType(await reject())).toBe('/problems/audio_playing');
  });

  it('leaves problem null for a body missing a member', async () => {
    // Half a problem is worse than none: a `detail` of undefined would reach a
    // banner. The caller's own fallback is better.
    respond(JSON.stringify({ type: '/problems/program_running', status: 409 }), problemInit);
    const err = await reject();
    expect(err.problem).toBeNull();
    expect(err.status).toBe(409);
  });

  it('leaves problem null for the text/html oversize refusal', async () => {
    // The one failure in this API that is not RFC 9457 - it is refused above
    // every handler, in the vendored HTTP layer.
    respond('File size must be less than 1048576 bytes!', {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
    const err = await reject();
    expect(err.problem).toBeNull();
    expect(err.message).toBe('File size must be less than 1048576 bytes!');
  });

  it('leaves problem null for an empty body', async () => {
    respond('', { status: 502, statusText: 'Bad Gateway' });
    const err = await reject();
    expect(err.problem).toBeNull();
    expect(err.message).toBe('API Error: Bad Gateway');
  });
});
