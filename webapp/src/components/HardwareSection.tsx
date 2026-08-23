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
 * Set apart from the rest of Settings on purpose. Everything else here is
 * recoverable from the page you broke it on; these values are not. A wrong
 * GPIO drives nothing, a wrong hostname makes the device hard to find, and the
 * way back is a USB cable — which is exactly what configurability was supposed
 * to remove. So it is collapsed by default, warns before it opens, and says
 * what a change will do and when.
 *
 * Two rules it exists to make visible:
 *
 *  - **Nothing here takes effect until the device restarts.** A pin change that
 *    appears to have done nothing is how somebody ends up reflashing a working
 *    device, so a pending change is stated rather than left to be noticed.
 *  - **Where the targets rest at boot is not editable here.** It is shown,
 *    because an operator needs to know it, and it changes only from the serial
 *    console (D-31).
 */
export function HardwareSection(): React.ReactNode {
  const { adminToken } = useSettings();
  const { adminModeEnabled } = useAdminStatus();
  const api = useHardwareConfigApi();
  const queryClient = useQueryClient();

  // Same rule as the rest of the app: admin off means anyone may manage.
  const canManage = !adminModeEnabled || adminToken !== null;

  const [open, setOpen] = useState(false);
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

  return (
    <section className={clsx(styles.section, styles.expert)} data-testid='hardware-section'>
      <div className={styles.head}>
        <h2 className={styles.sectionTitle}>Hardware</h2>
        <button
          className={styles.button}
          data-testid='hardware-toggle'
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      <p className={styles.explain}>
        Which pin drives the targets, which way round it is wired, and what this device calls itself.{' '}
        <strong>Getting these wrong can make the device stop working, and the way back is a USB cable.</strong> Most
        clubs never need to change them.
      </p>

      {state.restartRequired && (
        <p className={styles.pending} data-testid='hardware-restart-required'>
          Saved, but <strong>not yet in use</strong> — the device is still running the configuration it started with.
          Restart it to apply the change.
        </p>
      )}

      {open && (
        <>
          <div className={styles.fields}>
            <label className={styles.field}>
              <span className={styles.label}>
                Target GPIO
                {overridden('targetGpio') && <span className={styles.badge}>changed</span>}
              </span>
              <input
                className={styles.input}
                type='text'
                inputMode='numeric'
                data-testid='hardware-target-gpio'
                disabled={!canManage || busy}
                value={String(value('targetGpio'))}
                onChange={(e) => {
                  set('targetGpio', Number(e.target.value));
                }}
              />
              <span className={styles.hint}>
                The pin wired to the target circuit. 22–32 are refused: they are absent from this chip or belong to its
                flash and PSRAM, and driving one stops the device booting.
              </span>
            </label>

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
              <span className={styles.hint}>What to call this device — “Bana 1”. Cosmetic; nothing depends on it.</span>
            </label>

            {/* Shown, not editable. An operator needs to know where the targets
                rest at boot; changing it needs physical access, because it is
                what protects somebody standing downrange (D-31). */}
            <div className={styles.field}>
              <span className={styles.label}>Targets at boot</span>
              <p className={styles.readOnlyValue} data-testid='hardware-boot-targets'>
                {state.active.targetsShownAtBoot ? 'Shown' : 'Hidden'}
              </p>
              <span className={styles.hint}>
                Set from the serial console only — <code>boot-targets shown</code> or <code>boot-targets hidden</code>.
                It decides what the targets do while somebody may be downrange, so changing it needs a cable rather than
                a web page.
              </span>
            </div>
          </div>

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
      )}

      {notice && (
        <p className={styles.notice} data-testid='hardware-notice'>
          {notice}
        </p>
      )}
    </section>
  );
}
