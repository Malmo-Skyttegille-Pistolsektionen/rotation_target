import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useHardwareConfigApi, type HardwareConfigPatch } from '../api/hardwareConfig';
import type { HardwareConfig } from '../api/types';
import { useSettings } from '../context/SettingsContext';
import { useAdminStatus } from '../hooks/useAdminStatus';
import styles from './HardwareSection.module.css';

/**
 * The hardware a device is configured for (#144) — the answer to "where does a
 * club configure their device", which until now was "curl, or not at all".
 *
 * On its own page (`/hardware`), reached by a button on Settings and absent
 * from the main navigation. Everything on Settings is recoverable from the page
 * you broke it on; these values are not. A wrong GPIO drives nothing, and a
 * wrong hostname changes mDNS so the device stops answering to the name people
 * reach it by — which is worse, because a wrong pin at least leaves the web app
 * reachable to fix it from.
 *
 * Two rules it exists to make visible:
 *
 *  - **Nothing here takes effect until the device restarts.** A pin change that
 *    appears to have done nothing is how somebody ends up reflashing a working
 *    device, so a pending change is stated rather than left to be noticed.
 *  - **Where the targets rest at boot is not editable here.** It is shown,
 *    because an operator needs to know it, and it changes only from the serial
 *    console (D-31).
 *
 * Grouped by the thing each pin belongs to rather than listed flat: somebody
 * here is adapting the firmware to a board they have in front of them, and they
 * work through it one peripheral at a time.
 */

/** Every numeric field is a GPIO or a port, and they behave identically. */
type NumericField = {
  key: keyof HardwareConfigPatch & ('targetGpio' | 'ledGpio' | 'i2sPort' | 'i2sBckGpio' | 'i2sWsGpio' | 'i2sDoutGpio' | 'httpPort' | 'wifiMaxRetries');
  testId: string;
  label: string;
  hint: React.ReactNode;
};

const TARGET_FIELDS: NumericField[] = [
  {
    key: 'targetGpio',
    testId: 'hardware-target-gpio',
    label: 'Target GPIO',
    hint: 'The pin wired to the target circuit. 22–32 are refused: they are absent from this chip or belong to its flash and PSRAM, and driving one stops the device booting.',
  },
];

const LED_FIELDS: NumericField[] = [
  {
    key: 'ledGpio',
    testId: 'hardware-led-gpio',
    label: 'Status LED GPIO',
    hint: 'The addressable LED’s data pin — 48 on a stock DevKitC-1. Kept even on a firmware built without the LED, so the value survives being flashed onto one that has it.',
  },
];

const AUDIO_FIELDS: NumericField[] = [
  {
    key: 'i2sPort',
    testId: 'hardware-i2s-port',
    label: 'I2S port',
    hint: 'Which of the chip’s two I2S peripherals drives the DAC. 0 or 1 — a peripheral, not a pin.',
  },
  { key: 'i2sBckGpio', testId: 'hardware-i2s-bck', label: 'I2S bit clock (BCK)', hint: 'To BCLK on the amplifier board.' },
  {
    key: 'i2sWsGpio',
    testId: 'hardware-i2s-ws',
    label: 'I2S word select (WS/LRCK)',
    hint: 'To LRC on the amplifier board.',
  },
  {
    key: 'i2sDoutGpio',
    testId: 'hardware-i2s-dout',
    label: 'I2S data out (DOUT)',
    hint: 'To DIN on the amplifier board — the names cross over, which is the usual way to wire this wrong.',
  },
];

const NETWORK_FIELDS: NumericField[] = [
  {
    key: 'httpPort',
    testId: 'hardware-http-port',
    label: 'HTTP port',
    hint: 'Where the web app is served. Leave at 80 unless something else on the device needs it — mDNS advertises the port, but a browser typed at by hand does not, so a moved port has to be remembered.',
  },
  {
    key: 'wifiMaxRetries',
    testId: 'hardware-wifi-retries',
    label: 'WiFi join attempts',
    hint: 'How many times to try the stored network before raising the setup portal. About 2.4 seconds each, so 10 is roughly half a minute of trying.',
  },
];

export function HardwareSection(): React.ReactNode {
  const { adminToken } = useSettings();
  const { adminModeEnabled } = useAdminStatus();
  const api = useHardwareConfigApi();
  const queryClient = useQueryClient();

  // Same rule as the rest of the app: admin off means anyone may manage.
  const canManage = !adminModeEnabled || adminToken !== null;

  const [draft, setDraft] = useState<HardwareConfigPatch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: state } = useQuery({
    queryKey: ['hardware-config'],
    queryFn: api.get,
  });

  const save = useMutation({
    mutationFn: (patch: HardwareConfigPatch) => api.save(patch),
    onSuccess: async (result) => {
      setDraft(null);
      setNotice(result.message);
      await queryClient.invalidateQueries({ queryKey: ['hardware-config'] });
    },
    // RFC 9457 (D-19): the device's `detail` is the sentence written for this
    // situation — which GPIO, and why it is refused — so it is shown as-is.
    onError: (error: Error) => setNotice(error.message),
  });

  const reset = useMutation({
    mutationFn: () => api.reset(),
    onSuccess: async (result) => {
      setDraft(null);
      setNotice(result.message);
      await queryClient.invalidateQueries({ queryKey: ['hardware-config'] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  if (!state) {
    return (
      <section className={styles.section} data-testid='hardware-section'>
        <h2 className={styles.sectionTitle}>Hardware</h2>
        <p className={styles.explain}>Asking the device…</p>
      </section>
    );
  }

  const saved = state.saved;
  const value = <K extends keyof HardwareConfigPatch>(key: K): NonNullable<HardwareConfigPatch[K]> =>
    (draft?.[key] ?? saved[key]) as NonNullable<HardwareConfigPatch[K]>;

  const set = <K extends keyof HardwareConfigPatch>(key: K, next: HardwareConfigPatch[K]): void => {
    setNotice(null);
    setDraft({ ...draft, [key]: next });
  };

  // Only what changed. The device keeps any field the request does not carry,
  // so this is also what stops a stale form overwriting a value another client
  // set while it was open.
  const patch: HardwareConfigPatch = {};
  if (draft) {
    for (const key of Object.keys(draft) as (keyof HardwareConfigPatch)[]) {
      if (draft[key] !== saved[key]) (patch as Record<string, unknown>)[key] = draft[key];
    }
  }
  const dirty = Object.keys(patch).length > 0;
  const busy = save.isPending || reset.isPending;

  /** Marks a field whose stored value is not the compiled default. */
  const overridden = (key: keyof HardwareConfig): boolean => saved[key] !== state.defaults[key];

  const numeric = (field: NumericField): React.ReactNode => (
    <label className={styles.field} key={field.key}>
      <span className={styles.label}>
        {field.label}
        {overridden(field.key) && <span className={styles.badge}>changed</span>}
      </span>
      <input
        className={styles.input}
        type='text'
        inputMode='numeric'
        data-testid={field.testId}
        disabled={!canManage || busy}
        value={String(value(field.key))}
        onChange={(e) => {
          set(field.key, Number(e.target.value));
        }}
      />
      <span className={styles.hint}>{field.hint}</span>
    </label>
  );

  const group = (title: string, testId: string, children: React.ReactNode): React.ReactNode => (
    <div className={styles.group} data-testid={testId}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <div className={styles.fields}>{children}</div>
    </div>
  );

  return (
    <section className={clsx(styles.section, styles.expert)} data-testid='hardware-section'>
      <div className={styles.head}>
        <h2 className={styles.sectionTitle}>Hardware</h2>
      </div>

      <p className={styles.explain}>
        Which pins this board uses, what this device calls itself, and how it joins the network.{' '}
        <strong>Getting these wrong can make the device stop working, and the way back is a USB cable.</strong> Most
        clubs never need to change them.
      </p>

      {state.restartRequired && (
        <p className={styles.pending} data-testid='hardware-restart-required'>
          Saved, but <strong>not yet in use</strong> — the device is still running the configuration it started with.
          Restart it to apply the change.
        </p>
      )}

      <>
          {group(
            'Targets',
            'hardware-group-targets',
            <>
              {TARGET_FIELDS.map(numeric)}

              <label className={styles.field}>
                <span className={styles.label}>
                  Targets shown when the pin is low
                  {overridden('targetActiveLow') && <span className={styles.badge}>changed</span>}
                </span>
                <span className={styles.checkboxRow}>
                  <input
                    type='checkbox'
                    data-testid='hardware-active-low'
                    disabled={!canManage || busy}
                    checked={value('targetActiveLow')}
                    onChange={(e) => {
                      set('targetActiveLow', e.target.checked);
                    }}
                  />
                  <span className={styles.hint}>
                    Off for a board that buffers or inverts the signal. If the targets do the opposite of what the app
                    says, this is the setting.
                  </span>
                </span>
              </label>

              {/* Shown, not editable. An operator needs to know where the
                  targets rest at boot; changing it needs physical access,
                  because it is what protects somebody standing downrange
                  (D-31). */}
              <div className={styles.field}>
                <span className={styles.label}>Targets at boot</span>
                <p className={styles.readOnlyValue} data-testid='hardware-boot-targets'>
                  {state.active.targetsShownAtBoot ? 'Shown' : 'Hidden'}
                </p>
                <span className={styles.hint}>
                  Set from the serial console only — <code>boot-targets shown</code> or <code>boot-targets hidden</code>
                  . It decides what the targets do while somebody may be downrange, so changing it needs a cable rather
                  than a web page.
                </span>
              </div>
            </>,
          )}

          {group('Status LED', 'hardware-group-led', LED_FIELDS.map(numeric))}

          {group('Audio', 'hardware-group-audio', AUDIO_FIELDS.map(numeric))}

          {group(
            'Network',
            'hardware-group-network',
            <>
              <label className={styles.field}>
                <span className={styles.label}>
                  Hostname
                  {overridden('hostname') && <span className={styles.badge}>changed</span>}
                </span>
                <input
                  className={styles.input}
                  type='text'
                  data-testid='hardware-hostname'
                  disabled={!canManage || busy}
                  value={value('hostname')}
                  onChange={(e) => {
                    set('hostname', e.target.value);
                  }}
                />
                <span className={styles.hint}>
                  Reached at <code>{value('hostname') || '…'}.local</code>, and the setup network appears as{' '}
                  <code>{value('hostname') || '…'}-setup-XXXX</code>. Lower-case letters, digits and hyphens.
                </span>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>
                  Display name
                  {overridden('displayName') && <span className={styles.badge}>changed</span>}
                </span>
                <input
                  className={styles.input}
                  type='text'
                  data-testid='hardware-display-name'
                  disabled={!canManage || busy}
                  value={value('displayName')}
                  onChange={(e) => {
                    set('displayName', e.target.value);
                  }}
                />
                <span className={styles.hint}>
                  What to call this device — “Bana 1”. Cosmetic; nothing depends on it.
                </span>
              </label>

              {NETWORK_FIELDS.map(numeric)}
            </>,
          )}

          <div className={styles.actions}>
            <button
              className={clsx(styles.button, styles.buttonPrimary)}
              data-testid='hardware-save'
              disabled={!canManage || !dirty || busy}
              onClick={() => {
                save.mutate(patch);
              }}
            >
              Save
            </button>
            <button
              className={styles.button}
              data-testid='hardware-revert'
              disabled={!dirty || busy}
              onClick={() => {
                setDraft(null);
                setNotice(null);
              }}
            >
              Discard changes
            </button>
            <button
              className={clsx(styles.button, styles.buttonDanger)}
              data-testid='hardware-reset'
              disabled={!canManage || !state.overridden || busy}
              onClick={() => {
                reset.mutate();
              }}
            >
              Reset to defaults
            </button>
          </div>

          {!canManage && (
            <p className={styles.hint} data-testid='hardware-locked'>
              Admin mode is on — log in to change these.
            </p>
          )}

          <p className={styles.hint}>Nothing here takes effect until the device restarts.</p>
      </>

      {notice && (
        <p className={styles.notice} data-testid='hardware-notice'>
          {notice}
        </p>
      )}
    </section>
  );
}
