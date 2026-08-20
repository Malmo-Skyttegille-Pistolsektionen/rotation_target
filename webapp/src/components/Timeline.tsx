import clsx from 'clsx';
import type { Program, Series, Event } from '../api/types';
import styles from './Timeline.module.css';

type TimelineProps = {
  program: Program;
  currentSeriesIndex: number | null;
  currentEventIndex: number | null;
  tickerSeconds: number | null; // Total seconds elapsed in current series
  mode?: 'auto' | 'default' | 'field';
};

const FIELD_TIMELINE_THRESHOLD_MS = 30000; // 30s

export function Timeline({
  program,
  currentSeriesIndex,
  currentEventIndex,
  tickerSeconds,
  mode = 'auto',
}: TimelineProps): React.ReactNode {
  // Determine timeline type
  let type: 'default' | 'field' = 'default';

  if (mode !== 'auto') {
    type = mode;
  } else if (program?.series) {
    let maxDuration = 0;
    for (const series of program.series) {
      if (series.events) {
        for (const event of series.events) {
          if (event.duration > maxDuration) {
            maxDuration = event.duration;
          }
        }
      }
    }
    type = maxDuration <= FIELD_TIMELINE_THRESHOLD_MS ? 'field' : 'default';
  }

  if (!program?.series) return null;

  // Calculate elapsed time in ms for cursor positioning
  // tickerSeconds is already total seconds elapsed in series
  const calculateElapsedMs = (seriesIdx: number): number => {
    if (seriesIdx !== currentSeriesIndex || tickerSeconds === null) {
      return 0;
    }
    return tickerSeconds * 1000;
  };

  return (
    <div className={styles.timelineWrapper}>
      {program.series.map((series, sIdx) => {
        const isCurrentSeries = sIdx === currentSeriesIndex;
        const elapsedMs = calculateElapsedMs(sIdx);

        return (
          <div key={sIdx} className={clsx(styles.series, isCurrentSeries && styles.active)}>
            <div className={styles.seriesTitle}>
              {series.name} {series.optional ? '(optional)' : ''}
            </div>

            {type === 'default' ? (
              <DefaultTimelineSeries series={series} activeEventIndex={isCurrentSeries ? currentEventIndex : null} />
            ) : (
              <FieldTimelineSeries
                series={series}
                activeEventIndex={isCurrentSeries ? currentEventIndex : null}
                elapsedMs={elapsedMs}
                showCursor={isCurrentSeries}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

type DefaultTimelineSeriesProps = {
  series: Series;
  activeEventIndex: number | null;
};

function DefaultTimelineSeries({ series, activeEventIndex }: DefaultTimelineSeriesProps): React.ReactNode {
  const eventsWithAccumulated = series.events.reduce(
    (acc, event) => {
      const previousAccumulated = acc.length > 0 ? acc[acc.length - 1].accumulated : 0;
      return [...acc, { ...event, accumulated: previousAccumulated + event.duration }];
    },
    [] as Array<Event & { accumulated: number }>,
  );

  return (
    <div className={styles.defaultSeries}>
      {eventsWithAccumulated.map((event, eIdx) => {
        const isActive = eIdx === activeEventIndex;

        return (
          <div
            key={eIdx}
            className={clsx(
              styles.eventBox,
              isActive && styles.active,
              event.command === 'show' && styles.show,
              event.command === 'hide' && styles.hide,
            )}
            title={`Duration: ${Math.round(event.duration / 1000)}s\nCommand: ${event.command}${event.audioIds ? '\nAudios: ' + event.audioIds.join(', ') : ''}`}
          >
            <span className={styles.duration}>{Math.round(event.duration / 1000)}</span>

            <span className={styles.symbol}>{getEventSymbol(event)}</span>
            <span className={styles.accumulated}>{Math.round(event.accumulated / 1000)}</span>
          </div>
        );
      })}
    </div>
  );
}

type FieldTimelineSeriesProps = {
  series: Series;
  activeEventIndex: number | null;
  elapsedMs: number;
  showCursor: boolean;
};

function FieldTimelineSeries({
  series,
  activeEventIndex,
  elapsedMs,
  showCursor,
}: FieldTimelineSeriesProps): React.ReactNode {
  // Calculate total duration for percentage-based positioning
  const totalDurationMs = series.events.reduce((sum, e) => sum + e.duration, 0);

  const eventsWithPosition = series.events.reduce(
    (acc, event) => {
      const durationSec = event.duration / 1000;
      const widthPercent = (event.duration / totalDurationMs) * 100;
      const leftPercent = acc.length > 0 ? acc[acc.length - 1].leftPercent + acc[acc.length - 1].widthPercent : 0;

      return [...acc, { ...event, widthPercent, leftPercent, durationSec }];
    },
    [] as Array<Event & { widthPercent: number; leftPercent: number; durationSec: number }>,
  );

  const cursorPercent = (elapsedMs / totalDurationMs) * 100;
  const totalDurationSec = totalDurationMs / 1000;

  return (
    <div className={styles.fieldContainer}>
      <div className={styles.centerLine} />
      {/* Events */}
      {eventsWithPosition.map((event, eIdx) => {
        const isActive = eIdx === activeEventIndex;

        return (
          <div
            key={eIdx}
            className={clsx(
              styles.segment,
              isActive && styles.active,
              event.command === 'show' && styles.show,
              event.command === 'hide' && styles.hide,
            )}
            style={{
              left: `${event.leftPercent}%`,
              width: `${event.widthPercent}%`,
            }}
            title={`Duration: ${event.durationSec}s\nCommand: ${event.command}${event.audioIds ? '\nAudios: ' + event.audioIds.join(', ') : ''}`}
          >
            {event.durationSec}s {getEventSymbol(event)}
          </div>
        );
      })}
      {/* Cursor */}
      {showCursor && (
        <div className={styles.cursor} style={{ left: `${cursorPercent}%` }}>
          <div className={styles.cursorHead} />
        </div>
      )}
      {/* Axis */}
      <div className={styles.axis}>
        {Array.from({ length: Math.ceil(totalDurationSec) + 1 }).map((_, i) => (
          <div key={i} className={styles.tick} style={{ left: `${(i / totalDurationSec) * 100}%` }}>
            <span className={styles.tickLabel}>{i}s</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getEventSymbol(event: Event): string {
  if (event.audioIds && event.audioIds.length > 0) return 'A';
  if (event.command === 'show') return 'Show';
  if (event.command === 'hide') return 'Hide';
  return '-';
}
