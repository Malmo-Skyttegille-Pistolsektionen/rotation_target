import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useDiagnosticsApi } from '../api/diagnostics';
import styles from './StartupIssuesSection.module.css';

/**
 * `kMaxStartupIssues` in `firmware/main/config.h`, and `maxItems` on
 * `DiagnosticsInfo.startupIssues` in the contract. A full array is therefore
 * ambiguous — see the note this drives below.
 */
const MAX_STARTUP_ISSUES = 8;

/**
 * What went wrong while the device was booting.
 *
 * These are `backend_issue` events raised before the HTTP server existed, so
 * the SSE stream could not deliver them to anybody (D-25): a stored program
 * that would not parse simply disappeared from the list, explained only on a
 * serial console nobody at a range is watching. This is where a program that
 * "vanished" becomes visible.
 *
 * On Settings rather than a diagnostics page of its own: this app has no
 * diagnostics route, and the boot facts sit with the other device-level
 * controls — the server address and admin mode — that an operator comes to
 * this page for. A route for one read-only array would be a nav entry and a
 * router chunk for less.
 */
export function StartupIssuesSection(): React.ReactNode {
  const diagnosticsApi = useDiagnosticsApi();

  const {
    data: diagnostics,
    isPending,
    error,
    refetch,
    isFetching,
  } = useQuery({
    // Also holds `programCount`/`audioCount`, which a `libraryChanged` makes
    // stale and nothing invalidates — harmless only because this section
    // renders neither. Render one and it needs the key in `LIBRARY_QUERY_KEYS`.
    queryKey: ['diagnostics'],
    queryFn: diagnosticsApi.info,
  });

  const issues = diagnostics?.startupIssues ?? [];

  return (
    <section className={styles.section} data-testid='startup-issues'>
      <div className={styles.header}>
        <h2 className={styles.sectionTitle}>Startup Issues</h2>
        <button
          type='button'
          className={styles.button}
          onClick={() => void refetch()}
          disabled={isFetching}
          data-testid='startup-issues-refresh'
        >
          {isFetching ? 'Checking…' : 'Check again'}
        </button>
      </div>

      <p className={styles.explanation}>
        Problems the device hit while starting up — today, a stored program it could not read. Such a program is
        skipped, so it is missing from the Programs list. The device reports them here because they happen before it can
        push anything to a browser, and the list does not change until it restarts.
      </p>

      {isPending && <p className={styles.message}>Asking the device…</p>}
      {error && <p className={styles.message}>Could not read the device diagnostics: {error.message}</p>}

      {!isPending && !error && issues.length === 0 && (
        <p className={clsx(styles.message, styles.messageClean)} data-testid='startup-issues-empty'>
          The device reported no problems at startup.
        </p>
      )}

      {issues.length > 0 && (
        <ul className={styles.list}>
          {issues.map((issue, index) => {
            const context = Object.entries(issue.context ?? {});
            return (
              <li
                key={`${issue.code}:${issue.message}:${index}`}
                className={styles.issue}
                data-testid={`startup-issue-${index}`}
              >
                <code className={styles.code}>{issue.code}</code>
                <span className={styles.issueMessage}>{issue.message}</span>
                {context.length > 0 && (
                  <span className={styles.context}>
                    {context.map(([key, value]) => `${key}: ${value}`).join(' · ')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {issues.length >= MAX_STARTUP_ISSUES && (
        <p className={styles.truncation} data-testid='startup-issues-truncated'>
          The device keeps at most {MAX_STARTUP_ISSUES} of these and drops the oldest, so this list may be incomplete —
          there may have been more. The device’s own log is the full record.
        </p>
      )}
    </section>
  );
}
