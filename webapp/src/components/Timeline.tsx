import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { Program, Series, Event } from '../api/types';
import { seriesTotalMs } from '../lib/run-position';
import styles from './Timeline.module.css';

type TimelineProps = {
  program: Program;
  currentSeriesIndex: number | null;
  currentEventIndex: number | null;
  tickerMs: number | null; // Total milliseconds elapsed in current series
  mode?: 'auto' | 'default' | 'field';
};

const FIELD_TIMELINE_THRESHOLD_MS = 30000; // 30s

export function Timeline({
  program,
  currentSeriesIndex,
  currentEventIndex,
  tickerMs,
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

  // Straight from the wire: `tickerMs` is already elapsed milliseconds in the
  // series. It used to be whole seconds multiplied back up by 1000, which put
  // the playhead up to a second - a whole event, on a field program - behind
  // where the targets actually were.
  const calculateElapsedMs = (seriesIdx: number): number => {
    if (seriesIdx !== currentSeriesIndex || tickerMs === null) {
      return 0;
    }
    return tickerMs;
  };

  return (
    <div className={styles.timelineWrapper} data-testid='timeline'>
      {program.series.map((series, sIdx) => {
        const isCurrentSeries = sIdx === currentSeriesIndex;
        const elapsedMs = calculateElapsedMs(sIdx);

        return (
          <div
            key={sIdx}
            className={clsx(styles.series, isCurrentSeries && styles.active)}
            data-testid='timeline-series'
          >
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
            title={`Duration: ${Math.round(event.duration / 1000)}s\nCommand: ${event.command ?? '-'}${event.audio_ids ? '\nAudios: ' + event.audio_ids.join(', ') : ''}`}
          >
            <span className={styles.duration}>{Math.round(event.duration / 1000)}</span>

            <span className={styles.symbol}>
              <CommandIcon command={event.command} />
              {hasAudio(event) && <AudioIcon />}
            </span>
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
  const totalDurationMs = seriesTotalMs(series);

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
            title={`Duration: ${event.durationSec}s\nCommand: ${event.command ?? '-'}${event.audio_ids ? '\nAudios: ' + event.audio_ids.join(', ') : ''}`}
          >
            {/* The label is wrapped so it can ellipsise: a segment is drawn to
                scale, and at 3 s out of 28 on a phone there is no room for
                "3s Show". The full text is in the segment's tooltip. */}
            <span className={styles.segmentLabel}>
              {event.durationSec}s {segmentSymbol(event)}
            </span>
          </div>
        );
      })}
      {/* Cursor */}
      {showCursor && (
        <div className={styles.cursor} style={{ left: `${cursorPercent}%` }} data-testid='timeline-cursor'>
          <div className={styles.cursorHead} />
        </div>
      )}
      {/* Axis. The unit is stated once, on the final tick, rather than on every
          label - "0 1 2 … 28 s" reads as cleanly as "0s 1s 2s … 28s" without
          repeating "s" 29 times. */}
      <div className={styles.axis}>
        {Array.from({ length: Math.ceil(totalDurationSec) + 1 }).map((_, i, ticks) => {
          const isLast = i === ticks.length - 1;
          return (
            <div key={i} className={styles.tick} style={{ left: `${(i / totalDurationSec) * 100}%` }}>
              <span className={styles.tickLabel}>
                {i}
                {isLast && <span className={styles.tickUnit}> s</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function hasAudio(event: Event): boolean {
  return Boolean(event.audio_ids && event.audio_ids.length > 0);
}

/* The command and the audio are independent, so the card shows both. It used to
   show whichever came first, audio winning - which hid the command on exactly
   the events that matter most: Militär Snabbmatch's "Load!" event carries audio
   26 *and* presents the targets, and read on the card as audio only. */
function commandLabel(event: Event): string {
  if (event.command === 'show') return 'Show';
  if (event.command === 'hide') return 'Hide';
  return hasAudio(event) ? '' : '-';
}

/* What the target physically does, rather than a word: face-on is the target
   face - the printed rings you shoot at - and edge-on is that face turned to a
   line. Nothing to learn twice, and it survives
   being 12px wide on a phone in daylight where "SHOW" does not.

   The shape - not the colour - is what carries the meaning here. Show is green
   and hide is red, the worst pair for colour vision deficiency, and WCAG 1.4.1
   asks that colour never be the only channel. The aria-label carries the word
   for anyone who cannot see either. */
function CommandIcon({ command }: { command?: string }): ReactNode {
  if (command === 'show') {
    return (
      <svg className={styles.commandIcon} viewBox="0 0 16 16" width="13" height="13"
           aria-label="Targets shown" role="img">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      </svg>
    );
  }
  if (command === 'hide') {
    return (
      <svg className={styles.commandIcon} viewBox="0 0 16 16" width="13" height="13"
           aria-label="Targets hidden" role="img" fill="currentColor">
        <rect x="6.9" y="2" width="2.2" height="12" rx="1.1" />
      </svg>
    );
  }
  return null;
}

/* The scaled timeline ellipsises its labels, so it gets a word rather than the
   icon: at 3 s out of 28 on a phone there is barely room for the word either. */
function segmentSymbol(event: Event): string {
  const command = commandLabel(event);
  if (command !== '' && command !== '-') return command;
  return hasAudio(event) ? 'Audio' : '-';
}

/* Inline rather than an emoji: emoji render differently on Android, iOS and
   desktop, arrive in their own colours next to a palette where colour means
   something, and go muddy at this size. This inherits currentColor. */
function AudioIcon(): ReactNode {
  return (
    <svg
      className={styles.audioIcon}
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-label="Plays audio"
      role="img"
      fill="currentColor"
    >
      <path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z" />
      <path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z" />
    </svg>
  );
}
