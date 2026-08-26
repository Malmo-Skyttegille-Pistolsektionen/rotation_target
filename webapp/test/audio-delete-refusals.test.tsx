// @vitest-environment happy-dom
// Same-origin with the mock server, for the reason spelled out in
// useControlLockStatus.test.tsx: the mock implements no CORS allowlist.
// @vitest-environment-options { "url": "http://127.0.0.1:18089" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AudioFile } from '../src/api/types';
import { SettingsProvider } from '../src/context/SettingsContext';
import { Route } from '../src/routes/audios';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { requestElsewhere } from './other-client';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake (18080 useControlLockStatus, 18081 audios, 18082 programs, 18083
// program-editor, 18084 run, 18085 startup-issues, 18086 about-section /
// start-delay, 18087 storage-section, 18088 network-section, 18089 here).
// Pick the next free number for a new suite.
const PORT = 18089;

const AudiosView = Route.options.component!;

/** One uploaded (non-readonly) clip - the only kind Delete is ever offered on. */
const SEED_AUDIOS: AudioFile[] = [
  { id: 100, title: 'Klubbmästerskap 2026', filename: '/userdata/audio/100.wav', readonly: false },
];

/** A one-event, one-series program body for `POST /api/v2/programs`. */
function programBody(title: string, audioIds?: number[]): Record<string, unknown> {
  return {
    title,
    description: 'from the other client',
    series: [
      {
        name: 'Serie 1',
        optional: false,
        events: [{ duration: 60000, command: 'show', ...(audioIds ? { audio_ids: audioIds } : {}) }],
      },
    ],
  };
}

/** Uploads a program as another client would, and hands back the id the device assigned. */
async function uploadProgram(title: string, audioIds?: number[]): Promise<number> {
  const { status, body } = await requestElsewhere(PORT, 'POST', '/api/v2/programs', programBody(title, audioIds));
  expect(status).toBe(201);
  return (JSON.parse(body) as { id: number }).id;
}

async function loadProgram(id: number): Promise<void> {
  const { status } = await requestElsewhere(PORT, 'POST', `/api/v2/programs/${id}/load`);
  expect(status).toBe(200);
}

async function startProgram(id: number): Promise<void> {
  const { status } = await requestElsewhere(PORT, 'POST', '/api/v2/programs/start', { id });
  expect(status).toBe(200);
}

let server: MockServer;
let clock: ReturnType<typeof createFakeClock>;
let queryClient: QueryClient;

function renderAudios() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <AudiosView />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

/** No jest-dom in this suite — assert on the text directly. */
function text(element: HTMLElement): string {
  return element.textContent ?? '';
}

/** The list has arrived and rendered. */
async function waitForClips(): Promise<void> {
  await screen.findByTestId('audios-row-100');
}

function deleteClip(id: number): void {
  fireEvent.click(screen.getByTestId(`audios-delete-${id}`));
  fireEvent.click(screen.getByTestId(`audios-delete-confirm-${id}`));
}

beforeAll(async () => {
  clock = createFakeClock();
  server = createMockServer({ clock, port: PORT, seed: { programs: {}, audios: [...SEED_AUDIOS] } });
  await server.listen();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  server.reset();
  localStorage.clear();
  document.cookie = 'control_lock=; Path=/; Max-Age=0';
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
});

// #103: the mock only modelled two of `web_server.cpp`'s four DELETE refusals
// (read-only, currently-playing). These cover the other two - the ones an
// operator is most likely to hit at a range - and the order between them,
// which the firmware fixes as: read-only, then loaded-program use, then a
// run in progress, then currently-playing.
describe('the run-safety refusals #79 added to the device', () => {
  it('relays "used by the loaded program", naming the clip\'s own role', async () => {
    const id = await uploadProgram('Uses the clip', [100]);
    await loadProgram(id);

    renderAudios();
    await waitForClips();

    deleteClip(100);

    await waitFor(() =>
      expect(text(screen.getByTestId('audios-feedback'))).toMatch(
        /Could not delete "Klubbmästerskap 2026": Audio is used by the loaded program - unload the program first/,
      ),
    );
    // Refused, not removed.
    expect(screen.getByTestId('audios-row-100')).toBeTruthy();
  });

  it('relays "a program is running" when the loaded program does not use the clip', async () => {
    const id = await uploadProgram('Does not use the clip');
    await loadProgram(id);
    await startProgram(id);

    renderAudios();
    await waitForClips();

    deleteClip(100);

    await waitFor(() =>
      expect(text(screen.getByTestId('audios-feedback'))).toMatch(
        /Could not delete "Klubbmästerskap 2026": A program is running - stop it before deleting audio/,
      ),
    );
    expect(screen.getByTestId('audios-row-100')).toBeTruthy();
  });

  it('orders loaded-program use ahead of a run in progress when both apply', async () => {
    // Hitting two conditions at once must give the same message the device
    // would - the loaded-program answer, not the more generic running one.
    const id = await uploadProgram('Uses the clip and is running', [100]);
    await loadProgram(id);
    await startProgram(id);

    renderAudios();
    await waitForClips();

    deleteClip(100);

    await waitFor(() =>
      expect(text(screen.getByTestId('audios-feedback'))).toMatch(
        /Could not delete "Klubbmästerskap 2026": Audio is used by the loaded program - unload the program first/,
      ),
    );
  });
});
