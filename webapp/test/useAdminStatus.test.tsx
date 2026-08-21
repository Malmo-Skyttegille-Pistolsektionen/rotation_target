// @vitest-environment happy-dom
// The mock server binds this port so the app is same-origin with it, which is
// how it runs for real (the firmware serves the webapp). Cross-origin would
// need the device's CORS allowlist, which the mock does not implement.
// @vitest-environment-options { "url": "http://127.0.0.1:18080" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsProvider, useSettings } from '../src/context/SettingsContext';
import { useAdminStatus } from '../src/hooks/useAdminStatus';
import { createFakeClock } from './mock-server/clock';
import { enableAdminElsewhere as enableAdminOn } from './other-client';
import { createMockServer, type MockServer } from './mock-server/server';

// Below 32768, out of the Linux ephemeral range: a runner process can
// legitimately hold a port in 32768-60999, and the bind would lose the race.
const PORT = 18080;

function enableAdminElsewhere(password: string): Promise<string> {
  return enableAdminOn(PORT, password);
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
function renderAdmin() {
  return renderHook(() => ({ admin: useAdminStatus(), settings: useSettings() }), { wrapper });
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
  document.cookie = 'admin=; Path=/; Max-Age=0';
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
});

describe("status is the server's to tell", () => {
  it("starts loading and settles on the server's answer", async () => {
    const { result } = renderAdmin();

    expect(result.current.admin.isLoading).toBe(true);
    await waitFor(() => expect(result.current.admin.isLoading).toBe(false));
    expect(result.current.admin.adminModeEnabled).toBe(false);
  });

  it('picks up a change made by another client, on window focus', async () => {
    const { result } = renderAdmin();
    await waitFor(() => expect(result.current.admin.isLoading).toBe(false));

    // Somebody else enables admin mode on the same device.
    await enableAdminElsewhere('competition-2026');
    expect(result.current.admin.adminModeEnabled).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(result.current.admin.adminModeEnabled).toBe(true));
  });

  it('polls the status endpoint on the 30 s interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const statusCalls = (): number =>
      fetchSpy.mock.calls.filter((call) => String(call[0]).endsWith('/admin-mode/status')).length;

    const { result } = renderAdmin();
    await waitFor(() => expect(result.current.admin.isLoading).toBe(false));
    expect(statusCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(statusCalls()).toBe(2));

    vi.useRealTimers();
  });
});

describe('the three states of admin mode', () => {
  it('OFF -> ON: enable stores the issued token and re-reads the status', async () => {
    const { result } = renderAdmin();
    await waitFor(() => expect(result.current.admin.isLoading).toBe(false));

    await act(async () => {
      await result.current.admin.enable('competition-2026');
    });

    expect(result.current.settings.adminToken).toEqual(expect.any(String));
    await waitFor(() => expect(result.current.admin.adminModeEnabled).toBe(true));
  });

  it("refuses a second enable while admin mode is on, with the server's message", async () => {
    await enableAdminElsewhere('competition-2026');

    const { result } = renderAdmin();
    await waitFor(() => expect(result.current.admin.adminModeEnabled).toBe(true));

    await expect(result.current.admin.enable('another-password')).rejects.toThrow(/already enabled/);
    expect(result.current.settings.adminToken).toBeNull();
  });

  it('ON + spectator -> ON + admin: login with the right password, rejected with the wrong one', async () => {
    await enableAdminElsewhere('competition-2026');

    const { result } = renderAdmin();
    await waitFor(() => expect(result.current.admin.adminModeEnabled).toBe(true));
    expect(result.current.settings.adminToken).toBeNull();

    await expect(result.current.admin.login('wrong')).rejects.toThrow(/Invalid password/);
    expect(result.current.settings.adminToken).toBeNull();

    await act(async () => {
      await result.current.admin.login('competition-2026');
    });
    expect(result.current.settings.adminToken).toEqual(expect.any(String));
  });

  it("logout drops this client's token but leaves admin mode on", async () => {
    const { result } = renderAdmin();
    await waitFor(() => expect(result.current.admin.isLoading).toBe(false));
    await act(async () => {
      await result.current.admin.enable('competition-2026');
    });
    await waitFor(() => expect(result.current.admin.adminModeEnabled).toBe(true));

    act(() => result.current.admin.logout());

    expect(result.current.settings.adminToken).toBeNull();
    await waitFor(() => expect(result.current.admin.adminModeEnabled).toBe(true));
  });

  it('ON -> OFF: disable clears the token and everyone sees it', async () => {
    const { result } = renderAdmin();
    await waitFor(() => expect(result.current.admin.isLoading).toBe(false));
    await act(async () => {
      await result.current.admin.enable('competition-2026');
    });
    await waitFor(() => expect(result.current.admin.adminModeEnabled).toBe(true));

    await act(async () => {
      await result.current.admin.disable();
    });

    expect(result.current.settings.adminToken).toBeNull();
    await waitFor(() => expect(result.current.admin.adminModeEnabled).toBe(false));
  });

  it('drops a token the server no longer knows, on the 401 it comes back with', async () => {
    // The password-changed case from docs/admin-auth-flow.md: admin mode was
    // cycled off and on elsewhere, so this client's token is stale.
    localStorage.setItem('rt_settings_admin_token', 'a-token-from-a-previous-session');
    await enableAdminElsewhere('competition-2026');

    const { result } = renderAdmin();
    await waitFor(() => expect(result.current.admin.adminModeEnabled).toBe(true));
    expect(result.current.settings.adminToken).toBe('a-token-from-a-previous-session');

    await expect(result.current.admin.disable()).rejects.toThrow();
    await waitFor(() => expect(result.current.settings.adminToken).toBeNull());
  });
});
