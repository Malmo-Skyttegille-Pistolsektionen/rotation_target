import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useDiagnosticsApi } from '../api/diagnostics';
import type { BuildInfo } from '../api/types';
import { APP_VERSION } from '../appVersion';
import styles from './AboutSection.module.css';

/**
 * What this app is, what it is talking to, and — behind a disclosure — exactly
 * which build that is.
 *
 * The webapp and the firmware are one artifact: this bundle is baked into the
 * LittleFS image the device boots from, and both take their version from the
 * same `git describe` against the same release tag (D-29). So the two rows
 * below normally read identically, and a *mismatch* is the interesting case -
 * it means the bundle in the browser is not the one running on the device.
 *
 * Two things cause it, and the copy names both because they need opposite
 * responses. A `npm run dev` session pointed at a real board is expected and
 * temporary. A firmware upload (#127) is neither: OTA writes the app partition
 * and leaves the LittleFS image alone, so the device keeps serving the bundle
 * it already had and this mismatch persists across reboots until the storage
 * partition is flashed over USB.
 *
 * Everything comes from `GET /diagnostics/info` rather than
 * `GET /api/v2/version`, for two reasons: this page already issues that request
 * for `StartupIssuesSection`, so the query is deduplicated and costs nothing;
 * and it carries the raw `git describe` string, where `/version` reports only
 * `{major, minor, patch}` and would answer `0.0.0` for every untagged build -
 * which would make two genuinely different builds compare equal. `version` is
 * immutable for the life of a boot, so reading it does not need the
 * `libraryChanged` invalidation that `programCount`/`audioCount` would.
 *
 * `build` is optional in the contract and the disclosure is simply absent
 * without it, which is what a device on firmware from before #228 reports.
 */
export function AboutSection(): React.ReactNode {
  const diagnosticsApi = useDiagnosticsApi();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  const { data: diagnostics, isPending } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: diagnosticsApi.info,
  });

  const firmwareVersion = diagnostics?.version;
  const mismatch = firmwareVersion !== undefined && firmwareVersion !== APP_VERSION;
  const build = diagnostics?.build;

  return (
    <section className={styles.section} data-testid='about-section'>
      <h2 className={styles.sectionTitle}>About</h2>

      <dl className={styles.rows}>
        <dt className={styles.label}>App</dt>
        <dd className={styles.value} data-testid='version-app'>
          {APP_VERSION}
        </dd>

        <dt className={styles.label}>Device</dt>
        <dd className={styles.value} data-testid='version-firmware'>
          {firmwareVersion ?? <span className={styles.muted}>{isPending ? 'Checking…' : 'unavailable'}</span>}
          {build?.dirty === true && (
            <span className={styles.marker} data-testid='build-dirty'>
              Modified build
            </span>
          )}
        </dd>
      </dl>

      {mismatch && (
        <p className={styles.mismatch} data-testid='version-mismatch'>
          This app was built from a different commit than the firmware it is talking to. Normally they ship together.
          Either this is a development build pointed at a device flashed with another one, or the firmware was updated
          over the air — that replaces the application only, so the device still serves the web app it was flashed with.
          Flashing over USB brings the two back into step.
        </p>
      )}

      {build !== undefined && (
        <>
          <button
            type='button'
            className={styles.disclosure}
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((open) => !open)}
            data-testid='build-details-toggle'
          >
            {expanded ? 'Hide build details' : 'Build details'}
          </button>
          {expanded && <BuildDetails id={detailsId} build={build} />}
        </>
      )}
    </section>
  );
}

/**
 * The untyped half, rendered and never branched on: a key added to the
 * firmware's generated header shows up here without a contract change. Order
 * is the firmware's, not alphabetical — it groups git, build and content, and
 * that grouping is more use than sorting would be.
 */
function BuildDetails({ id, build }: { id: string; build: BuildInfo }): React.ReactNode {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'manual'>('idle');
  const text = asPlainText(build);

  async function copy(): Promise<void> {
    if (await copyToClipboard(text)) {
      setCopied('copied');
      return;
    }
    // Neither route worked. Showing the block instead of an error is the point:
    // the operator can still select it, which is all they wanted.
    setCopied('manual');
  }

  return (
    <div id={id} className={styles.details} data-testid='build-details'>
      <dl className={styles.rows}>
        <Row label='Version' value={build.version} />
        <Row label='Commit' value={build.commit === '' ? 'no repository' : build.commit} />
        <Row label='Built' value={build.buildTime} />
        {Object.entries(build.details).map(([key, value]) => (
          <Row key={key} label={key} value={value} />
        ))}
      </dl>

      <div className={styles.actions}>
        <button type='button' className={styles.copy} onClick={() => void copy()} data-testid='build-copy'>
          Copy
        </button>
        <span role='status' className={styles.copyStatus}>
          {copied === 'copied' && 'Copied'}
          {copied === 'manual' && 'This browser would not let us copy — select the text below'}
        </span>
      </div>

      {copied === 'manual' && (
        <pre className={styles.plain} data-testid='build-plain'>
          {text}
        </pre>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <>
      <dt className={styles.detailLabel}>{label}</dt>
      <dd className={styles.value}>{value}</dd>
    </>
  );
}

/** What gets pasted into an issue. The app's own version goes first: the pair is the question. */
function asPlainText(build: BuildInfo): string {
  const lines = [
    `app        ${APP_VERSION}`,
    `version    ${build.version}`,
    `commit     ${build.commit}${build.dirty ? ' (modified)' : ''}`,
    `built      ${build.buildTime}`,
    ...Object.entries(build.details).map(([key, value]) => `${key.padEnd(10)} ${value}`),
  ];
  return lines.join('\n');
}

/**
 * The device is served over plain HTTP at `rotation-target.local`, and
 * `navigator.clipboard` does not exist outside a secure context — so the modern
 * API is the *fallback* case here, not the normal one. `execCommand('copy')` is
 * deprecated and is the only thing that works on the device itself.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused, or a browser that exposes the API and then denies it.
  }

  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    // Off-screen rather than hidden: `display: none` cannot be selected.
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.left = '-9999px';
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(scratch);
    return ok;
  } catch {
    return false;
  }
}
