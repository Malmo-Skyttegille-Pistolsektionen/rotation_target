// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18092" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsProvider } from '../src/context/SettingsContext';
import { HardwareSection } from '../src/components/HardwareSection';
import { createFakeClock } from './mock-server/clock';
import { HARDWARE_DEFAULTS, createMockServer, type MockServer } from './mock-server/server';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake. Pick the next free number for a new suite.
const PORT = 18092;

let server: MockServer;
let queryClient: QueryClient;

async function device(): Promise<void> {
  server = createMockServer({ clock: createFakeClock(), port: PORT, seed: { programs: {}, audios: [] } });
  await server.listen();
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <HardwareSection />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

/**
 * The section lives on its own page now (#144), so there is nothing to expand -
 * but the fields only exist once the device has answered.
 */
async function open(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('hardware-target-gpio')).toBeTruthy());
}

/** The testid a field is rendered with, to the config key it edits. */
const TESTID_TO_KEY: Record<string, 'targetGpio' | 'ledGpio' | 'i2sPort' | 'i2sBckGpio' | 'i2sWsGpio' | 'i2sDoutGpio' | 'httpPort' | 'wifiMaxRetries'> = {
  'hardware-target-gpio': 'targetGpio',
  'hardware-led-gpio': 'ledGpio',
  'hardware-i2s-port': 'i2sPort',
  'hardware-i2s-bck': 'i2sBckGpio',
  'hardware-i2s-ws': 'i2sWsGpio',
  'hardware-i2s-dout': 'i2sDoutGpio',
  'hardware-http-port': 'httpPort',
  'hardware-wifi-retries': 'wifiMaxRetries',
};

function field(testId: string): HTMLInputElement {
  return screen.getByTestId(testId) as HTMLInputElement;
}

async function type(testId: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(field(testId), { target: { value } });
  });
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

describe('the hardware section', () => {
  // It used to be a collapsible section on Settings. It is now its own page,
  // reached by a button and absent from the main navigation, so there is no
  // toggle - and a stale one would silently hide every field behind a click
  // that no longer exists.
  it('has no expander, because it is a page rather than a section', async () => {
    await device();
    renderSection();

    await open();
    expect(screen.queryByTestId('hardware-toggle')).toBeNull();
    expect(screen.getByTestId('hardware-target-gpio')).toBeTruthy();
  });

  it('shows what the device is configured for', async () => {
    await device();
    renderSection();
    await open();

    expect(field('hardware-target-gpio').value).toBe(String(HARDWARE_DEFAULTS.targetGpio));
    expect(field('hardware-hostname').value).toBe(HARDWARE_DEFAULTS.hostname);
    expect(field('hardware-active-low').checked).toBe(HARDWARE_DEFAULTS.targetActiveLow);
  });

  // Save sends only what changed, so a form left open does not overwrite a
  // field another client set in the meantime.
  it('saves only the fields that were touched', async () => {
    await device();
    renderSection();
    await open();

    await type('hardware-display-name', 'Bana 1');
    await act(async () => {
      fireEvent.click(screen.getByTestId('hardware-save'));
    });

    await waitFor(() => expect(screen.getByTestId('hardware-notice')).toBeTruthy());

    const state = (await (await fetch(`http://127.0.0.1:${String(PORT)}/api/v2/config/hardware`)).json()) as {
      saved: { displayName: string; targetGpio: number };
    };
    expect(state.saved.displayName).toBe('Bana 1');
    expect(state.saved.targetGpio).toBe(HARDWARE_DEFAULTS.targetGpio);
  });

  // The device's RFC 9457 `detail` is the sentence written for the situation -
  // which pin, and why - so it is shown rather than replaced with "invalid".
  it("shows the device's own refusal, not a generic one", async () => {
    await device();
    renderSection();
    await open();

    await type('hardware-target-gpio', '26');
    await act(async () => {
      fireEvent.click(screen.getByTestId('hardware-save'));
    });

    await waitFor(() => expect(screen.getByTestId('hardware-notice').textContent).toContain('flash or PSRAM'));
  });

  it('cannot save until something changes, and Discard puts it back', async () => {
    await device();
    renderSection();
    await open();

    expect((screen.getByTestId('hardware-save') as HTMLButtonElement).disabled).toBe(true);

    await type('hardware-hostname', 'bana-1');
    expect((screen.getByTestId('hardware-save') as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByTestId('hardware-revert'));
    });
    expect(field('hardware-hostname').value).toBe(HARDWARE_DEFAULTS.hostname);
    expect((screen.getByTestId('hardware-save') as HTMLButtonElement).disabled).toBe(true);
  });

  // A pin change that appears to have done nothing is how somebody ends up
  // reflashing a working device, so the gap is stated rather than left to be
  // noticed.
  it('says a saved change is not in use until the device restarts', async () => {
    await device();
    renderSection();
    await open();

    expect(screen.queryByTestId('hardware-restart-required')).toBeNull();

    await type('hardware-target-gpio', '7');
    await act(async () => {
      fireEvent.click(screen.getByTestId('hardware-save'));
    });

    await waitFor(() => expect(screen.getByTestId('hardware-restart-required')).toBeTruthy());
  });

  // Reset is the way back from a configuration that does not suit the board,
  // and is disabled when it would do nothing.
  it('offers a reset only once something differs from the defaults', async () => {
    await device();
    renderSection();
    await open();

    expect((screen.getByTestId('hardware-reset') as HTMLButtonElement).disabled).toBe(true);

    await type('hardware-target-gpio', '7');
    await act(async () => {
      fireEvent.click(screen.getByTestId('hardware-save'));
    });
    await waitFor(() => expect((screen.getByTestId('hardware-reset') as HTMLButtonElement).disabled).toBe(false));

    await act(async () => {
      fireEvent.click(screen.getByTestId('hardware-reset'));
    });
    await waitFor(() => expect((screen.getByTestId('hardware-reset') as HTMLButtonElement).disabled).toBe(true));
  });

  // The reason this section exists is a club adapting a stock release image to
  // their own board, so every pin the firmware reads has to be reachable here -
  // not just the target one.
  it('exposes every configurable pin, grouped by peripheral', async () => {
    await device();
    renderSection();
    await open();

    for (const testId of [
      'hardware-target-gpio',
      'hardware-led-gpio',
      'hardware-i2s-port',
      'hardware-i2s-bck',
      'hardware-i2s-ws',
      'hardware-i2s-dout',
      'hardware-http-port',
      'hardware-wifi-retries',
    ]) {
      expect(field(testId).value).toBe(String(HARDWARE_DEFAULTS[TESTID_TO_KEY[testId]]));
    }

    for (const group of ['hardware-group-targets', 'hardware-group-led', 'hardware-group-audio', 'hardware-group-network']) {
      expect(screen.getByTestId(group)).toBeTruthy();
    }
  });

  // Two peripherals on one pad passes every per-pin check and still does not
  // work: whichever is set up last takes the pin and the other goes quiet.
  it('refuses two peripherals on the same pin', async () => {
    await device();
    renderSection();
    await open();

    await type('hardware-led-gpio', String(HARDWARE_DEFAULTS.i2sBckGpio));
    await act(async () => {
      fireEvent.click(screen.getByTestId('hardware-save'));
    });

    await waitFor(() => expect(screen.getByTestId('hardware-notice').textContent).toContain('same GPIO'));
  });

  // The serial console is the way back from a bad pin, so a configuration that
  // would take it away is refused rather than saved.
  it('refuses a pin that would remove the serial console', async () => {
    await device();
    renderSection();
    await open();

    await type('hardware-target-gpio', '19');
    await act(async () => {
      fireEvent.click(screen.getByTestId('hardware-save'));
    });

    await waitFor(() => expect(screen.getByTestId('hardware-notice').textContent).toContain('USB serial'));
  });

  // The window is what guards these settings (#144): a press at the device,
  // not a password. Nothing is written while it is shut.
  it('refuses to save while the configuration window is closed', async () => {
    server = createMockServer({
      clock: createFakeClock(),
      port: PORT,
      seed: { programs: {}, audios: [], configWindowOpen: false },
    });
    await server.listen();
    renderSection();
    await open();

    await type('hardware-display-name', 'Bana 1');
    await act(async () => {
      fireEvent.click(screen.getByTestId('hardware-save'));
    });

    await waitFor(() => expect(screen.getByTestId('hardware-notice').textContent).toContain('BOOT button'));

    const state = (await (await fetch(`http://127.0.0.1:${String(PORT)}/api/v2/config/hardware`)).json()) as {
      saved: { displayName: string };
      writeWindow: { open: boolean };
    };
    expect(state.writeWindow.open).toBe(false);
    expect(state.saved.displayName).toBe('');
  });

  // Shown because an operator needs to know it; not editable because it is what
  // protects somebody standing downrange (D-31, #144).
  it('shows the boot target state without offering to change it', async () => {
    await device();
    renderSection();
    await open();

    expect(screen.getByTestId('hardware-boot-targets').textContent).toBe('Shown');
    expect(screen.queryByTestId('hardware-boot-targets-input')).toBeNull();
    expect(screen.getByTestId('hardware-boot-targets').closest('div')?.textContent).toContain('serial console');
  });
});
