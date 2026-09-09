import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSystemApi } from '../api/system';
import { ConfirmDialog } from './ConfirmDialog';
import { useSettings } from '../context/SettingsContext';
import { useControlLockStatus } from '../hooks/useControlLockStatus';
import { useRestartPending } from '../hooks/useRestartPending';
import type { StateUpdatePayload } from '../api/types';
import styles from './RestartToApply.module.css';

/**
 * The one control that applies saved configuration (#341).
 *
 * Driven by what the device reports — `restartRequired` on the hardware and
 * WiFi reads — not by unsaved edits in a form, which is what each section's
 * Save button is for.
 *
 * Rendered beside the Expert mode heading rather than inside a section, and
 * outside the configuration window's gate: a pending restart is a fact about
 * the device, so it survives the five minutes lapsing. The endpoint is not
 * window-gated either, for the same reason.
 */
export function RestartToApply(): React.ReactNode {
  const { controlLockToken } = useSettings();
  const { controlLockEnabled } = useControlLockStatus();
  const systemApi = useSystemApi();
  const canManage = !controlLockEnabled || controlLockToken !== null;
  const pending = useRestartPending();

  // Written by `useSSE`; the device refuses a restart mid-run, so say so before
  // the click rather than after it.
  const { data: state } = useQuery<StateUpdatePayload | null>({
    queryKey: ['state'],
    queryFn: async () => null,
    initialData: null,
    enabled: false,
  });
  const running = state?.programState?.running === true;

  const [confirming, setConfirming] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Kept on screen while restarting even though the device stops answering:
  // the notice below is the only thing telling the operator what happened.
  if (!pending && !restarting) return null;

  const restart = async (): Promise<void> => {
    setConfirming(false);
    setNotice(null);
    setRestarting(true);
    try {
      await systemApi.restart();
      setNotice('Restarting — the device will be unreachable for a few seconds.');
    } catch (error) {
      // RFC 9457 (D-19): the device's own sentence, shown as written.
      setNotice(error instanceof Error ? error.message : 'The device refused the restart.');
      setRestarting(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <button
        type='button'
        className={styles.button}
        data-testid='restart-to-apply'
        disabled={!canManage || running || restarting}
        title={reason(canManage, running)}
        onClick={() => setConfirming(true)}
      >
        {restarting ? 'Restarting…' : 'Restart to apply'}
      </button>

      {notice !== null && (
        <p className={styles.notice} role='status' data-testid='restart-notice'>
          {notice}
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          title='Restart the device?'
          body={
            <p>
              Restart the device to apply the saved configuration? This page will lose contact with
              it for as long as it takes to come back.
            </p>
          }
          confirmLabel='Restart'
          onConfirm={() => void restart()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function reason(canManage: boolean, running: boolean): string | undefined {
  if (running) return 'A program is running — stop it first.';
  if (!canManage) return 'The controls are locked — log in to restart the device.';
  return undefined;
}
