import { Link } from '@tanstack/react-router';
import { useRestartPending } from '../hooks/useRestartPending';
import styles from './RestartPendingNotice.module.css';

/**
 * One line on Settings when the device holds configuration it is not running
 * (#341), so a saved-but-not-applied change is not invisible to whoever picks
 * the device up next.
 *
 * A statement, not a control: restarting is an Expert mode act, behind the
 * button press that authorised the save. This only says where to go.
 */
export function RestartPendingNotice(): React.ReactNode {
  if (!useRestartPending()) return null;

  return (
    <p className={styles.notice} data-testid='restart-pending-notice'>
      Configuration saved but not applied; restart from <Link to='/hardware'>Expert mode</Link>.
    </p>
  );
}
