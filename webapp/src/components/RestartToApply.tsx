import { useEffect, useRef, useState } from 'react';
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
 * outside the configuration window's gate — D-42 for why that, and why the
 * endpoint is not window-gated either.
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

  // Also written by `useSSE`. The stream dies with the device, so its return is
  // the app's only signal that the device is back again.
  const { data: sseStatus } = useQuery<string | null>({
    queryKey: ['sse-status'],
    queryFn: async () => null,
    initialData: null,
    enabled: false,
  });

  const [confirming, setConfirming] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const streamDroppedRef = useRef(false);

  // Cleared when the device is observed back, or this is a one-way door: the
  // Settings notice keeps pointing at a button that says "Restarting…" and
  // refuses to be pressed for the rest of the session.
  useEffect(() => {
    if (!restarting) {
      streamDroppedRef.current = false;
      return;
    }
    if (sseStatus !== 'connected') {
      streamDroppedRef.current = true;
      return;
    }
    // Back: the stream reconnected after dropping, or the reads it invalidates
    // on the way in have already said there is nothing left to apply.
    if (streamDroppedRef.current || !pending) setRestarting(false);
  }, [restarting, sseStatus, pending]);

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
