import { useState, useCallback } from 'react';
import clsx from 'clsx';
import { START_DELAY_MAX_SECONDS, START_DELAY_MIN_SECONDS, useSettings } from '../context/SettingsContext';
import styles from './StartDelaySection.module.css';

export function StartDelaySection(): React.ReactNode {
  const { settings, setStartDelaySeconds } = useSettings();
  // Unsaved edits only. With nothing in hand the field shows the setting, so a
  // change made on the run page is what this section reports.
  const [draft, setDraft] = useState<string | null>(null);
  const [delaySuccess, setDelaySuccess] = useState(false);

  const handleDelayChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    setDraft(e.target.value);
    setDelaySuccess(false);
  }, []);

  const handleDelaySave = useCallback((): void => {
    setStartDelaySeconds(draft === null || draft === '' ? settings.startDelaySeconds : Number(draft));
    setDraft(null);
    setDelaySuccess(true);

    setTimeout(() => {
      setDelaySuccess(false);
    }, 3000);
  }, [draft, settings.startDelaySeconds, setStartDelaySeconds]);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Start Delay</h2>
      <div className={styles.inputRow}>
        <div className={styles.inputGroup}>
          <input
            type='number'
            data-testid='settings-start-delay'
            className={clsx(styles.input, styles.inputSmall)}
            value={draft ?? String(settings.startDelaySeconds)}
            onChange={handleDelayChange}
            min={START_DELAY_MIN_SECONDS}
            max={START_DELAY_MAX_SECONDS}
          />
          <span className={styles.inputLabel}>
            seconds ({START_DELAY_MIN_SECONDS}-{START_DELAY_MAX_SECONDS}; {START_DELAY_MIN_SECONDS} = no countdown)
          </span>
        </div>
        <button className={clsx(styles.button, styles.buttonPrimary)} onClick={handleDelaySave}>
          Save
        </button>
      </div>
      {settings.startDelaySeconds === 0 && (
        <p className={styles.immediateNote} data-testid='settings-start-delay-immediate'>
          No countdown: Start begins the program at once.
        </p>
      )}
      <p className={styles.hint}>
        Also adjustable on the Run page, beside Start. Saved in this browser only - another phone or tablet keeps its
        own.
      </p>
      {delaySuccess && <div className={styles.successMessage}>Start delay saved successfully</div>}
    </section>
  );
}
