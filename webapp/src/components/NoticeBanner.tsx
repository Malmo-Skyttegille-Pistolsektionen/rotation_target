import clsx from 'clsx';
import type { Notice } from '../lib/program-notices';
import styles from './NoticeBanner.module.css';

interface NoticeBannerProps {
  notice: Notice;
  /** Distinct per view, so a test can tell the tab's banner from the editor's. */
  testId: string;
  onDismiss: () => void;
}

/** The one-line result of the last write, with the detail lines under it. */
export function NoticeBanner({ notice, testId, onDismiss }: NoticeBannerProps): React.ReactNode {
  return (
    <div className={clsx(styles.notice, styles[notice.kind])} role='status' data-testid={testId}>
      <p className={styles.noticeMessage}>{notice.message}</p>
      {notice.details && notice.details.length > 0 && (
        <ul className={styles.noticeDetails}>
          {notice.details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className={styles.noticeActions}>
        {notice.action && (
          <button
            className={styles.button}
            data-testid={`${testId}-action`}
            onClick={() => {
              const run = notice.action?.run;
              onDismiss();
              run?.();
            }}
          >
            {notice.action.label}
          </button>
        )}
        <button className={styles.button} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
