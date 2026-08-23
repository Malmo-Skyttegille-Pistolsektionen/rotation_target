import { useSettings } from '../context/SettingsContext';
import type { HardwareConfigPatch, HardwareConfigState } from './types';
import { createAuthenticatedClient } from './client';

/**
 * The hardware a device can be told about without rebuilding it (#144).
 *
 * `save` takes a partial: the device keeps any field the request does not
 * mention, so a form that only changed the display name sends only that. It
 * also refuses `targetsShownAtBoot` outright — that one changes from the serial
 * console only — so the patch schema excludes it rather than letting a caller
 * send something guaranteed to come back 400.
 *
 * The type comes from the contract's own `HardwareConfigPatch` rather than
 * being derived from `HardwareConfig` here. Deriving it locally would have kept
 * compiling when the two drifted; taking it from the schema means a field added
 * to one and not the other is a type error.
 */
export type { HardwareConfigPatch };

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
