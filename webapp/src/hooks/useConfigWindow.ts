import { useQuery } from '@tanstack/react-query';
import { useHardwareConfigApi } from '../api/hardwareConfig';

/**
 * Whether the device is currently accepting hardware configuration (#144).
 *
 * Drives whether Expert mode is *offered at all*, rather than letting somebody
 * fill in a form that cannot be submitted. The window opens on a press of the
 * device's BOOT button and lasts five minutes.
 *
 * Polled rather than read once: the window opens at the device, not in this
 * browser, so the tab has to appear without the operator knowing to reload —
 * and disappear when it lapses, for the same reason.
 */
export function useConfigWindow(): { open: boolean; remainingSeconds: number } {
  const api = useHardwareConfigApi();

  const { data } = useQuery({
    queryKey: ['hardware-config'],
    queryFn: api.get,
    // Often enough that pressing the button feels immediate, rarely enough to
    // be invisible on a device serving a run.
    refetchInterval: 5000,
  });

  return {
    open: data?.writeWindow.open ?? false,
    remainingSeconds: data?.writeWindow.remainingSeconds ?? 0,
  };
}
