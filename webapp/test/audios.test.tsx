// @vitest-environment happy-dom
// Same-origin with the mock server, for the reason spelled out in
// useAdminStatus.test.tsx: the mock implements no CORS allowlist.
// @vitest-environment-options { "url": "http://127.0.0.1:18081" }
import http from 'http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_UPLOAD_BYTES } from '../src/api/audios';
import type { AudioFile, BackendIssuePayload } from '../src/api/types';
import { SettingsProvider } from '../src/context/SettingsContext';
import { Route } from '../src/routes/audios';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';

// Out of the Linux ephemeral range, and not the port useAdminStatus.test.tsx
// binds — vitest runs the two files in parallel.
const PORT = 18081;

const AudiosView = Route.options.component!;

/** Deliberately out of id order: the view is what sorts. */
const SEED_AUDIOS: AudioFile[] = [
  { id: 3, title: 'Eld upphör', filename: '/storage/shipped/audio/3.wav', readonly: true },
  { id: 1, title: 'Färdiga', filename: '/storage/shipped/audio/1.wav', readonly: true },
  { id: 1001, title: 'Klubbmästerskap 2026', filename: '/storage/uploads/audio/1001.wav', readonly: false },
];

/** A minimal RIFF/WAVE header — enough for the mock's format check. */
function wavFile(name = 'signal.wav', byteLength = 64): File {
  const bytes = new Uint8Array(byteLength);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WAVE'), 8);
  return new File([bytes], name, { type: 'audio/wav' });
}

/** See useAdminStatus.test.tsx: a request from another client, so no cookie lands in this page's jar. */
function enableAdminElsewhere(password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ password });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: '/api/v2/admin-mode/enable',
        method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      },
    );
    req.on('error', reject);
    req.end(body);
  });
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
  await screen.findByTestId('audios-row-1');
}

function selectFile(file: File): void {
  const input = screen.getByTestId('audios-upload-file');
  fireEvent.change(input, { target: { files: [file] } });
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
  document.cookie = 'admin=; Path=/; Max-Age=0';
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
});

describe('the audio library', () => {
  it('lists every clip in id order, marking shipped and uploaded apart', async () => {
    renderAudios();
    await waitForClips();

    const ids = screen.getAllByTestId(/^audios-row-/).map((row) => row.getAttribute('data-testid'));
    expect(ids).toEqual(['audios-row-1', 'audios-row-3', 'audios-row-1001']);

    expect(text(screen.getByTestId('audios-source-1'))).toBe('Shipped');
    expect(text(screen.getByTestId('audios-source-3'))).toBe('Shipped');
    expect(text(screen.getByTestId('audios-source-1001'))).toBe('Uploaded');

    expect(within(screen.getByTestId('audios-row-1001')).getByText('Klubbmästerskap 2026')).toBeTruthy();
  });

  it('offers Delete on uploaded clips only — a shipped one answers 404', async () => {
    renderAudios();
    await waitForClips();

    expect(screen.queryByTestId('audios-delete-1')).toBeNull();
    expect(screen.queryByTestId('audios-delete-3')).toBeNull();
    expect(screen.getByTestId('audios-delete-1001')).toBeTruthy();

    // Play is offered for both.
    expect(screen.getByTestId('audios-play-1')).toBeTruthy();
    expect(screen.getByTestId('audios-play-1001')).toBeTruthy();
  });
});

describe('admin mode gates the mutating controls', () => {
  it('admin ON without a token: view only, no upload form and no row actions', async () => {
    await enableAdminElsewhere('competition-2026');

    renderAudios();
    await waitForClips();

    await screen.findByTestId('audios-view-only');
    expect(screen.queryByTestId('audios-upload-form')).toBeNull();
    expect(screen.queryByTestId('audios-play-1')).toBeNull();
    expect(screen.queryByTestId('audios-delete-1001')).toBeNull();
  });

  it('admin ON with a token: the controls come back', async () => {
    await enableAdminElsewhere('competition-2026');
    localStorage.setItem('rt_settings_admin_token', 'a-token');

    renderAudios();
    await waitForClips();

    expect(screen.getByTestId('audios-upload-form')).toBeTruthy();
    expect(screen.getByTestId('audios-play-1')).toBeTruthy();
    expect(screen.queryByTestId('audios-view-only')).toBeNull();
  });

  it('admin OFF: everyone controls, as the device allows', async () => {
    renderAudios();
    await waitForClips();

    expect(screen.getByTestId('audios-upload-form')).toBeTruthy();
    expect(screen.queryByTestId('audios-view-only')).toBeNull();
  });
});

describe('upload', () => {
  it('fills the title from the filename, the way the legacy tab did', async () => {
    renderAudios();
    await waitForClips();

    selectFile(wavFile('eld-upphor.wav'));

    await waitFor(() =>
      expect((screen.getByTestId('audios-upload-title') as HTMLInputElement).value).toBe('eld-upphor'),
    );
  });

  it('refuses a file over the 1 MiB ceiling without troubling the device', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderAudios();
    await waitForClips();

    selectFile(wavFile('too-big.wav', MAX_UPLOAD_BYTES + 1));
    fireEvent.click(screen.getByTestId('audios-upload-submit'));

    const feedback = await screen.findByTestId('audios-feedback');
    expect(text(feedback)).toMatch(/larger than the 1 MiB/);

    const uploads = fetchSpy.mock.calls.filter(
      (call) => String(call[0]).endsWith('/audios') && (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(uploads).toHaveLength(0);
  });

  it("surfaces the device's own rejection of an unplayable file", async () => {
    renderAudios();
    await waitForClips();

    // A .wav name over something that is not RIFF/WAVE — exactly what the
    // firmware's `probe_wav` refuses after the file has landed.
    selectFile(new File([new Uint8Array(32)], 'not-really.wav', { type: 'audio/wav' }));
    fireEvent.click(screen.getByTestId('audios-upload-submit'));

    const feedback = await screen.findByTestId('audios-feedback');
    expect(text(feedback)).toMatch(/Upload failed: Unsupported audio format/);

    // The form keeps what was typed, so the user can retry with another file.
    expect(screen.queryByTestId('audios-row-1002')).toBeNull();
  });

  it('adds the accepted clip to the list', async () => {
    renderAudios();
    await waitForClips();

    selectFile(wavFile('nedslag.wav'));
    fireEvent.click(screen.getByTestId('audios-upload-submit'));

    const row = await screen.findByTestId('audios-row-1002');
    expect(within(row).getByText('nedslag')).toBeTruthy();
    expect(text(screen.getByTestId('audios-source-1002'))).toBe('Uploaded');
    expect(text(await screen.findByTestId('audios-feedback'))).toMatch(/Uploaded "nedslag" as clip 1002/);
  });
});

describe('play and delete', () => {
  it('confirms before deleting, then drops the row', async () => {
    renderAudios();
    await waitForClips();

    fireEvent.click(screen.getByTestId('audios-delete-1001'));
    // Nothing has left yet — the row is still there, now asking.
    expect(screen.getByTestId('audios-row-1001')).toBeTruthy();

    fireEvent.click(screen.getByTestId('audios-delete-confirm-1001'));

    await waitFor(() => expect(screen.queryByTestId('audios-row-1001')).toBeNull());
    expect(text(screen.getByTestId('audios-feedback'))).toMatch(/Deleted "Klubbmästerskap 2026"/);
  });

  it('backs out of a delete on Cancel', async () => {
    renderAudios();
    await waitForClips();

    fireEvent.click(screen.getByTestId('audios-delete-1001'));
    fireEvent.click(screen.getByTestId('audios-delete-cancel-1001'));

    expect(screen.getByTestId('audios-delete-1001')).toBeTruthy();
    expect(screen.getByTestId('audios-row-1001')).toBeTruthy();
  });

  it('relays the 409 when the clip is playing, rather than swallowing it', async () => {
    renderAudios();
    await waitForClips();

    fireEvent.click(screen.getByTestId('audios-play-1001'));
    await waitFor(() => expect(text(screen.getByTestId('audios-feedback'))).toMatch(/Playing "Klubbmästerskap/));

    fireEvent.click(screen.getByTestId('audios-delete-1001'));
    fireEvent.click(screen.getByTestId('audios-delete-confirm-1001'));

    await waitFor(() =>
      expect(text(screen.getByTestId('audios-feedback'))).toMatch(
        /Could not delete "Klubbmästerskap 2026": Audio is currently playing/,
      ),
    );
    expect(screen.getByTestId('audios-row-1001')).toBeTruthy();
  });
});

describe('backend_issue', () => {
  const playbackFailed: BackendIssuePayload = {
    code: 'audio_playback_failed',
    message: 'Could not open /storage/uploads/audio/1001.wav',
    context: { clip: '/storage/uploads/audio/1001.wav' },
  };

  it('shows what useSSE parked in the cache, and dismisses it for good', async () => {
    renderAudios();
    await waitForClips();
    expect(screen.queryByTestId('backend-issue-banner')).toBeNull();

    // What `useSSE` does when a backend_issue frame arrives.
    queryClient.setQueryData(['backend-issue'], playbackFailed);

    const banner = await screen.findByTestId('backend-issue-banner');
    expect(text(banner)).toContain('Could not open /storage/uploads/audio/1001.wav');
    expect(text(banner)).toContain('clip: /storage/uploads/audio/1001.wav');

    fireEvent.click(within(banner).getByLabelText('Dismiss'));

    await waitFor(() => expect(screen.queryByTestId('backend-issue-banner')).toBeNull());
  });

  it('ignores an issue that is not about audio', async () => {
    renderAudios();
    await waitForClips();

    queryClient.setQueryData(['backend-issue'], {
      code: 'program_invalid',
      message: 'Skipped /storage/uploads/programs/7.json',
    } satisfies BackendIssuePayload);

    // Nothing to wait for, so let a render pass go by before asserting.
    await waitFor(() => expect(screen.getByTestId('audios-row-1')).toBeTruthy());
    expect(screen.queryByTestId('backend-issue-banner')).toBeNull();
  });
});
