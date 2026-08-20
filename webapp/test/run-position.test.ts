import { describe, expect, it } from 'vitest';

import { locateEvent, seriesTotalMs } from '../src/lib/run-position';
import { PROGRAM_FALT_TRANING, PROGRAM_MILITARY_SNABBMATCH, PROGRAM_PRECISION } from './fixtures';

// Fältträning series 1: hide 10s, show 3s, hide 3s, show 3s, hide 3s, show 3s,
// hide 3s = 28 s. Short events make every boundary interesting.
const faltSeries = PROGRAM_FALT_TRANING.series[0];

describe('seriesTotalMs', () => {
  it('sums the shipped series durations', () => {
    expect(seriesTotalMs(faltSeries)).toBe(28000);
    // Provserie 10s: 5 + 60 + 7 + 10 + 1 + 3 + 1 = 87 s.
    expect(seriesTotalMs(PROGRAM_MILITARY_SNABBMATCH.series[0])).toBe(87000);
  });
});

describe('locateEvent', () => {
  it('puts the start of a series in its first event', () => {
    expect(locateEvent(faltSeries, 0)).toEqual({ index: 0, offsetMs: 0, endMs: 10000 });
  });

  it('treats an event boundary as the start of the NEXT event', () => {
    // The last millisecond of the opening 10 s hide is still that event...
    expect(locateEvent(faltSeries, 9999)).toEqual({ index: 0, offsetMs: 9999, endMs: 10000 });
    // ...and 10000 exactly is already the show. Off by one here and the
    // targets move a second late for the whole series.
    expect(locateEvent(faltSeries, 10000)).toEqual({ index: 1, offsetMs: 0, endMs: 13000 });
  });

  it('locates a time in the middle of the series', () => {
    // 18 s in: 10 + 3 + 3 = 16 s consumed, so 2 s into the second `show`.
    expect(locateEvent(faltSeries, 18000)).toEqual({ index: 3, offsetMs: 2000, endMs: 19000 });
  });

  it('locates the last event up to its final millisecond', () => {
    expect(locateEvent(faltSeries, 27999)).toEqual({ index: 6, offsetMs: 2999, endMs: 28000 });
  });

  it('returns null at the end of the series, not the last event', () => {
    // The firmware's `locate_event` reports invalid here and the caller
    // completes the series; anything else silently re-enters the last event.
    expect(locateEvent(faltSeries, 28000)).toBeNull();
    expect(locateEvent(faltSeries, 999999)).toBeNull();
  });

  it('handles a long event without drifting', () => {
    // Precision Provserie: 5 s, then a 57 s event, then 3 s, then 297 s.
    const provserie = PROGRAM_PRECISION.series[0];
    expect(locateEvent(provserie, 5000)).toEqual({ index: 1, offsetMs: 0, endMs: 62000 });
    expect(locateEvent(provserie, 61999)).toEqual({ index: 1, offsetMs: 56999, endMs: 62000 });
    expect(locateEvent(provserie, 65000)).toEqual({ index: 3, offsetMs: 0, endMs: 362000 });
  });

  it('returns null for an empty series', () => {
    expect(locateEvent({ name: 'empty', optional: false, events: [] }, 0)).toBeNull();
  });
});
