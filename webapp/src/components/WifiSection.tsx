import { useQuery } from '@tanstack/react-query';
import { useWifiApi } from '../api/wifi';
import styles from './WifiSection.module.css';

/**
 * Which network the device is on, read-only (#263).
 *
 * Until now this was a serial-console question: `status` printed the SSID and
 * the RSSI, and over HTTP there was only `ipAddress`. That is the wrong place
 * for it — the question is asked at the range, by somebody standing in front of
 * a red LED with a phone, and the answer needed a laptop with a USB cable.
 *
 * It matters *which* network, not merely that there is one. The credential
 * store tries the provisioned network first and the compiled seeds after it, so
 * a device that has been to two sites may be on either, and "it is on WiFi" does
 * not distinguish the two.
 *
 * Nothing here is editable, deliberately. Changing the network restarts the
 * device, so it lives in Expert mode behind the button — this page stays the one
 * you cannot break anything from.
 */
export function WifiSection(): React.ReactNode {
  const wifiApi = useWifiApi();

  const { data: wifi, isPending } = useQuery({
    queryKey: ['wifi'],
    queryFn: wifiApi.status,
    // Signal strength is the one field here that moves, and it is the field
    // somebody watches while carrying the board around looking for a spot.
    refetchInterval: 15000,
  });

  if (isPending) {
    return (
      <section className={styles.section} data-testid='wifi-section'>
        <h2 className={styles.sectionTitle}>WiFi</h2>
        <p className={styles.muted}>Asking the device…</p>
      </section>
    );
  }

  // A device answering over the Ethernet build (QEMU) has no radio to report.
  // Said plainly rather than shown as an empty table, which reads as a fault.
  if (wifi?.radioPresent === false) {
    return (
      <section className={styles.section} data-testid='wifi-section'>
        <h2 className={styles.sectionTitle}>WiFi</h2>
        <p className={styles.muted} data-testid='wifi-no-radio'>
          This firmware is built for a wired connection and has no WiFi radio.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.section} data-testid='wifi-section'>
      <h2 className={styles.sectionTitle}>WiFi</h2>

      <dl className={styles.rows}>
        <dt className={styles.label}>Network</dt>
        <dd className={styles.value} data-testid='wifi-ssid'>
          {wifi?.connected === true ? wifi.ssid : <span className={styles.muted}>Not connected</span>}
        </dd>

        <dt className={styles.label}>Signal</dt>
        <dd className={styles.value} data-testid='wifi-signal'>
          {wifi?.connected === true ? (
            <>
              <SignalBars bars={wifi.bars} />
              <span className={styles.dbm}>{wifi.rssi} dBm</span>
            </>
          ) : (
            <span className={styles.muted}>unknown</span>
          )}
        </dd>

        <dt className={styles.label}>Address</dt>
        <dd className={styles.value} data-testid='wifi-ip'>
          {wifi?.ipAddress !== undefined && wifi.ipAddress !== '' ? (
            wifi.ipAddress
          ) : (
            <span className={styles.muted}>none yet</span>
          )}
        </dd>

        <dt className={styles.label}>MAC</dt>
        <dd className={styles.value} data-testid='wifi-mac'>
          {wifi?.macAddress !== undefined && wifi.macAddress !== '' ? (
            wifi.macAddress
          ) : (
            <span className={styles.muted}>unknown</span>
          )}
        </dd>
      </dl>

      {/* Worth saying, because it is the difference between "somebody set this
          up here" and "it is running on whatever it was built with" — and the
          latter cannot be read back or changed without a rebuild. */}
      {wifi?.provisioned === false && (
        <p className={styles.note} data-testid='wifi-unprovisioned'>
          No network has been saved on this device, so it is using the ones its firmware was built with.
        </p>
      )}

      <p className={styles.note}>
        Moving the device to a different network is in <strong>Expert mode</strong> — it restarts the device, so it
        needs the button.
      </p>
    </section>
  );
}

/**
 * Four bars from the firmware's own bucketing (`wifi_scan::bars`), not this
 * app's. Where "two bars" ends is a judgement about this radio, and one made in
 * two places is one that drifts.
 *
 * The dBm figure sits beside it rather than inside a tooltip: -52 means
 * something exact to whoever is diagnosing, and bars mean something immediate
 * to everybody else.
 */
function SignalBars({ bars }: { bars: number }): React.ReactNode {
  return (
    <span className={styles.bars} role='img' aria-label={`Signal ${String(bars)} of 4`} data-testid='wifi-bars'>
      {[1, 2, 3, 4].map((step) => (
        <span key={step} className={step <= bars ? styles.barOn : styles.barOff} />
      ))}
    </span>
  );
}
