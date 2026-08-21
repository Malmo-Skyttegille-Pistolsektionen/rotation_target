import { test } from '@playwright/test';

import { ADMIN_PASSWORD, expectProblem, resetDevice } from './device';

/**
 * One refusal per group, proven against the real firmware (D-19).
 *
 * The suite this belongs to already asserts the two read-only `409`s; these
 * cover the rest of the surface — the media type, the four members, the
 * absent `instance`, and the titles and statuses `rt::ProblemType` fixes per
 * type. `test/mock-server/server.ts` copies its table from that header, and
 * this file is the only thing that proves the copy is faithful.
 *
 * The internal group (`program_store_failed`, `audio_store_failed`) has no
 * test here: both need a flash write to fail, which nothing can provoke from
 * the outside.
 */

const API = '/api/v2';

test.beforeAll(async ({ request }) => {
  await resetDevice(request);
});

test('not found: an unmatched API route and a missing program', async ({ request }) => {
  await expectProblem(await request.get(`${API}/there-is-no-such-thing`), {
    type: '/problems/route_not_found',
    title: 'Route not found',
    status: 404,
    detail: 'Not found',
  });

  await expectProblem(await request.get(`${API}/programs/9999`), {
    type: '/problems/program_not_found',
    title: 'Program not found',
    status: 404,
    detail: 'Program not found',
  });

  await expectProblem(await request.post(`${API}/audios/9999/play`), {
    type: '/problems/audio_not_found',
    title: 'Audio not found',
    status: 404,
    detail: 'Audio not found',
  });
});

test('conflict/state: starting with nothing loaded', async ({ request }) => {
  // resetDevice leaves nothing loaded, and leaves admin mode off - so this is
  // the device's own refusal, not an auth one.
  await expectProblem(await request.post(`${API}/programs/start`), {
    type: '/problems/no_program_loaded',
    title: 'No program loaded',
    status: 400,
    detail: 'No program loaded',
  });

  await expectProblem(await request.post(`${API}/programs/stop`), {
    type: '/problems/program_not_running',
    title: 'Program not running',
    status: 400,
    detail: 'Program not running',
  });
});

test('validation: a program document that will not parse', async ({ request }) => {
  // The slug shared with the SSE `backend_issue` code of the same name: one
  // failure, one word, whichever channel reports it.
  await expectProblem(
    await request.post(`${API}/programs`, {
      headers: { 'Content-Type': 'application/json' },
      data: 'this is not a program',
    }),
    { type: '/problems/program_invalid', title: 'Invalid program', status: 400, detail: 'Invalid program' },
  );
});

test('upload: a POST with no file part', async ({ request }) => {
  await expectProblem(
    await request.post(`${API}/audios`, { multipart: { title: 'No file here' } }),
    {
      type: '/problems/upload_missing_file',
      title: 'No file uploaded',
      status: 400,
      detail: 'No file uploaded',
    },
  );
});

test('auth: a protected call with no credentials, and a wrong password', async ({ request }) => {
  // The only group that needs admin mode on: while it is off every endpoint is
  // open, so there is no 401 to provoke. Turned off again at the end, which is
  // the state every other spec's beforeAll expects to find.
  const enable = await request.post(`${API}/admin-mode/enable`, { data: { password: ADMIN_PASSWORD } });
  const session =
    enable.status() === 409
      ? await request.post(`${API}/admin-mode/login`, { data: { password: ADMIN_PASSWORD } })
      : enable;
  const { token } = (await session.json()) as { token: string };
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  try {
    await expectProblem(await request.post(`${API}/programs/start`), {
      type: '/problems/admin_credentials_required',
      title: 'Admin credentials required',
      status: 401,
      detail: 'Invalid or missing admin credentials',
    });

    await expectProblem(await request.post(`${API}/admin-mode/login`, { data: { password: 'wrong' } }), {
      type: '/problems/invalid_password',
      title: 'Invalid password',
      status: 401,
      detail: 'Invalid password',
    });

    await expectProblem(await request.post(`${API}/admin-mode/enable`, { data: { password: ADMIN_PASSWORD } }), {
      type: '/problems/admin_mode_already_enabled',
      title: 'Admin mode already enabled',
      status: 409,
      detail: 'Admin mode is already enabled. Log in or disable it before enabling again.',
    });
  } finally {
    await request.post(`${API}/admin-mode/disable`, auth);
  }

  await expectProblem(await request.post(`${API}/admin-mode/login`, { data: { password: ADMIN_PASSWORD } }), {
    type: '/problems/admin_mode_not_enabled',
    title: 'Admin mode not enabled',
    status: 409,
    detail: 'Admin mode is not enabled. Enable it before logging in.',
  });
});
