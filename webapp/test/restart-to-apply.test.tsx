// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useControlLockStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18100" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StateUpdatePayload } from '../src/api/types';
import { SettingsProvider } from '../src/context/SettingsContext';
import { RestartPendingNotice } from '../src/components/RestartPendingNotice';
import { HardwarePage } from '../src/routes/hardware';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';
import { enableControlLockElsewhere, requestElsewhere } from './other-client';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake. Pick the next free number for a new suite.
const PORT = 18100;

let server: MockServer;
let queryClient: QueryClient;

async function device(): Promise<void> {
  server = createMockServer({ clock: createFakeClock(), port: PORT, seed: { programs: {}, audios: [] } });
  await server.listen();
}

/**
 * Both surfaces in one router: the Expert mode page that carries the button,
 * and a Settings stand-in carrying the notice that points back at it. The link
 * between them is the only way to the button once the five-minute window has
 * lapsed and the tab is gone.
 */
function renderApp(at: '/hardware' | '/settings'): void {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const hardwareRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/hardware',
    component: HardwarePage,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: () => (
      <>
        <h1>Settings</h1>
        <RestartPendingNotice />
      </>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([hardwareRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: [at] }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <RouterProvider router={router} />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

/** Save something the device will not be running until it restarts. */
async function saveHardware(gpio = 7): Promise<void> {
  const { status } = await requestElsewhere(PORT, 'PUT', '/api/v2/config/hardware', {
    banks: [{ gpio, activeLow: true, name: '' }],
  });
  expect(status).toBe(200);
}

/** What `useSSE` would have written after a start. */
function pretendRunning(): void {
  queryClient.setQueryData(['state'], {
    loadedProgramId: 40,
    programState: { running: true, currentSeriesIndex: 0, currentEventIndex: 0, tickerMs: 0 },
    targetBanks: { A: 'shown' },
  } as unknown as StateUpdatePayload);
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

describe('restart to apply (#341)', () => {
  // Driven by what the device reports, not by unsaved form edits - those are
  // what each section's Save button is for.
  it('offers nothing while the device is running what it was told', async () => {
    await device();
    renderApp('/hardware');

    await screen.findByTestId('hardware-section');
    expect(screen.queryByTestId('restart-to-apply')).toBeNull();
  });

  it('appears on the Expert page once something is saved', async () => {
    await device();
    renderApp('/hardware');
    await screen.findByTestId('hardware-section');
    await saveHardware();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['hardware-config'] });
    });

    expect(await screen.findByTestId('restart-to-apply')).toBeTruthy();
  });

  it('says on Settings that something is saved but not applied', async () => {
    await device();
    await saveHardware();
    renderApp('/settings');

    expect((await screen.findByTestId('restart-pending-notice')).textContent).toContain(
      'saved but not applied',
    );
  });

  // A pending restart is a fact about the device, not about the window (D-42).
  it('survives the configuration window lapsing, unlike the sections', async () => {
    await device();
    await saveHardware();
    server.setConfigWindow(false);
    renderApp('/hardware');

    expect(await screen.findByTestId('restart-to-apply')).toBeTruthy();
    await screen.findByTestId('config-window-shut');
    // The forms are gone - there is nothing the device would accept from them.
    expect(screen.queryByTestId('wifi-config-section')).toBeNull();
    expect(screen.queryByTestId('hardware-section')).toBeNull();
  });

  it('confirms, restarts, and then says the device has gone', async () => {
    await device();
    await saveHardware();
    renderApp('/hardware');

    fireEvent.click(await screen.findByTestId('restart-to-apply'));
    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain('lose contact');

    await act(async () => {
      fireEvent.click(screen.getByText('Restart'));
    });

    expect((await screen.findByTestId('restart-notice')).textContent).toContain('unreachable');
    expect((screen.getByTestId('restart-to-apply') as HTMLButtonElement).disabled).toBe(true);
  });

  // The dead end this closes: `restarting` used to be cleared only by a failed
  // request, so one successful restart left the button saying "Restarting…" and
  // refusing to be pressed - while the Settings notice kept pointing at it.
  it('is pressable again once the device is back and something else is saved', async () => {
    await device();
    await saveHardware();
    renderApp('/hardware');

    fireEvent.click(await screen.findByTestId('restart-to-apply'));
    await act(async () => {
      fireEvent.click(screen.getByText('Restart'));
    });
    expect((screen.getByTestId('restart-to-apply') as HTMLButtonElement).disabled).toBe(true);

    // The device comes back running what it was told, and the stream returns -
    // which is what `useSSE` does on reconnect.
    server.restart();
    await act(async () => {
      queryClient.setQueryData(['sse-status'], 'connected');
      await queryClient.invalidateQueries({ queryKey: ['hardware-config'] });
    });

    // Nothing pending, so nothing offered.
    await waitFor(() => expect(screen.queryByTestId('restart-to-apply')).toBeNull());

    // And the next change - a different pin, or there would be nothing pending -
    // gets a working button rather than a stuck one.
    await saveHardware(8);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['hardware-config'] });
    });
    const again = (await screen.findByTestId('restart-to-apply')) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
    expect(again.textContent).toContain('Restart to apply');
  });

  it('is disabled while a program is running, and says why', async () => {
    await device();
    await saveHardware();
    pretendRunning();
    renderApp('/hardware');

    const button = (await screen.findByTestId('restart-to-apply')) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('program is running');
  });

  // Restarting is changing the device, so the lock that stops one operator
  // interfering with another applies (D-40).
  it('is disabled while the control lock is on and this browser holds no token', async () => {
    await device();
    await saveHardware();
    await enableControlLockElsewhere(PORT, 'competition-2026');
    renderApp('/hardware');

    const button = (await screen.findByTestId('restart-to-apply')) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(button.title).toContain('locked');
  });
});
