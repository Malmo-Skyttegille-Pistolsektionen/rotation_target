import { useCallback, useState } from 'react';
import clsx from 'clsx';
import {
  START_DELAY_MAX_SECONDS,
  START_DELAY_MIN_SECONDS,
  START_DELAY_OPTIONS,
  useSettings,
} from '../context/SettingsContext';
import styles from './StartDelaySection.module.css';

export function StartDelaySection(): React.ReactNode {
  const { settings, setStartDelaySeconds } = useSettings();
  const [delaySuccess, setDelaySuccess] = useState(false);

  // No Save button and no draft: a select commits a whole value at once, so
  // there is never a half-chosen state to hold or a moment where the field and
  // the setting disagree (#195). The confirmation stays, because the write is
  // otherwise silent.
  const handleDelayChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>): void => {
      setStartDelaySeconds(Number(e.target.value));
      setDelaySuccess(true);
      setTimeout(() => {
        setDelaySuccess(false);
      }, 3000);
    },
    [setStartDelaySeconds],
  );

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Start Delay</h2>
      <div className={styles.inputRow}>
        <div className={styles.inputGroup}>
          <select
            data-testid='settings-start-delay'
            className={clsx(styles.input, styles.inputSmall)}
            value={String(settings.startDelaySeconds)}
            onChange={handleDelayChange}
          >
            {START_DELAY_OPTIONS.map((seconds) => (
              <option key={seconds} value={String(seconds)}>
                {seconds === 0 ? 'No delay' : String(seconds)}
              </option>
            ))}
          </select>
          <span className={styles.inputLabel}>
            {START_DELAY_MIN_SECONDS}-{START_DELAY_MAX_SECONDS} seconds; No delay = no countdown
          </span>
        </div>
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
