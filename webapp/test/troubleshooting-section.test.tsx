// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18093" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsProvider } from '../src/context/SettingsContext';
import { TroubleshootingSection } from '../src/components/TroubleshootingSection';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { enableAdminElsewhere } from './other-client';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake. Pick the next free number for a new suite.
const PORT = 18093;

let server: MockServer;
let queryClient: QueryClient;
let saved: { filename: string; blob: Blob }[];

interface DeviceOptions {
  configWindowOpen?: boolean;
  coredumpPresent?: boolean;
}

async function device(options: DeviceOptions = {}): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: {
      programs: {},
      audios: [],
      configWindowOpen: options.configWindowOpen ?? true,
      coredumpPresent: options.coredumpPresent,
    },
  });
  await server.listen();
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <TroubleshootingSection />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // The download itself: an object URL and an anchor click, neither of which
  // happy-dom does anything with. Captured so the name the file lands under
  // can be asserted - that name is half the feature.
  saved = [];
  // Spied rather than stubbed whole: the mock server runs in this process and
  // builds a `new URL()` per request, so replacing the global with a plain
  // object takes the server down with it.
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    saved.push({ filename: '', blob: blob as Blob });
    return 'blob:bundle';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (saved.length > 0) saved[saved.length - 1].filename = this.download;
  });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  queryClient.unmount();
  queryClient.clear();
  await server.close();
});

describe('the troubleshooting bundle on Settings', () => {
  // The gate, and the reason the section exists in this shape: the bundle can
  // carry a copy of the device's memory, so it is behind the three-press
  // gesture rather than merely behind admin mode, which is off by default.
  it('is not on the page at all while the configuration window is shut', async () => {
    await device({ configWindowOpen: false });
    renderSection();

    // Waited for rather than asserted immediately: the window state arrives
    // from the device, so "absent" has to survive the response landing.
    await waitFor(() => {
      expect(screen.queryByTestId('troubleshooting-section')).toBeNull();
    });
  });

  it('appears once somebody has opened the window at the device', async () => {
    await device({ configWindowOpen: true });
    renderSection();

    expect(await screen.findByTestId('troubleshooting-section')).toBeTruthy();
  });

  it('says whether there is a crash dump to collect', async () => {
    await device({ coredumpPresent: true });
    renderSection();

    const line = await screen.findByTestId('troubleshooting-coredump');
    // Waited for: the line renders before the diagnostics land, and its
    // first state is the "nothing stored" one.
    await waitFor(() => {
      expect(line.textContent).toContain('crash dump waiting');
    });
  });

  it('says so when there is not, rather than leaving it to be discovered', async () => {
    await device({ coredumpPresent: false });
    renderSection();

    const line = await screen.findByTestId('troubleshooting-coredump');
    await waitFor(() => {
      expect(line.textContent).toContain('No crash dump stored');
    });
  });

  it('names the file for the device, and adds the date the device cannot know', async () => {
    await device();
    renderSection();

    fireEvent.click(await screen.findByTestId('troubleshooting-download'));

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    // The device's half - hostname, version, why it restarted - kept verbatim,
    // with today's date inserted before the extension.
    expect(saved[0].filename).toMatch(/^rotation-target-.+-poweron-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  it('saves the bytes the device sent rather than a JSON parse of them', async () => {
    await device();
    renderSection();

    fireEvent.click(await screen.findByTestId('troubleshooting-download'));

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    // A zip is not JSON, and the client used to be able to answer only JSON.
    // An empty archive is 22 bytes; the assertion is that any bytes arrived.
    expect(saved[0].blob.size).toBeGreaterThan(0);
  });

  it('is not blocked by admin mode, which locks writing and not reading', async () => {
    // Admin mode turned on by somebody else, so this browser holds no token -
    // a competition, locked down to one operator. Collecting a fault report
    // does not interfere with that, and the person most likely to want one is
    // whoever is not driving. The window is what guards the dump.
    await device();
    await enableAdminElsewhere(PORT, 'competition-2026');
    renderSection();

    fireEvent.click(await screen.findByTestId('troubleshooting-download'));

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
  });
});
