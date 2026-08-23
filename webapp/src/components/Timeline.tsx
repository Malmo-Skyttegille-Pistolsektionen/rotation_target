import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Program, Series, Event } from '../api/types';
import { seriesTotalMs } from '../lib/run-position';
import styles from './Timeline.module.css';

type TimelineProps = {
  program: Program;
  currentSeriesIndex: number | null;
  currentEventIndex: number | null;
  tickerMs: number | null; // Total milliseconds elapsed in current series
  mode?: 'auto' | 'default' | 'field';
  /**
   * Clip id to title, for naming the audio an event plays. Optional: without
   * it the detail panel falls back to ids, which is still better than the
   * nothing the run page showed before.
   */
  audioTitles?: Record<number, string>;
  /**
   * Move the run to `index`. Absent when the operator cannot control the
   * device, or while a program is running - skipping mid-series is not this
   * control's job.
   */
  onSkipSeries?: (index: number) => void;
};

/** Which event the detail panel is describing. */
type EventRef = { seriesIndex: number; eventIndex: number };

const FIELD_TIMELINE_THRESHOLD_MS = 30000; // 30s

export function Timeline({
  program,
  currentSeriesIndex,
  currentEventIndex,
  tickerMs,
  mode = 'auto',
  audioTitles,
  onSkipSeries,
}: TimelineProps): React.ReactNode {
  // Two levels, because the chips were introduced for narrow screens and there
  // is no hover on a phone. Pointing at an event previews it; tapping or
  // clicking pins it so it survives the pointer leaving - which is the only
  // interaction a touch screen has. Pinned wins over previewed.
  const [pinned, setPinned] = useState<EventRef | null>(null);
  const [previewed, setPreviewed] = useState<EventRef | null>(null);
  const shown = pinned ?? previewed;

  // Scroll the running series to the middle of the screen so the operator does
  // not chase it down the page (#131).
  const seriesElementsRef = useRef(new Map<number, HTMLDivElement>());
  const lastCentredRef = useRef<number | null>(null);

  useEffect(() => {
    if (currentSeriesIndex === null) {
      lastCentredRef.current = null;
      return;
    }

    // On *change* only. Scrolling continuously would drag back an operator who
    // deliberately scrolled away to look at something else - and the first
    // non-null index is the program being loaded, when the operator is at the
    // top working the controls and should be left there.
    const first = lastCentredRef.current === null;
    const unchanged = lastCentredRef.current === currentSeriesIndex;
    lastCentredRef.current = currentSeriesIndex;
    if (first || unchanged) return;

    const element = seriesElementsRef.current.get(currentSeriesIndex);
    if (element === undefined) return;

    // Smooth scrolling is motion the operator did not ask for, which is
    // exactly what prefers-reduced-motion is about. 'auto' jumps instead.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [currentSeriesIndex]);

  const togglePin = (ref: EventRef): void => {
    setPinned((current) =>
      current?.seriesIndex === ref.seriesIndex && current.eventIndex === ref.eventIndex ? null : ref,
    );
  };
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

  // `tickerMs` arrives measured from the series' timer anchor, so it is negative
  // through the preamble (#126). The playhead needs elapsed-since-series-start,
  // so the anchor goes back on. A series without `timer_start_index` anchors at
  // 0 and this is the identity it always was.
  const anchorMs = (series: Series): number => {
    const index = series.timer_start_index ?? 0;
    return series.events.slice(0, index).reduce((total, event) => total + event.duration, 0);
  };

  // Straight from the wire otherwise: `tickerMs` is millisecond-precise. It used to be whole seconds multiplied back up by 1000, which put
  // the playhead up to a second - a whole event, on a field program - behind
  // where the targets actually were.
  const calculateElapsedMs = (seriesIdx: number): number => {
    if (seriesIdx !== currentSeriesIndex || tickerMs === null) {
      return 0;
    }
    const series = program.series?.[seriesIdx];
    return series === undefined ? tickerMs : tickerMs + anchorMs(series);
  };

  return (
    <div className={styles.timelineWrapper} data-testid='timeline'>
      {program.series.map((series, sIdx) => {
        const isCurrentSeries = sIdx === currentSeriesIndex;
        const elapsedMs = calculateElapsedMs(sIdx);

        return (
          <div
            key={sIdx}
            ref={(element) => {
              if (element === null) {
                seriesElementsRef.current.delete(sIdx);
              } else {
                seriesElementsRef.current.set(sIdx, element);
              }
            }}
            className={clsx(
              styles.series,
              isCurrentSeries && styles.active,
              series.optional === true && styles.optional,
            )}
            data-testid='timeline-series'
          >
            <div className={styles.seriesTitle}>
              <span>{series.name}</span>
              {/* Badge and dimming together, never dimming alone: which series
                  are skippable has to be readable at arm's length, on a phone,
                  in daylight. */}
              {series.optional === true && <span className={styles.optionalBadge}>Optional</span>}

              {/* Only on optional series, and only on the one the run is
                  sitting at. Skipping a scoring series by mistake is worse
                  than the trip back to the dropdown, which still reaches
                  every series. */}
              {series.optional === true && isCurrentSeries && onSkipSeries !== undefined && (
                <button
                  type='button'
                  className={styles.skipButton}
                  data-testid={`timeline-skip-${String(sIdx)}`}
                  disabled={sIdx + 1 >= program.series.length}
                  onClick={() => {
                    onSkipSeries(sIdx + 1);
                  }}
                >
                  Skip
                </button>
              )}
            </div>

            {type === 'default' ? (
              <DefaultTimelineSeries
                series={series}
                activeEventIndex={isCurrentSeries ? currentEventIndex : null}
                seriesIndex={sIdx}
                selected={shown}
                onPreview={setPreviewed}
                onTogglePin={togglePin}
              />
            ) : (
              <FieldTimelineSeries
                series={series}
                activeEventIndex={isCurrentSeries ? currentEventIndex : null}
                elapsedMs={elapsedMs}
                showCursor={isCurrentSeries}
              />
            )}
            {/* Inside the series, not after the timeline: a program can be
                twenty series and several thousand pixels long, so a panel at
                the bottom would describe an event that is nowhere near it. */}
            {shown?.seriesIndex === sIdx && (
              <EventDetail
                program={program}
                reference={shown}
                pinned={pinned !== null}
                audioTitles={audioTitles}
                onDismiss={() => {
                  setPinned(null);
                  setPreviewed(null);
                }}
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
  seriesIndex: number;
  selected: EventRef | null;
  onPreview: (reference: EventRef | null) => void;
  onTogglePin: (reference: EventRef) => void;
};

function DefaultTimelineSeries({
  series,
  activeEventIndex,
  seriesIndex,
  selected,
  onPreview,
  onTogglePin,
}: DefaultTimelineSeriesProps): React.ReactNode {
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

        const isSelected = selected?.seriesIndex === seriesIndex && selected.eventIndex === eIdx;
        const reference = { seriesIndex, eventIndex: eIdx };

        return (
          // A button, not a div with a title attribute. The native tooltip it
          // replaces never appeared on a touch screen, took a second to show on
          // one that has a pointer, and could not be reached from the keyboard
          // at all - so the audio an event plays was effectively invisible.
          <button
            type='button'
            key={eIdx}
            className={clsx(
              styles.eventBox,
              isActive && styles.active,
              isSelected && styles.selected,
              event.command === 'show' && styles.show,
              event.command === 'hide' && styles.hide,
            )}
            aria-pressed={isSelected}
            data-testid={`timeline-event-${String(seriesIndex)}-${String(eIdx)}`}
            onMouseEnter={() => {
              onPreview(reference);
            }}
            onMouseLeave={() => {
              onPreview(null);
            }}
            onFocus={() => {
              onPreview(reference);
            }}
            onBlur={() => {
              onPreview(null);
            }}
            onClick={() => {
              onTogglePin(reference);
            }}
          >
            <span className={styles.duration}>{Math.round(event.duration / 1000)}</span>

            <span className={styles.symbol}>
              <CommandIcon command={event.command} />
              {hasAudio(event) && <AudioIcon />}
            </span>
            <span className={styles.accumulated}>{Math.round(event.accumulated / 1000)}</span>
          </button>
        );
      })}
    </div>
  );
}

type EventDetailProps = {
  program: Program;
  reference: EventRef;
  pinned: boolean;
  audioTitles?: Record<number, string>;
  onDismiss: () => void;
};

/**
 * Everything an event holds, including the audio clips it plays - which were
 * not visible anywhere on the run page.
 *
 * A panel under the timeline rather than a floating tooltip. A popover has to
 * be positioned, and on a phone there is nowhere to put one beside a chip that
 * is already most of the screen width; it would cover the very events it is
 * describing. A panel in the flow needs no positioning maths, cannot be
 * clipped by the viewport, and is legible at arm's length, which is how this
 * page is read.
 */
function EventDetail({ program, reference, pinned, audioTitles, onDismiss }: EventDetailProps): ReactNode {
  const series = program.series?.[reference.seriesIndex];
  const event = series?.events[reference.eventIndex];
  if (series === undefined || event === undefined) return null;

  const startsAtMs = series.events
    .slice(0, reference.eventIndex)
    .reduce((total, previous) => total + previous.duration, 0);

  const audioIds = event.audio_ids ?? [];

  return (
    <div className={styles.detail} data-testid='timeline-event-detail'>
      <div className={styles.detailHead}>
        <span className={styles.detailTitle}>
          {series.name} · event {reference.eventIndex + 1} of {series.events.length}
        </span>
        {pinned && (
          <button type='button' className={styles.detailDismiss} onClick={onDismiss}>
            Close
          </button>
        )}
      </div>

      <dl className={styles.detailRows}>
        <dt>Targets</dt>
        <dd>{commandDescription(event.command)}</dd>

        <dt>Duration</dt>
        <dd>{formatSeconds(event.duration)}</dd>

        <dt>Starts at</dt>
        <dd>
          {formatSeconds(startsAtMs)} into {series.name}
        </dd>

        <dt>Ends at</dt>
        <dd>{formatSeconds(startsAtMs + event.duration)}</dd>

        <dt>Audio</dt>
        <dd>
          {audioIds.length === 0 ? (
            <span className={styles.detailNone}>none</span>
          ) : (
            // Listed, not joined with commas: clip titles are things like
            // "Provserie", "1" and "10 sekunder", and a comma-separated string
            // of those reads as one title rather than three.
            <ol className={styles.detailClips}>
              {audioIds.map((id, index) => (
                <li key={`${String(id)}-${String(index)}`}>{audioTitles?.[id] ?? `clip ${String(id)}`}</li>
              ))}
            </ol>
          )}
        </dd>
      </dl>
    </div>
  );
}

/** Said in words, because the chip says it in colour and an icon. */
function commandDescription(command?: string): string {
  if (command === 'show') return 'Show';
  if (command === 'hide') return 'Hide';
  return 'Unchanged — a timed pause';
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)} s`;
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
