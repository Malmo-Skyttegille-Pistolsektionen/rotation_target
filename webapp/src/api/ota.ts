import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';

/**
 * Firmware update over the air (#127).
 *
 * The device answers 200 and then restarts about 1.5 s later, so the caller
 * should expect the connection to drop and the device to be briefly
 * unreachable — that is success, not failure.
 */
export function useOtaApi() {
  const { adminToken, logoutAdmin } = useSettings();
  const client = createAuthenticatedClient(adminToken, logoutAdmin);

  return {
    upload: (file: File): Promise<{ status: string; restarting: boolean }> => {
      const body = new FormData();
      body.append('file', file);
      return client.request<{ status: string; restarting: boolean }>('/ota', { method: 'POST', body });
    },
  };
}
