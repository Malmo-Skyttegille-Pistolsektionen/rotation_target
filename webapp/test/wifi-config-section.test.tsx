// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useControlLockStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18099" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WifiNetwork, WifiStatus } from '../src/api/types';
import { SettingsProvider } from '../src/context/SettingsContext';
import { WifiConfigSection } from '../src/components/WifiConfigSection';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { enableControlLockElsewhere, requestElsewhere } from './other-client';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake. Pick the next free number for a new suite.
const PORT = 18099;

let server: MockServer;
let queryClient: QueryClient;

interface DeviceOptions {
  configWindowOpen?: boolean;
  wifi?: Partial<WifiStatus>;
  wifiNetworks?: WifiNetwork[];
}

async function device(options: DeviceOptions = {}): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: {
      programs: {},
      audios: [],
      configWindowOpen: options.configWindowOpen ?? true,
      wifi: options.wifi,
      wifiNetworks: options.wifiNetworks,
    },
  });
  await server.listen();
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <WifiConfigSection />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

/** What the device would report to the next client to ask. */
async function currentSsid(): Promise<string> {
  const { body } = await requestElsewhere(PORT, 'GET', '/api/v2/wifi');
  return (JSON.parse(body) as WifiStatus).ssid;
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

describe('changing the network from Expert mode', () => {
  it('offers what the scan found, strongest first, with the detail somebody picks on', async () => {
    await device({
      wifiNetworks: [
        { ssid: 'Klubbnat', rssi: -52, bars: 4, channel: 6, auth: 'WPA2' },
        { ssid: 'Grannen', rssi: -78, bars: 1, channel: 11, auth: 'WPA2/WPA3' },
      ],
    });
    renderSection();

    const pick = (await screen.findByTestId('wifi-config-pick')) as HTMLSelectElement;
    await waitFor(() => {
      expect(pick.options).toHaveLength(3); // the placeholder, then two networks
    });
    expect(pick.options[1].textContent).toContain('Klubbnat');
    expect(pick.options[1].textContent).toContain('-52 dBm');
    expect(pick.options[1].textContent).toContain('WPA2');
  });

  // An empty scan is a real answer - nothing in range - not a failure. The
  // text field below it is still the way out, which is the whole reason it is
  // always visible rather than revealed by an "other" option.
  it('says the scan found nothing rather than looking broken', async () => {
    await device({ wifiNetworks: [] });
    renderSection();

    const pick = (await screen.findByTestId('wifi-config-pick')) as HTMLSelectElement;
    await waitFor(() => {
      expect(pick.options[0].textContent).toContain('no networks found');
    });
    expect(screen.getByTestId('wifi-config-manual')).toBeTruthy();
  });

  it('names the network the device is on now, which is what makes a mistake visible', async () => {
    await device({ wifi: { ssid: 'Klubbnat' } });
    renderSection();

    expect((await screen.findByTestId('wifi-config-current')).textContent).toContain('Klubbnat');
  });

  // Mirrors rt::chosen_ssid, and the reason it is mirrored: somebody who typed
  // a name did so after seeing the list.
  it('sends the typed name rather than the dropdown when both are filled', async () => {
    await device({ wifi: { ssid: 'Klubbnat' } });
    renderSection();

    fireEvent.change(await screen.findByTestId('wifi-config-pick'), { target: { value: 'Klubbnat' } });
    fireEvent.change(screen.getByTestId('wifi-config-manual'), { target: { value: '  Hidden-AP  ' } });
    fireEvent.click(screen.getByTestId('wifi-config-save'));
    fireEvent.click(await screen.findByTestId('wifi-config-confirm-save'));

    // Trimmed, too: a phone keyboard's trailing space saved as part of the name
    // fails the join with nothing on screen to explain why.
    await waitFor(async () => {
      expect(await currentSsid()).toBe('Hidden-AP');
    });
  });

  // The one control in the app that deliberately takes the device away from
  // the browser using it, so it is described before it happens - afterwards
  // there is no page to explain it on.
  it('will not save without a confirmation that says the device is about to go', async () => {
    await device();
    renderSection();

    fireEvent.change(await screen.findByTestId('wifi-config-manual'), { target: { value: 'Elsewhere' } });
    fireEvent.click(screen.getByTestId('wifi-config-save'));

    const confirm = await screen.findByTestId('wifi-config-confirm');
    expect(confirm.textContent).toContain('restart');
    expect(confirm.textContent).toContain('setup');
    // Nothing has been sent yet.
    expect(await currentSsid()).not.toBe('Elsewhere');
  });

  it('leaves the device alone when the confirmation is declined', async () => {
    await device({ wifi: { ssid: 'Klubbnat' } });
    renderSection();

    fireEvent.change(await screen.findByTestId('wifi-config-manual'), { target: { value: 'Elsewhere' } });
    fireEvent.click(screen.getByTestId('wifi-config-save'));
    fireEvent.click(await screen.findByTestId('wifi-config-cancel'));

    await waitFor(() => {
      expect(screen.queryByTestId('wifi-config-confirm')).toBeNull();
    });
    expect(await currentSsid()).toBe('Klubbnat');
  });

  it('cannot be saved with neither a choice nor a typed name', async () => {
    await device();
    renderSection();

    const save = (await screen.findByTestId('wifi-config-save')) as HTMLButtonElement;
    await waitFor(() => {
      expect(save.disabled).toBe(true);
    });
  });

  it('reports what the device said when it refuses', async () => {
    // The window shut - somebody bookmarked this page, or five minutes passed
    // while the form was open.
    await device({ configWindowOpen: false });
    renderSection();

    fireEvent.change(await screen.findByTestId('wifi-config-manual'), { target: { value: 'Elsewhere' } });
    fireEvent.click(screen.getByTestId('wifi-config-save'));
    fireEvent.click(await screen.findByTestId('wifi-config-confirm-save'));

    // RFC 9457 (D-19): the device's own sentence, which is the one that says
    // how to open the window.
    const notice = await screen.findByTestId('wifi-config-notice');
    await waitFor(() => {
      expect(notice.textContent).toContain('BOOT');
    });
  });

  // Unlike the troubleshooting bundle, this *is* a write - so the lock that
  // exists to stop one person interfering with another applies to it.
  it('is locked out while the control lock is on and this browser holds no token', async () => {
    await device();
    await enableControlLockElsewhere(PORT, 'competition-2026');
    renderSection();

    expect(await screen.findByTestId('wifi-config-locked')).toBeTruthy();
    const save = screen.getByTestId('wifi-config-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('shows the password only while somebody is holding the button down', async () => {
    await device();
    renderSection();

    const field = (await screen.findByTestId('wifi-config-password')) as HTMLInputElement;
    expect(field.type).toBe('password');

    const reveal = screen.getByTestId('wifi-config-reveal');
    fireEvent.click(reveal);
    expect(field.type).toBe('text');
    // A screen reader needs both: the label says what the button will do next,
    // aria-pressed says what the state is now.
    expect(reveal.getAttribute('aria-pressed')).toBe('true');
    expect(reveal.getAttribute('aria-label')).toBe('Hide password');

    fireEvent.click(reveal);
    expect(field.type).toBe('password');
  });

  // An open network is a decision, not a typo to catch.
  it('saves an open network with no password at all', async () => {
    await device();
    renderSection();

    fireEvent.change(await screen.findByTestId('wifi-config-manual'), { target: { value: 'OpenNet' } });
    fireEvent.click(screen.getByTestId('wifi-config-save'));
    fireEvent.click(await screen.findByTestId('wifi-config-confirm-save'));

    await waitFor(async () => {
      expect(await currentSsid()).toBe('OpenNet');
    });
  });
});
