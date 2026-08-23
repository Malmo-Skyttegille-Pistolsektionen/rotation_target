import clsx from 'clsx';
import { START_DELAY_OPTIONS, useSettings } from '../context/SettingsContext';
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

  const immediate = settings.startDelaySeconds === 0;

  return (
    <div className={clsx(styles.control, immediate && styles.controlImmediate)} title={HINT}>
      <label className={styles.label} htmlFor='run-start-delay'>
        Start delay
      </label>
      {/* A select rather than a number field (#195): one tap on the tablet the
          range uses instead of a keyboard over the Start button beside it, and
          no half-typed value to hold - which is why this component no longer
          carries a draft. */}
      <select
        id='run-start-delay'
        data-testid='run-start-delay'
        className={styles.input}
        value={String(settings.startDelaySeconds)}
        onChange={(e) => {
          setStartDelaySeconds(Number(e.target.value));
        }}
        disabled={disabled}
        aria-describedby='run-start-delay-unit'
      >
        {START_DELAY_OPTIONS.map((seconds) => (
          <option key={seconds} value={String(seconds)}>
            {seconds === 0 ? 'No delay' : String(seconds)}
          </option>
        ))}
      </select>
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
