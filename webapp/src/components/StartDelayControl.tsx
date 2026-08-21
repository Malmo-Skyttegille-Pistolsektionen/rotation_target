import { useState } from 'react';
import clsx from 'clsx';
import { START_DELAY_MAX_SECONDS, START_DELAY_MIN_SECONDS, useSettings } from '../context/SettingsContext';
import styles from './StartDelayControl.module.css';

const HINT =
  'Seconds counted down before the program starts; 0 starts it at once. ' +
  'Saved in this browser only - another phone or tablet keeps its own.';

interface StartDelayControlProps {
  /** A running countdown already has its length; see the call site in `run.tsx`. */
  disabled?: boolean;
}

/**
 * The start delay where it is used, beside Start. Writes straight through to
 * the settings context, so the settings page shows the same number.
 */
export function StartDelayControl({ disabled = false }: StartDelayControlProps): React.ReactNode {
  const { settings, setStartDelaySeconds } = useSettings();
  // While the field is being edited it shows what was typed - including a
  // half-typed or empty value. Otherwise it shows the setting, so a change made
  // on the settings page or in another tab appears here.
  const [draft, setDraft] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = e.target.value;
    setDraft(raw);
    // `type=number` gives '' for anything it cannot parse, and for a cleared
    // field. Nothing to commit until there is a number again.
    if (raw !== '') {
      setStartDelaySeconds(Number(raw));
    }
  };

  const immediate = settings.startDelaySeconds === 0;

  return (
    <div className={clsx(styles.control, immediate && styles.controlImmediate)} title={HINT}>
      <label className={styles.label} htmlFor='run-start-delay'>
        Start delay
      </label>
      <input
        id='run-start-delay'
        data-testid='run-start-delay'
        type='number'
        className={styles.input}
        value={draft ?? String(settings.startDelaySeconds)}
        onChange={handleChange}
        onBlur={() => setDraft(null)}
        min={START_DELAY_MIN_SECONDS}
        max={START_DELAY_MAX_SECONDS}
        step={1}
        disabled={disabled}
        aria-describedby='run-start-delay-unit'
      />
      {/* A live firing line: 0 has to read as a statement about what Start
          will do, not as a bare number in a box. */}
      <span
        className={clsx(styles.unit, immediate && styles.unitImmediate)}
        id='run-start-delay-unit'
        data-testid='run-start-delay-unit'
      >
        {immediate ? 'no delay - Start begins the program at once' : 'seconds'}
      </span>
    </div>
  );
}
