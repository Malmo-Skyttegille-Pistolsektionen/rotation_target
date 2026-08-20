// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Timeline } from '../src/components/Timeline';
import type { Program } from '../src/api/types';
import { PROGRAM_FALT_TRANING, PROGRAM_MILITARY_SNABBMATCH, PROGRAM_PRECISION } from './fixtures';

afterEach(cleanup);

type Position = {
  currentSeriesIndex?: number | null;
  currentEventIndex?: number | null;
  tickerSeconds?: number | null;
  mode?: 'auto' | 'default' | 'field';
};

function renderTimeline(program: Program, position: Position = {}) {
  return render(
    <Timeline
      program={program}
      currentSeriesIndex={position.currentSeriesIndex ?? null}
      currentEventIndex={position.currentEventIndex ?? null}
      tickerSeconds={position.tickerSeconds ?? null}
      mode={position.mode}
    />,
  );
}

/** The boxes/segments of one series, in order. */
function eventsOfSeries(index: number): HTMLElement[] {
  const series = document.querySelectorAll('.series');
  return Array.from(series[index].querySelectorAll('.eventBox, .segment'));
}

describe('series rendering', () => {
  it('renders every series of the program, by name', () => {
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH);

    expect(document.querySelectorAll('.series')).toHaveLength(PROGRAM_MILITARY_SNABBMATCH.series.length);
    expect(screen.getByText(/Provserie 10s/)).toBeTruthy();
    expect(screen.getByText(/10s Serie 1/)).toBeTruthy();
  });

  it('renders every event of every series', () => {
    renderTimeline(PROGRAM_FALT_TRANING);

    PROGRAM_FALT_TRANING.series.forEach((series, index) => {
      expect(eventsOfSeries(index)).toHaveLength(series.events.length);
    });
  });

  it('renders nothing for a program with no series', () => {
    const { container } = renderTimeline({ id: 0, title: '', description: '', readonly: true } as Program);
    expect(container.innerHTML).toBe('');
  });
});

describe('choosing a timeline type', () => {
  it('uses the time-scaled timeline when every event is short', () => {
    // Fältträning tops out at a 10 s event, under the 30 s threshold.
    renderTimeline(PROGRAM_FALT_TRANING);
    expect(document.querySelectorAll('.fieldContainer')).toHaveLength(PROGRAM_FALT_TRANING.series.length);
    expect(document.querySelector('.defaultSeries')).toBeNull();
  });

  it('uses the event-based timeline when an event is long', () => {
    // Precision has a 297 s event; drawn to scale it would be a single bar.
    renderTimeline(PROGRAM_PRECISION);
    expect(document.querySelector('.fieldContainer')).toBeNull();
    expect(document.querySelectorAll('.defaultSeries')).toHaveLength(PROGRAM_PRECISION.series.length);
  });

  it('honours an explicit mode over the automatic choice', () => {
    renderTimeline(PROGRAM_FALT_TRANING, { mode: 'default' });
    expect(document.querySelector('.fieldContainer')).toBeNull();
    expect(document.querySelector('.defaultSeries')).toBeTruthy();
  });
});

describe('audio_ids badges', () => {
  // Regression lock. The field was read as `audioIds` while the wire (and the
  // fixtures, and the firmware) say `audio_ids`, so the badge and the tooltip
  // were empty for every program that has audio - silently, because an event
  // with no audio renders perfectly well.
  it('marks an event that carries audio with an A, on the event-based timeline', () => {
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'default' });

    // Provserie 10s: event 0 has audio_ids [50, 1, 28], event 3 has none.
    const events = eventsOfSeries(0);
    expect(within(events[0]).getByText('A')).toBeTruthy();
    expect(events[0].getAttribute('title')).toContain('Audios: 50, 1, 28');

    expect(within(events[3]).queryByText('A')).toBeNull();
    expect(events[3].getAttribute('title')).not.toContain('Audios');
  });

  it('marks an event that carries audio with an A, on the time-scaled timeline', () => {
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'field' });

    const events = eventsOfSeries(0);
    expect(events[0].textContent).toContain('A');
    expect(events[0].getAttribute('title')).toContain('Audios: 50, 1, 28');
  });

  it('shows the audio badge in preference to the show/hide label', () => {
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'default' });

    const events = eventsOfSeries(0);
    // Event 0 is `command: show` AND carries audio: the A wins.
    expect(within(events[0]).queryByText('Show')).toBeNull();
    // Event 3 is a plain show.
    expect(within(events[3]).getByText('Show')).toBeTruthy();
    // Event 4 is a plain hide.
    expect(within(events[4]).getByText('Hide')).toBeTruthy();
  });

  it('does not print "undefined" for an event with no command', () => {
    // Precision's events carry audio only - `command` is absent on the wire.
    renderTimeline(PROGRAM_PRECISION, { mode: 'default' });
    expect(eventsOfSeries(0)[0].getAttribute('title')).toContain('Command: -');
  });
});

describe('event durations', () => {
  it('shows each event duration and the running total, in seconds', () => {
    renderTimeline(PROGRAM_FALT_TRANING, { mode: 'default' });

    // hide 10 s, show 3 s, hide 3 s, ... accumulating 10, 13, 16, ...
    const events = eventsOfSeries(0);
    expect(events[0].querySelector('.duration')!.textContent).toBe('10');
    expect(events[0].querySelector('.accumulated')!.textContent).toBe('10');
    expect(events[1].querySelector('.duration')!.textContent).toBe('3');
    expect(events[1].querySelector('.accumulated')!.textContent).toBe('13');
    expect(events[6].querySelector('.accumulated')!.textContent).toBe('28');
  });

  it('scales segment widths by duration on the time-scaled timeline', () => {
    renderTimeline(PROGRAM_FALT_TRANING);

    // Series 1 totals 28 s: the opening 10 s hide takes 10/28 of the width and
    // starts at 0; the 3 s that follows starts where it ended.
    const events = eventsOfSeries(0);
    expect(events[0].style.left).toBe('0%');
    expect(events[0].style.width).toBe(`${(10000 / 28000) * 100}%`);
    expect(events[1].style.left).toBe(`${(10000 / 28000) * 100}%`);
  });
});

describe('the run position', () => {
  it('marks the active event, and only in the current series', () => {
    renderTimeline(PROGRAM_FALT_TRANING, { currentSeriesIndex: 1, currentEventIndex: 3 });

    expect(eventsOfSeries(1)[3].classList.contains('active')).toBe(true);
    expect(eventsOfSeries(1)[2].classList.contains('active')).toBe(false);
    // Same index in another series must not light up.
    expect(eventsOfSeries(0)[3].classList.contains('active')).toBe(false);
    expect(document.querySelectorAll('.series')[1].classList.contains('active')).toBe(true);
  });

  it('maps tickerSeconds onto the cursor position', () => {
    // 7 s into a 28 s series is a quarter of the way along.
    renderTimeline(PROGRAM_FALT_TRANING, { currentSeriesIndex: 0, currentEventIndex: 0, tickerSeconds: 7 });

    const cursors = document.querySelectorAll<HTMLElement>('.cursor');
    expect(cursors).toHaveLength(1);
    expect(cursors[0].style.left).toBe('25%');
  });

  it('draws no cursor when nothing is running', () => {
    renderTimeline(PROGRAM_FALT_TRANING);
    expect(document.querySelectorAll('.cursor')).toHaveLength(0);
  });

  it('parks the cursor at the start of the series while the ticker is null', () => {
    // Loaded but not started: `tickerSeconds` is null until the first tick.
    renderTimeline(PROGRAM_FALT_TRANING, { currentSeriesIndex: 0, currentEventIndex: 0, tickerSeconds: null });
    expect(document.querySelector<HTMLElement>('.cursor')!.style.left).toBe('0%');
  });
});
