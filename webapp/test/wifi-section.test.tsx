// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useControlLockStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18098" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WifiStatus } from '../src/api/types';
import { SettingsProvider } from '../src/context/SettingsContext';
import { WifiSection } from '../src/components/WifiSection';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake. Pick the next free number for a new suite.
const PORT = 18098;

let server: MockServer;
let queryClient: QueryClient;

async function device(wifi?: Partial<WifiStatus>): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: {}, audios: [], wifi },
  });
  await server.listen();
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <WifiSection />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  await server.close();
});

describe('the WiFi block on Settings', () => {
  // The point of the feature. Until now this was a serial-console question,
  // and the answer needed a USB cable at the range.
  it('names the network the device actually joined', async () => {
    await device({ ssid: 'Klubbnat' });
    renderSection();

    expect((await screen.findByTestId('wifi-ssid')).textContent).toContain('Klubbnat');
  });

  it('shows the signal as bars and as the figure somebody diagnosing needs', async () => {
    await device({ rssi: -71, bars: 2 });
    renderSection();

    const signal = await screen.findByTestId('wifi-signal');
    await waitFor(() => {
      expect(signal.textContent).toContain('-71 dBm');
    });
    // The bars come from the firmware's own bucketing, not this app's - where
    // "two bars" ends is a judgement about the radio, and one made in two
    // places is one that drifts.
    expect(screen.getByTestId('wifi-bars').getAttribute('aria-label')).toBe('Signal 2 of 4');
  });

  it('shows the address and the MAC a router would list the device under', async () => {
    await device({ ipAddress: '192.168.5.217', macAddress: '30:ed:a0:a8:ab:78' });
    renderSection();

    expect((await screen.findByTestId('wifi-ip')).textContent).toContain('192.168.5.217');
    expect((await screen.findByTestId('wifi-mac')).textContent).toContain('30:ed:a0:a8:ab:78');
  });

  // A reading of 0 dBm is not a very strong signal, it is no reading at all.
  it('says the signal is unknown when the device is not associated', async () => {
    await device({ connected: false, ssid: '', rssi: 0, bars: 0 });
    renderSection();

    const signal = await screen.findByTestId('wifi-signal');
    await waitFor(() => {
      expect(signal.textContent).toContain('unknown');
    });
    expect(signal.textContent).not.toContain('0 dBm');
    expect((await screen.findByTestId('wifi-ssid')).textContent).toContain('Not connected');
  });

  // The difference between "somebody set this up here" and "it is running on
  // whatever it was built with" - and the latter cannot be read back or
  // changed without a rebuild, so it is worth saying out loud.
  it('says when no network has been saved and the device is on its compiled seeds', async () => {
    await device({ provisioned: false });
    renderSection();

    expect(await screen.findByTestId('wifi-unprovisioned')).toBeTruthy();
  });

  it('stays quiet about provisioning on a device that has been set up', async () => {
    await device({ provisioned: true });
    renderSection();

    await screen.findByTestId('wifi-ssid');
    expect(screen.queryByTestId('wifi-unprovisioned')).toBeNull();
  });

  // The Ethernet build (QEMU) has no radio. Said plainly rather than rendered
  // as an empty table, which reads as a fault.
  it('says so plainly on a build with no radio', async () => {
    await device({ radioPresent: false, connected: false, ssid: '', rssi: 0, bars: 0, macAddress: '' });
    renderSection();

    expect(await screen.findByTestId('wifi-no-radio')).toBeTruthy();
    expect(screen.queryByTestId('wifi-signal')).toBeNull();
  });

  // The whole reason this section is read-only: changing the network restarts
  // the device, and Settings is the page nothing on it can hurt you from.
  it('offers no way to change anything, and says where the change lives', async () => {
    await device();
    renderSection();

    // Waited for the loaded state: the section renders "Asking the device…"
    // first, and an assertion that passed against that would prove nothing.
    await screen.findByTestId('wifi-ssid');

    const section = screen.getByTestId('wifi-section');
    expect(section.querySelectorAll('input, select, button')).toHaveLength(0);
    expect(section.textContent).toContain('Expert mode');
  });

  // No response in this feature carries a password, in any form. The stored
  // passphrase leaves the device in exactly one place - the coredump inside
  // the troubleshooting bundle - and that is gated on standing at the board.
  it('never renders a password, masked or otherwise', async () => {
    await device({ ssid: 'Klubbnat' });
    renderSection();

    await screen.findByTestId('wifi-ssid');

    const section = screen.getByTestId('wifi-section');
    expect(section.textContent?.toLowerCase()).not.toContain('password');
    expect(section.querySelector('input[type="password"]')).toBeNull();
  });
});
