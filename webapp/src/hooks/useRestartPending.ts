import { useQuery } from '@tanstack/react-query';
import { useHardwareConfigApi } from '../api/hardwareConfig';
import { useWifiApi } from '../api/wifi';

/**
 * Whether the device holds saved configuration it is not yet running (#341).
 *
 * Two subjects, one answer: the hardware and WiFi reads each own a
 * `restartRequired` for what they store, and one restart applies both. The rule
 * lives here so the Expert mode button and the Settings notice cannot disagree
 * about when there is something to apply.
 *
 * Both queries are already kept warm elsewhere — the root layout reads
 * `hardware-config` for the Expert tab, Settings polls `wifi` — so this reads
 * the cache and adds no poll of its own.
 */
export function useRestartPending(): boolean {
  const hardwareApi = useHardwareConfigApi();
  const wifiApi = useWifiApi();

  const { data: hardware } = useQuery({ queryKey: ['hardware-config'], queryFn: hardwareApi.get });
  const { data: wifi } = useQuery({ queryKey: ['wifi'], queryFn: wifiApi.status });

  return hardware?.restartRequired === true || wifi?.restartRequired === true;
}
