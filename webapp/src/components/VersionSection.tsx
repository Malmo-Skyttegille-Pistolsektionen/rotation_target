import { useQuery } from '@tanstack/react-query';
import { useDiagnosticsApi } from '../api/diagnostics';
import { APP_VERSION } from '../appVersion';
import styles from './VersionSection.module.css';

/**
 * What this app is, and what it is talking to.
 *
 * The webapp and the firmware are one artifact: this bundle is baked into the
 * LittleFS image the device boots from, and both take their version from the
 * same `git describe` against the same release tag (D-29). So the two rows below
 * normally read identically, and a *mismatch* is the interesting case - it means
 * the bundle in the browser is not the one on the device, which is exactly what
 * a `npm run dev` session pointed at a real board looks like. Worth saying out
 * loud rather than leaving someone to wonder why a fix they just made is not
 * there.
 *
 * The firmware side comes from `GET /diagnostics/info` rather than
 * `GET /api/v2/version`, for two reasons: this page already issues that request
 * for `StartupIssuesSection`, so the query is deduplicated and costs nothing;
 * and it carries the raw `git describe` string, where `/version` reports only
 * `{major, minor, patch}` and would answer `0.0.0` for every untagged build -
 * which would make two genuinely different builds compare equal. `version` is
 * immutable for the life of a boot, so reading it does not need the
 * `libraryChanged` invalidation that `programCount`/`audioCount` would.
 */
export function VersionSection(): React.ReactNode {
  const diagnosticsApi = useDiagnosticsApi();

  const { data: diagnostics, isPending } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: diagnosticsApi.info,
  });

  const firmwareVersion = diagnostics?.version;
  const mismatch = firmwareVersion !== undefined && firmwareVersion !== APP_VERSION;

  return (
    <section className={styles.section} data-testid='version-section'>
      <h2 className={styles.sectionTitle}>Version</h2>

      <dl className={styles.rows}>
        <dt className={styles.label}>App</dt>
        <dd className={styles.value} data-testid='version-app'>
          {APP_VERSION}
        </dd>

        <dt className={styles.label}>Device</dt>
        <dd className={styles.value} data-testid='version-firmware'>
          {firmwareVersion ?? <span className={styles.muted}>{isPending ? 'Checking…' : 'unavailable'}</span>}
        </dd>
      </dl>

      {mismatch && (
        <p className={styles.mismatch} data-testid='version-mismatch'>
          This app was built from a different commit than the firmware it is talking to. Normally they ship together, so
          you are probably running a development build against a device flashed with another one.
        </p>
      )}
    </section>
  );
}
