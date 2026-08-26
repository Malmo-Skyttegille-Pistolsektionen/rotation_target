import { expect, test } from '@playwright/test';

import { CONTROL_LOCK_PASSWORD, expectProblem, resetDevice } from './device';

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
  // resetDevice leaves nothing loaded, and leaves the control lock off - so this is
  // the device's own refusal, not an auth one.
  // The body is required since D-27, and its check runs first - so reaching the
  // nothing-loaded refusal means naming a program the device does not hold.
  await expectProblem(await request.post(`${API}/programs/start`, { data: { id: 40 } }), {
    type: '/problems/no_program_loaded',
    title: 'No program loaded',
    status: 400,
    detail: 'No program loaded',
  });

  // A client that has not learned D-27 sends no body at all: the device must
  // say what is missing rather than guessing which program was meant.
  await expectProblem(await request.post(`${API}/programs/start`), {
    type: '/problems/start_id_required',
    title: 'A program id is required to start',
    status: 400,
    detail: 'Expected a JSON body naming the program to start: {"id": <id>}',
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

test('auth: a protected call with no credentials, and a wrong password', async ({ playwright, request }, testInfo) => {
  // The only group that needs the lock on: while it is off every endpoint is
  // open, so there is no 401 to provoke. Turned off again at the end, which is
  // the state every other spec's beforeAll expects to find.
  const enable = await request.post(`${API}/control-lock/enable`, { data: { password: CONTROL_LOCK_PASSWORD } });
  const session =
    enable.status() === 409
      ? await request.post(`${API}/control-lock/login`, { data: { password: CONTROL_LOCK_PASSWORD } })
      : enable;
  const { token } = (await session.json()) as { token: string };
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  // A context of its own, because `enable` above set the `control_lock` cookie on the
  // shared one and the device accepts that cookie as a credential. Calling
  // from the shared context would be authenticated, and would have answered
  // `400 no_program_loaded` — a green test proving nothing.
  const anonymous = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
  });

  try {
    await expectProblem(await anonymous.post(`${API}/programs/start`), {
      type: '/problems/control_lock_credentials_required',
      title: 'Control lock credentials required',
      status: 401,
      detail: 'The controls are locked - log in to start or change anything',
    });

    await expectProblem(await request.post(`${API}/control-lock/login`, { data: { password: 'wrong' } }), {
      type: '/problems/invalid_password',
      title: 'Invalid password',
      status: 401,
      detail: 'Invalid password',
    });

    await expectProblem(await request.post(`${API}/control-lock/enable`, { data: { password: CONTROL_LOCK_PASSWORD } }), {
      type: '/problems/control_lock_already_enabled',
      title: 'Control lock already on',
      status: 409,
      detail: 'The control lock is already on. Log in, or turn it off before turning it on again.',
    });
  } finally {
    await anonymous.dispose();
    const disable = await request.post(`${API}/control-lock/disable`, auth);
    // Loud, because every spec after this one starts by expecting the lock
    // off: a silent failure here fails them instead of this test.
    expect(disable.ok(), `could not turn the control lock off: ${disable.status()}`).toBeTruthy();
  }

  await expectProblem(await request.post(`${API}/control-lock/login`, { data: { password: CONTROL_LOCK_PASSWORD } }), {
    type: '/problems/control_lock_not_enabled',
    title: 'Control lock not on',
    status: 409,
    detail: 'The control lock is not on. Turn it on before logging in.',
  });
});
