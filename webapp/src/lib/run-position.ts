/**
 * Where a series is at a given elapsed time. Pure maths, no state.
 *
 * Mirrored logic: the device derives run position the same way, in
 * `firmware/lib/rt_logic/run_position.h` (`locate_event`, `Series::total_ms`).
 * Keep the two in lock-step — a divergence shows up as a timeline that
 * disagrees with the targets, which is exactly the failure nobody notices
 * until a competition.
 *
 * Deriving position from elapsed series time, rather than tracking it per
 * event, is what lets `stop` pause instead of rewind: a paused run resumes at
 * whatever event its `tickerMs` lands in.
 */
import type { Series } from '../api/types';

export interface EventLocation {
  /** Index of the event `elapsedMs` falls in. */
  index: number;
  /** How far into that event. */
  offsetMs: number;
  /** Series-relative time the event ends at. */
  endMs: number;
}

export function seriesTotalMs(series: Series): number {
  return series.events.reduce((sum, event) => sum + event.duration, 0);
}

/**
 * Locate `elapsedMs` within `series`, or `null` once elapsed is at or beyond
 * the total duration — the caller treats that as "the series is done".
 */
export function locateEvent(series: Series, elapsedMs: number): EventLocation | null {
  let cumulativeMs = 0;

  for (let i = 0; i < series.events.length; i++) {
    const event = series.events[i];
    if (elapsedMs < cumulativeMs + event.duration) {
      return { index: i, offsetMs: elapsedMs - cumulativeMs, endMs: cumulativeMs + event.duration };
    }
    cumulativeMs += event.duration;
  }

  return null;
}
