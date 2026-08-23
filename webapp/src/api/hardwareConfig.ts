import { useSettings } from '../context/SettingsContext';
import type { HardwareConfig, HardwareConfigState } from './types';
import { createAuthenticatedClient } from './client';

/**
 * The hardware a device can be told about without rebuilding it (#144).
 *
 * `save` takes a partial: the device keeps any field the request does not
 * mention, so a form that only changed the display name sends only that. It
 * also refuses `targetsShownAtBoot` outright — that one changes from the serial
 * console only, and is `readOnly` in the contract for the same reason — so the
 * type here excludes it rather than letting a caller send something guaranteed
 * to come back 400.
 */
export type HardwareConfigPatch = Partial<Omit<HardwareConfig, 'targetsShownAtBoot'>>;

export function useHardwareConfigApi() {
  const { adminToken, logoutAdmin } = useSettings();
  const client = createAuthenticatedClient(adminToken, logoutAdmin);

  return {
    get: (): Promise<HardwareConfigState> => client.request<HardwareConfigState>('/config/hardware'),

    save: (patch: HardwareConfigPatch): Promise<{ message: string }> =>
      client.request<{ message: string }>('/config/hardware', {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),

    reset: (): Promise<{ message: string }> =>
      client.request<{ message: string }>('/config/hardware/reset', { method: 'POST' }),
  };
}
