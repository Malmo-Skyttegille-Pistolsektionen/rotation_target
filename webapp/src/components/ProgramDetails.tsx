import { useQuery } from '@tanstack/react-query';
import { useProgramsApi } from '../api/programs';
import { programTotalMs } from '../lib/program-document';
import { Timeline } from './Timeline';
import styles from './ProgramDetails.module.css';

type ProgramDetailsProps = {
  id: number;
  onClose: () => void;
};

function formatDuration(totalMs: number): string {
  const seconds = Math.round(totalMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

/**
 * The full document behind one row: what the list omits (`GET /programs`
 * returns summaries) plus the same timeline the run view draws, with no
 * playhead because nothing is running here.
 */
export function ProgramDetails({ id, onClose }: ProgramDetailsProps): React.ReactNode {
  const programsApi = useProgramsApi();

  const {
    data: program,
    isPending,
    error,
  } = useQuery({
    queryKey: ['program', id],
    queryFn: () => programsApi.get(id),
    staleTime: Infinity,
  });

  function handleDownload(): void {
    if (!program) return;

    const blob = new Blob([JSON.stringify(program, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${program.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={styles.panel} data-testid='program-details'>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{program?.title ?? `Program ${id}`}</h2>
          {program && <p className={styles.description}>{program.description}</p>}
        </div>
        <div className={styles.headerActions}>
          <button className={styles.button} onClick={handleDownload} disabled={!program}>
            Download JSON
          </button>
          <button className={styles.button} onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      {isPending && <p className={styles.message}>Loading…</p>}
      {error && <p className={styles.message}>Could not load this program: {error.message}</p>}

      {program && (
        <>
          <p className={styles.meta} data-testid='program-details-meta'>
            {program.series.length} series · {program.series.reduce((count, series) => count + series.events.length, 0)}{' '}
            events · {formatDuration(programTotalMs(program))}
          </p>
          <Timeline program={program} currentSeriesIndex={null} currentEventIndex={null} tickerMs={null} />
        </>
      )}
    </section>
  );
}
