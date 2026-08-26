import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';
import type { WifiCredentials, WifiNetwork, WifiStatus } from './types';

/**
 * Which network the device is on, and moving it to another one (#263).
 *
 * `status` is public and cheap — Settings polls it. `networks` and `save` are
 * not: a scan takes the radio off its channel for a couple of seconds, and a
 * save restarts the device, so both are behind the configuration window and
 * only ever called from Expert mode.
 *
 * No call here reads a password back, because no response carries one. The
 * stored passphrase leaves the device in exactly one place — the coredump
 * inside the troubleshooting bundle — and that is gated on standing at the
 * board for this reason.
 */
export function useWifiApi() {
  const { controlLockToken, logoutControlLock } = useSettings();
  const client = createAuthenticatedClient(controlLockToken, logoutControlLock);

  return {
    status: (): Promise<WifiStatus> => client.request<WifiStatus>('/wifi'),

    networks: (): Promise<{ networks: WifiNetwork[] }> =>
      client.request<{ networks: WifiNetwork[] }>('/wifi/networks'),

    // The device answers, *then* restarts. So a resolved promise means "saved
    // and rebooting", not "reachable on the new network" — nothing here can
    // tell the caller the second thing, because the connection it would have
    // to ask over is the one being taken away.
    save: (credentials: WifiCredentials): Promise<{ message: string }> =>
      client.request<{ message: string }>('/wifi', {
        method: 'PUT',
        body: JSON.stringify(credentials),
      }),
  };
}
