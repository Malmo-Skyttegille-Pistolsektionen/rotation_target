import { useQuery } from '@tanstack/react-query';
import { useDiagnosticsApi } from '../api/diagnostics';
import styles from './StorageSection.module.css';

/**
 * What is on the flash, and how much room is left.
 *
 * Storage is the partition that actually fills - the shipped audio is most of
 * it, and uploading more is a normal operation - so somebody should be able to
 * see they are near the limit *before* an upload fails rather than after. The
 * app slots are here for a different reason: their size is what says whether an
 * over-the-air image will fit.
 *
 * The fill bar is indigo on grey, never green or amber. Those three hues mean
 * target state and delay-armed everywhere else in this app, and a bar that goes
 * amber near full would be the fourth meaning for a colour that already has one
 * (the Three Signals Rule). "Nearly full" is said in words instead, which is
 * also the only version a colourblind operator can read.
 */

const KIB = 1024;

function formatBytes(bytes: number): string {
  if (bytes < KIB) return `${String(bytes)} B`;
  const mib = bytes / (KIB * KIB);
  if (mib >= 1) return `${mib.toFixed(mib < 10 ? 2 : 1)} MB`;
  return `${(bytes / KIB).toFixed(0)} KB`;
}

// Warn before it bites, not as it bites. An upload is a megabyte or so, so a
// partition past this has room for very few more.
const NEARLY_FULL = 0.9;

/**
 * The percentage shown beside the figures.
 *
 * Rounded, but never to 0% or 100% while the truth is neither: a partition
 * holding a few kilobytes is not empty, and one with room for another upload is
 * not full. Those are the two readings somebody would act on — and act
 * wrongly, since the whole point of this section is to be read *before* an
 * upload fails rather than after.
 */
function formatPercent(fraction: number): string {
  const percent = fraction * 100;
  if (percent > 0 && percent < 1) return '<1%';
  if (percent < 100 && percent > 99) return '>99%';
  return `${String(Math.round(percent))}%`;
}

export function StorageSection(): React.ReactNode {
  const diagnosticsApi = useDiagnosticsApi();

  const { data: diagnostics, isPending } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: diagnosticsApi.info,
  });

  const partitions = diagnostics?.partitions ?? [];

  return (
    <section className={styles.section} data-testid='storage-section'>
      <h2 className={styles.sectionTitle}>Storage</h2>

      {partitions.length === 0 ? (
        <p className={styles.muted}>{isPending ? 'Checking…' : 'unavailable'}</p>
      ) : (
        <ul className={styles.list}>
          {partitions.map((partition) => {
            const used = partition.usedBytes;
            const known = used !== undefined;
            const fraction = known && partition.sizeBytes > 0 ? used / partition.sizeBytes : 0;
            const nearlyFull = known && fraction >= NEARLY_FULL;

            return (
              <li className={styles.row} key={partition.name} data-testid={`partition-${partition.name}`}>
                <div className={styles.head}>
                  <span className={styles.name}>
                    {partition.name}
                    {partition.running === true && <span className={styles.badge}>running</span>}
                  </span>
                  <span className={styles.figures}>
                    {known
                      ? `${formatBytes(used)} of ${formatBytes(partition.sizeBytes)}`
                      : formatBytes(partition.sizeBytes)}
                    {/* The bar already encodes this, and a percentage is the
                        form the question is actually asked in — "how full is
                        it" rather than "how many megabytes". It is also the
                        only version available to somebody who cannot see the
                        bar. */}
                    {known && (
                      <span className={styles.percent} data-testid={`partition-${partition.name}-percent`}>
                        {formatPercent(fraction)}
                      </span>
                    )}
                  </span>
                </div>

                {known ? (
                  <div
                    className={styles.track}
                    role='progressbar'
                    aria-label={`${partition.name} used`}
                    aria-valuenow={Math.round(fraction * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className={styles.fill} style={{ width: `${String(Math.min(100, fraction * 100))}%` }} />
                  </div>
                ) : (
                  // No bar rather than an empty one: an empty bar reads as
                  // "nothing used", which is a stronger claim than "we cannot
                  // tell".
                  <p className={styles.unknown}>size only — the device cannot report what is used here</p>
                )}

                {nearlyFull && (
                  <p className={styles.warning}>
                    Nearly full — {formatBytes(partition.sizeBytes - used)} left. Delete something before uploading.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
