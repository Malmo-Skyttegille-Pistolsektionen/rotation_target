import type { BackendIssuePayload } from '../api/types';
import styles from './BackendIssueBanner.module.css';

interface BackendIssueBannerProps {
  issue: BackendIssuePayload;
  onDismiss: () => void;
}

/**
 * A `backend_issue` the device reported about itself. Advisory only — run
 * state is unaffected — and fire-and-forget: nothing replays it, so once it is
 * dismissed it is gone.
 */
export function BackendIssueBanner({ issue, onDismiss }: BackendIssueBannerProps): React.ReactNode {
  const contextEntries = Object.entries(issue.context ?? {});

  return (
    <div className={styles.banner} role='alert' data-testid='backend-issue-banner'>
      <span className={styles.icon} aria-hidden='true'>
        ⚠
      </span>
      <div className={styles.body}>
        <span className={styles.message}>{issue.message}</span>
        {contextEntries.length > 0 && (
          <span className={styles.context}>{contextEntries.map(([key, value]) => `${key}: ${value}`).join(' · ')}</span>
        )}
      </div>
      <button type='button' className={styles.dismiss} onClick={onDismiss} aria-label='Dismiss'>
        ×
      </button>
    </div>
  );
}
