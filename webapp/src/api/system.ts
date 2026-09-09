import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';

/**
 * Restarting the device (#341).
 *
 * The one call that applies configuration: `PUT /config/hardware` and
 * `PUT /wifi` store and nothing more, and each reports `restartRequired` on
 * its `GET` until this runs.
 *
 * Answers 200 and then restarts about 1.5 s later, exactly like
 * {@link useOtaApi}'s upload — a resolved promise means "going down", not
 * "back up", and the caller should expect to lose the device for a few
 * seconds.
 */
export function useSystemApi() {
  const { controlLockToken, logoutControlLock } = useSettings();
  const client = createAuthenticatedClient(controlLockToken, logoutControlLock);

  return {
    restart: (): Promise<{ status: string; restarting: boolean }> =>
      client.request<{ status: string; restarting: boolean }>('/system/restart', {
        method: 'POST',
      }),
  };
}
