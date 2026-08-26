import { useRef, useState } from 'react';
import { useOtaApi } from '../api/ota';
import { useSettings } from '../context/SettingsContext';
import { useControlLockStatus } from '../hooks/useControlLockStatus';
import styles from './FirmwareSection.module.css';

/**
 * Upload new firmware without a cable.
 *
 * Deliberately blunt about what is about to happen: this restarts the device.
 * On a range that means the targets stop answering for a few seconds, so the
 * confirmation names the consequence rather than asking "are you sure?".
 *
 * The device does the refusing — a program running, an image for another
 * project, an empty upload — and its sentence is shown verbatim rather than
 * being second-guessed here. The one thing this does check first is the
 * extension, because sending 40 MB of the wrong file to find out is rude.
 */
export function FirmwareSection(): React.ReactNode {
  const { controlLockToken } = useSettings();
  const { controlLockEnabled } = useControlLockStatus();
  const otaApi = useOtaApi();
  // Same rule as the Programs page: the lock off means anyone may manage.
  const canManage = !controlLockEnabled || controlLockToken !== null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'uploading' | 'restarting'>('idle');
  const [notice, setNotice] = useState<string | null>(null);

  const upload = async (file: File): Promise<void> => {
    setNotice(null);
    setState('uploading');

    try {
      await otaApi.upload(file);
      setState('restarting');
      setNotice('Firmware accepted. The device is restarting — it will be unreachable for a few seconds.');
    } catch (error) {
      // RFC 9457 (D-19): the device's `detail` is the sentence written for this
      // situation, so it is shown as-is rather than second-guessed here.
      const detail = error instanceof Error ? error.message : null;
      setNotice(detail ?? 'The device refused the upload.');
      setState('idle');
    }
  };

  return (
    <section className={styles.section} data-testid='firmware-section'>
      <h2 className={styles.sectionTitle}>Firmware</h2>

      <p className={styles.explain}>
        Uploading firmware <strong>restarts the device</strong>. It writes to the slot that is not running, so a bad
        image rolls itself back rather than needing a cable. The web app and the stored programs and audio are not
        part of this update.
      </p>

      <input
        ref={fileInputRef}
        type='file'
        accept='.bin'
        className={styles.fileInput}
        data-testid='firmware-file-input'
        disabled={!canManage || state !== 'idle'}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />

      <button
        type='button'
        className={styles.button}
        data-testid='firmware-upload'
        disabled={!canManage || state !== 'idle'}
        onClick={() => fileInputRef.current?.click()}
      >
        {state === 'uploading' ? 'Uploading…' : state === 'restarting' ? 'Restarting…' : 'Upload firmware…'}
      </button>

      {!canManage && <p className={styles.muted}>Log in to update the firmware.</p>}

      {notice !== null && (
        <p className={styles.notice} data-testid='firmware-notice' role='status'>
          {notice}
        </p>
      )}
    </section>
  );
}
