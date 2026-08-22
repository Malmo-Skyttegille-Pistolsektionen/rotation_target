import { useQuery } from '@tanstack/react-query';
import { useDiagnosticsApi } from '../api/diagnostics';
import styles from './NetworkSection.module.css';

/**
 * The address the device is answering on.
 *
 * There is an apparent paradox in showing this: if you can read the page, you
 * already reached the device. The value is in the two cases where that is not
 * enough - reading the address out to somebody else so they can reach it too,
 * and noticing it is on a subnet you did not expect. At the range the device
 * came up on 192.168.50.x while the laptop was elsewhere, and the only way to
 * learn that was to reset the board and watch the boot log scroll past.
 *
 * Rendered large and selectable rather than as another `dl` row, because its
 * job is to be read aloud or copied.
 */
export function NetworkSection(): React.ReactNode {
  const diagnosticsApi = useDiagnosticsApi();

  const { data: diagnostics, isPending } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: diagnosticsApi.info,
  });

  const address = diagnostics?.ipAddress;
  // The firmware sends an empty string when it has no address, which is not the
  // same as not having asked yet.
  const hasAddress = address !== undefined && address !== '';

  return (
    <section className={styles.section} data-testid='network-section'>
      <h2 className={styles.sectionTitle}>Address</h2>

      {hasAddress ? (
        <p className={styles.address} data-testid='network-address'>
          {address}
        </p>
      ) : (
        <p className={styles.muted} data-testid='network-address-missing'>
          {isPending ? 'Checking…' : 'The device reports no address — it is serving its own access point, or the network dropped.'}
        </p>
      )}
    </section>
  );
}
