import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';
import type { WifiCredentials, WifiNetwork, WifiStatus } from './types';

/**
 * Which network the device is on, and moving it to another one (#263).
 *
 * `status` is public and cheap — Settings polls it. `networks` and `save` are
 * not: a scan takes the radio off its channel for a couple of seconds, and a
 * save changes where the device will look for its network, so both are behind
 * the configuration window and only ever called from Expert mode.
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

    // Stores only, since #341: the device stays on the network it is on and
    // reports `restartRequired` until POST /system/restart adopts this.
    save: (credentials: WifiCredentials): Promise<{ message: string }> =>
      client.request<{ message: string }>('/wifi', {
        method: 'PUT',
        body: JSON.stringify(credentials),
      }),
  };
}
