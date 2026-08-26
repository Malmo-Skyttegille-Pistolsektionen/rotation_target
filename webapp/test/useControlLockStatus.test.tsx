// @vitest-environment happy-dom
// The mock server binds this port so the app is same-origin with it, which is
// how it runs for real (the firmware serves the webapp). Cross-origin would
// need the device's CORS allowlist, which the mock does not implement.
// @vitest-environment-options { "url": "http://127.0.0.1:18080" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsProvider, useSettings } from '../src/context/SettingsContext';
import { useControlLockStatus } from '../src/hooks/useControlLockStatus';
import { createFakeClock } from './mock-server/clock';
import { enableControlLockElsewhere as enableControlLockOn } from './other-client';
import { createMockServer, type MockServer } from './mock-server/server';

// Below 32768, out of the Linux ephemeral range: a runner process can
// legitimately hold a port in 32768-60999, and the bind would lose the race.
const PORT = 18080;

function enableControlLockElsewhere(password: string): Promise<string> {
  return enableControlLockOn(PORT, password);
}

let server: MockServer;
let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>{children}</SettingsProvider>
    </QueryClientProvider>
  );
}

/** The hook under test plus the context it writes the token into. */
function renderControlLock() {
  return renderHook(() => ({ lock: useControlLockStatus(), settings: useSettings() }), { wrapper });
}

// One server for the file, reset between tests: rebinding the same port each
// time leaves the page's keep-alive socket pointing at a dead listener.
beforeAll(async () => {
  server = createMockServer({ clock: createFakeClock(), port: PORT, seed: { programs: {}, audios: [] } });
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

describe("status is the server's to tell", () => {
  it("starts loading and settles on the server's answer", async () => {
    const { result } = renderControlLock();

    expect(result.current.lock.isLoading).toBe(true);
    await waitFor(() => expect(result.current.lock.isLoading).toBe(false));
    expect(result.current.lock.controlLockEnabled).toBe(false);
  });

  it('picks up a change made by another client, on window focus', async () => {
    const { result } = renderControlLock();
    await waitFor(() => expect(result.current.lock.isLoading).toBe(false));

    // Somebody else turns the lock on, on the same device.
    await enableControlLockElsewhere('competition-2026');
    expect(result.current.lock.controlLockEnabled).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(result.current.lock.controlLockEnabled).toBe(true));
  });

  it('polls the status endpoint on the 30 s interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const statusCalls = (): number =>
      fetchSpy.mock.calls.filter((call) => String(call[0]).endsWith('/control-lock/status')).length;

    const { result } = renderControlLock();
    await waitFor(() => expect(result.current.lock.isLoading).toBe(false));
    expect(statusCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(statusCalls()).toBe(2));

    vi.useRealTimers();
  });
});

describe('the three states of the control lock', () => {
  it('OFF -> ON: enable stores the issued token and re-reads the status', async () => {
    const { result } = renderControlLock();
    await waitFor(() => expect(result.current.lock.isLoading).toBe(false));

    await act(async () => {
      await result.current.lock.enable('competition-2026');
    });

    expect(result.current.settings.controlLockToken).toEqual(expect.any(String));
    await waitFor(() => expect(result.current.lock.controlLockEnabled).toBe(true));
  });

  it("refuses a second enable while the lock is on, with the server's message", async () => {
    await enableControlLockElsewhere('competition-2026');

    const { result } = renderControlLock();
    await waitFor(() => expect(result.current.lock.controlLockEnabled).toBe(true));

    await expect(result.current.lock.enable('another-password')).rejects.toThrow(/already on/);
    expect(result.current.settings.controlLockToken).toBeNull();
  });

  it('ON + spectator -> ON + holder: login with the right password, rejected with the wrong one', async () => {
    await enableControlLockElsewhere('competition-2026');

    const { result } = renderControlLock();
    await waitFor(() => expect(result.current.lock.controlLockEnabled).toBe(true));
    expect(result.current.settings.controlLockToken).toBeNull();

    await expect(result.current.lock.login('wrong')).rejects.toThrow(/Invalid password/);
    expect(result.current.settings.controlLockToken).toBeNull();

    await act(async () => {
      await result.current.lock.login('competition-2026');
    });
    expect(result.current.settings.controlLockToken).toEqual(expect.any(String));
  });

  it("logout drops this client's token but leaves the lock on", async () => {
    const { result } = renderControlLock();
    await waitFor(() => expect(result.current.lock.isLoading).toBe(false));
    await act(async () => {
      await result.current.lock.enable('competition-2026');
    });
    await waitFor(() => expect(result.current.lock.controlLockEnabled).toBe(true));

    act(() => result.current.lock.logout());

    expect(result.current.settings.controlLockToken).toBeNull();
    await waitFor(() => expect(result.current.lock.controlLockEnabled).toBe(true));
  });

  it('ON -> OFF: disable clears the token and everyone sees it', async () => {
    const { result } = renderControlLock();
    await waitFor(() => expect(result.current.lock.isLoading).toBe(false));
    await act(async () => {
      await result.current.lock.enable('competition-2026');
    });
    await waitFor(() => expect(result.current.lock.controlLockEnabled).toBe(true));

    await act(async () => {
      await result.current.lock.disable();
    });

    expect(result.current.settings.controlLockToken).toBeNull();
    await waitFor(() => expect(result.current.lock.controlLockEnabled).toBe(false));
  });

  it('drops a token the server no longer knows, on the 401 it comes back with', async () => {
    // The password-changed case from docs/control-lock-auth-flow.md: the lock was
    // cycled off and on elsewhere, so this client's token is stale.
    localStorage.setItem('rt_settings_control_lock_token', 'a-token-from-a-previous-session');
    await enableControlLockElsewhere('competition-2026');

    const { result } = renderControlLock();
    await waitFor(() => expect(result.current.lock.controlLockEnabled).toBe(true));
    expect(result.current.settings.controlLockToken).toBe('a-token-from-a-previous-session');

    await expect(result.current.lock.disable()).rejects.toThrow();
    await waitFor(() => expect(result.current.settings.controlLockToken).toBeNull());
  });
});
