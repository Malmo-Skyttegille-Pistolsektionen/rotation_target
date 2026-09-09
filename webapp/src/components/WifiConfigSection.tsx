import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useWifiApi } from '../api/wifi';
import { useSettings } from '../context/SettingsContext';
import { useControlLockStatus } from '../hooks/useControlLockStatus';
import { chosenSsid } from '../lib/ssid-choice';
import styles from './WifiConfigSection.module.css';

/**
 * Moving the device to a different network (#263).
 *
 * The same three fields the setup portal serves, in the same order, with the
 * same words: a list of what the scan found, a text field for a name it did not
 * find, and a password. Deliberately the same — it is the same task, and
 * somebody who has provisioned a device once at the portal should not have to
 * work out that this is that. Which field wins when both are filled is decided
 * by `chosenSsid`, mirroring `rt::chosen_ssid` so the two forms cannot disagree.
 *
 * On this page rather than Settings, and behind the configuration window, for
 * the reason #208 took the portal's credential form behind a button press:
 * being on the network proves nothing, so what has to be established is that
 * somebody is standing at the device. Three presses of BOOT is that proof.
 *
 * Saving stores and nothing more (#341). The confirmation step stays, because
 * what it is really confirming is the network the device will look for after
 * the next restart — the failure it guards against is somebody moving a device
 * off a working network by accident, and that is unchanged. What it no longer
 * says is that the page is about to go: "Restart to apply" at the top of the
 * page does that, when the operator chooses.
 */
export function WifiConfigSection(): React.ReactNode {
  const { controlLockToken } = useSettings();
  const { controlLockEnabled } = useControlLockStatus();
  const wifiApi = useWifiApi();
  const queryClient = useQueryClient();

  // Same rule as the rest of the app: the lock off means anyone may manage.
  const canManage = !controlLockEnabled || controlLockToken !== null;

  const [picked, setPicked] = useState('');
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['wifi'],
    queryFn: wifiApi.status,
  });

  // Not on an interval and not refetched in the background: every run of this
  // query costs the radio a couple of seconds off its channel, which is the
  // link this page is being served over. It runs once on arrival, and again
  // only when somebody asks.
  const {
    data: scan,
    isFetching: scanning,
    refetch: rescan,
  } = useQuery({
    queryKey: ['wifi-networks'],
    queryFn: wifiApi.networks,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: () => wifiApi.save({ ssid, password: password === '' ? undefined : password }),
    onSuccess: async (result) => {
      setConfirming(false);
      setPassword('');
      setNotice(result.message);
      // The device is still here to ask, now that saving does not take it away,
      // and the answer carries the `restartRequired` the page's restart button
      // is driven by.
      await queryClient.invalidateQueries({ queryKey: ['wifi'] });
    },
    // RFC 9457 (D-19): the device's `detail` is the sentence written for this
    // situation — including the one that says how to open the window.
    onError: (error: Error) => {
      setConfirming(false);
      setNotice(error.message);
    },
  });

  const ssid = chosenSsid(picked, typed);
  const networks = scan?.networks ?? [];
  const busy = save.isPending;

  // Naming the network it is on now is not decoration: the whole failure this
  // guards against is somebody moving a device off a working network by
  // accident, and the current one is the fact that makes that visible.
  const current = status?.connected === true ? status.ssid : null;

  return (
    <section className={clsx(styles.section, styles.expert)} data-testid='wifi-config-section'>
      <h2 className={styles.sectionTitle}>WiFi</h2>

      <p className={styles.explain}>
        Which network this device joins. Saving stores the credentials; the device stays on the network it is on until
        it restarts, so a network, a hostname and a pin can all be corrected before <strong>Restart to apply</strong>{' '}
        at the top of this page.
      </p>

      {status?.restartRequired === true && (
        <p className={styles.pending} data-testid='wifi-restart-required'>
          Saved, but <strong>not yet in use</strong> — the device is still on the network it started with.
        </p>
      )}

      {current !== null && (
        <p className={styles.current} data-testid='wifi-config-current'>
          On <strong>{current}</strong> now.
        </p>
      )}

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>Network</span>
          <select
            className={styles.input}
            data-testid='wifi-config-pick'
            disabled={!canManage || busy}
            value={picked}
            onChange={(e) => {
              setNotice(null);
              setPicked(e.target.value);
            }}
          >
            <option value=''>
              {scanning
                ? '— scanning… —'
                : networks.length === 0
                  ? '— no networks found —'
                  : '— choose a network —'}
            </option>
            {networks.map((network) => (
              <option key={network.ssid} value={network.ssid}>
                {network.ssid} ({network.rssi} dBm, {network.auth})
              </option>
            ))}
          </select>
          <span className={styles.hint}>
            <button
              type='button'
              className={styles.linkButton}
              data-testid='wifi-config-rescan'
              disabled={busy || scanning}
              onClick={() => void rescan()}
            >
              {scanning ? 'Scanning…' : 'Rescan networks'}
            </button>{' '}
            A scan takes the radio off its channel for a couple of seconds, so this page may pause while it runs.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Or type the network name</span>
          <input
            className={styles.input}
            type='text'
            maxLength={32}
            autoCapitalize='none'
            autoCorrect='off'
            spellCheck={false}
            placeholder='Network name (optional)'
            data-testid='wifi-config-manual'
            disabled={!canManage || busy}
            value={typed}
            onChange={(e) => {
              setNotice(null);
              setTyped(e.target.value);
            }}
          />
          <span className={styles.hint}>
            For a hidden network, or one the scan did not find. What you type here is used instead of the choice above.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Password</span>
          <span className={styles.passwordRow}>
            <input
              className={styles.input}
              type={revealed ? 'text' : 'password'}
              maxLength={63}
              autoCapitalize='none'
              autoCorrect='off'
              spellCheck={false}
              data-testid='wifi-config-password'
              disabled={!canManage || busy}
              value={password}
              onChange={(e) => {
                setNotice(null);
                setPassword(e.target.value);
              }}
            />
            {/* aria-label says what the button will do next; aria-pressed says
                what the state is now. A screen reader needs both. */}
            <button
              type='button'
              className={styles.button}
              data-testid='wifi-config-reveal'
              aria-pressed={revealed}
              aria-label={revealed ? 'Hide password' : 'Show password'}
              onClick={() => {
                setRevealed((shown) => !shown);
              }}
            >
              {revealed ? 'Hide' : 'Show'}
            </button>
          </span>
          <span className={styles.hint}>Leave empty for an open network.</span>
        </label>
      </div>

      {/* Two steps rather than one, and the only place in this app with a
          confirmation on a save. Saving no longer takes the page away, but it
          still decides where the device will be after the next restart, and by
          then there is no page to explain it on. */}
      {confirming ? (
        <div className={styles.confirm} data-testid='wifi-config-confirm'>
          <p className={styles.confirmText}>
            Save <strong>{ssid}</strong> as the network to join?
          </p>
          <p className={styles.confirmText}>
            Nothing moves until the device restarts. When it does, this page stops responding: if the device joins, it
            comes back at the same name — if it cannot, it raises its setup network (
            <code>&lt;hostname&gt;-setup-XXXX</code>) and waits there, which is the way back rather than a fault.
          </p>
          <div className={styles.actions}>
            <button
              className={clsx(styles.button, styles.buttonPrimary)}
              data-testid='wifi-config-confirm-save'
              disabled={busy}
              onClick={() => {
                save.mutate();
              }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              className={styles.button}
              data-testid='wifi-config-cancel'
              disabled={busy}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            className={clsx(styles.button, styles.buttonPrimary)}
            data-testid='wifi-config-save'
            disabled={!canManage || ssid === '' || busy}
            onClick={() => {
              setNotice(null);
              setConfirming(true);
            }}
          >
            Save
          </button>
        </div>
      )}

      {!canManage && (
        <p className={styles.hint} data-testid='wifi-config-locked'>
          The controls are locked — log in to change this.
        </p>
      )}

      {notice !== null && (
        <p className={styles.notice} data-testid='wifi-config-notice' role='status'>
          {notice}
        </p>
      )}
    </section>
  );
}
