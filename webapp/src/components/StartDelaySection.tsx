import { useState, useCallback } from 'react';
import clsx from 'clsx';
import { useSettings } from '../context/SettingsContext';
import styles from './StartDelaySection.module.css';

export function StartDelaySection(): React.ReactNode {
  const { settings, setStartDelaySeconds } = useSettings();
  const [delayInput, setDelayInput] = useState(settings.startDelaySeconds);
  const [delaySuccess, setDelaySuccess] = useState(false);

  const handleDelayChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = Number(e.target.value);
    if (!isNaN(value)) {
      setDelayInput(value);
      setDelaySuccess(false);
    }
  }, []);

  const handleDelaySave = useCallback((): void => {
    const validDelay = Math.max(1, Math.min(60, delayInput));
    setStartDelaySeconds(validDelay);
    setDelayInput(validDelay);
    setDelaySuccess(true);

    setTimeout(() => {
      setDelaySuccess(false);
    }, 3000);
  }, [delayInput, setStartDelaySeconds]);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Start Delay</h2>
      <div className={styles.inputRow}>
        <div className={styles.inputGroup}>
          <input
            type='number'
            className={clsx(styles.input, styles.inputSmall)}
            value={delayInput}
            onChange={handleDelayChange}
            min={1}
            max={60}
          />
          <span className={styles.inputLabel}>seconds (1-60)</span>
        </div>
        <button className={clsx(styles.button, styles.buttonPrimary)} onClick={handleDelaySave}>
          Save
        </button>
      </div>
      {delaySuccess && <div className={styles.successMessage}>Start delay saved successfully</div>}
    </section>
  );
}
