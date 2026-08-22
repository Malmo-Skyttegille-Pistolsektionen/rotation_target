// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Timeline } from '../src/components/Timeline';
import type { Program } from '../src/api/types';
import { PROGRAM_FALT_TRANING, PROGRAM_MILITARY_SNABBMATCH, PROGRAM_PRECISION } from './fixtures';

afterEach(cleanup);

type Position = {
  currentSeriesIndex?: number | null;
  currentEventIndex?: number | null;
  tickerMs?: number | null;
  mode?: 'auto' | 'default' | 'field';
  audioTitles?: Record<number, string>;
};

function renderTimeline(program: Program, position: Position = {}) {
  return render(
    <Timeline
      program={program}
      currentSeriesIndex={position.currentSeriesIndex ?? null}
      currentEventIndex={position.currentEventIndex ?? null}
      tickerMs={position.tickerMs ?? null}
      mode={position.mode}
      audioTitles={position.audioTitles}
    />,
  );
}

/** The detail panel's value for one of its labelled rows. */
function detailRow(label: string): string {
  const panel = screen.getByTestId('timeline-event-detail');
  const terms = Array.from(panel.querySelectorAll('dt'));
  const term = terms.find((dt) => dt.textContent === label);
  if (term?.nextElementSibling == null) throw new Error(`no detail row labelled ${label}`);
  return term.nextElementSibling.textContent ?? '';
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
  it('marks an event that carries audio, on the event-based timeline', () => {
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'default' });

    // Provserie 10s: event 0 has audio_ids [50, 1, 28], event 3 has none.
    const events = eventsOfSeries(0);
    expect(within(events[0]).getByLabelText('Plays audio')).toBeTruthy();
    fireEvent.click(events[0]);
    expect(detailRow('Audio')).toBe('clip 50clip 1clip 28');

    expect(within(events[3]).queryByLabelText('Plays audio')).toBeNull();
    fireEvent.click(events[3]);
    expect(detailRow('Audio')).toBe('none');
  });

  it('marks an event that carries audio, on the time-scaled timeline', () => {
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'field' });

    // A word rather than the icon here: the scaled label ellipsises, and event 0
    // is a `show` that also carries audio, so the command is what it leads with.
    const events = eventsOfSeries(0);
    expect(events[0].textContent).toContain('Show');
    expect(events[0].getAttribute('title')).toContain('Audios: 50, 1, 28');
  });

  it('shows the command and the audio together, not one instead of the other', () => {
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'default' });

    const events = eventsOfSeries(0);
    // Event 0 is `command: show` AND carries audio. The audio badge used to win
    // and hide the command, which mattered most on the events that have both -
    // Militär Snabbmatch's "Load!" carries audio and presents the targets, and
    // read on the card as audio only.
    expect(within(events[0]).getByLabelText('Targets shown')).toBeTruthy();
    expect(within(events[0]).getByLabelText('Plays audio')).toBeTruthy();
    // Event 3 is a plain show, event 4 a plain hide. The words live in the
    // aria-labels now: the card shows what the target does, a disc face-on and
    // the same disc turned edge-on.
    expect(within(events[3]).getByLabelText('Targets shown')).toBeTruthy();
    expect(within(events[4]).getByLabelText('Targets hidden')).toBeTruthy();
  });

  it('does not print "undefined" for an event with no command', () => {
    // Precision's events carry audio only - `command` is absent on the wire.
    renderTimeline(PROGRAM_PRECISION, { mode: 'default' });
    fireEvent.click(eventsOfSeries(0)[0]);
    expect(detailRow('Targets')).toBe('Unchanged — a timed pause');
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

describe('the field timeline axis', () => {
  // Regression lock. Every tick used to carry its own "s" suffix - "0s 1s
  // 2s … 28s" - which repeats the unit as many times as there are ticks.
  it('numbers ticks with bare digits and states the unit once, on the final tick', () => {
    renderTimeline(PROGRAM_FALT_TRANING, { mode: 'field' });

    // Series 1 totals 28 s: one tick per second, 0 through 28.
    const ticks = Array.from(document.querySelectorAll('.axis')[0].querySelectorAll('.tick'));
    expect(ticks).toHaveLength(29);

    expect(ticks[0].textContent).toBe('0');
    expect(ticks[5].textContent).toBe('5');
    expect(ticks[28].textContent).toBe('28 s');

    // "s" appears exactly once across the whole axis, not once per tick.
    const axisText = document.querySelectorAll('.axis')[0].textContent ?? '';
    expect(axisText.match(/s/g)).toHaveLength(1);
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

  it('maps tickerMs onto the cursor position', () => {
    // 7 s into a 28 s series is a quarter of the way along.
    renderTimeline(PROGRAM_FALT_TRANING, { currentSeriesIndex: 0, currentEventIndex: 0, tickerMs: 7000 });

    const cursors = document.querySelectorAll<HTMLElement>('.cursor');
    expect(cursors).toHaveLength(1);
    expect(cursors[0].style.left).toBe('25%');
  });

  it('positions the cursor from the sub-second part too', () => {
    // The point of D-16. With a whole-second ticker this landed on 25 % as
    // well - a second, and a whole event, behind the targets.
    renderTimeline(PROGRAM_FALT_TRANING, { currentSeriesIndex: 0, currentEventIndex: 0, tickerMs: 7480 });

    expect(document.querySelector<HTMLElement>('.cursor')!.style.left).toBe(`${(7480 / 28000) * 100}%`);
  });

  it('draws no cursor when nothing is running', () => {
    renderTimeline(PROGRAM_FALT_TRANING);
    expect(document.querySelectorAll('.cursor')).toHaveLength(0);
  });

  it('parks the cursor at the start of the series while the ticker is null', () => {
    // Loaded but not started: `tickerMs` is null until the first tick.
    renderTimeline(PROGRAM_FALT_TRANING, { currentSeriesIndex: 0, currentEventIndex: 0, tickerMs: null });
    expect(document.querySelector<HTMLElement>('.cursor')!.style.left).toBe('0%');
  });
});

describe('event detail (#125)', () => {
  it('says nothing until an event is pointed at', () => {
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'default' });
    expect(screen.queryByTestId('timeline-event-detail')).toBeNull();
  });

  it('names the audio clips rather than their ids, when it knows them', () => {
    // The clips an event plays were not visible anywhere on the run page. Ids
    // are the fallback, not the answer - nobody knows what clip 50 is.
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, {
      mode: 'default',
      audioTitles: { 50: 'Ready on the firing line', 1: 'Beep', 28: 'Commence fire' },
    });

    fireEvent.click(eventsOfSeries(0)[0]);
    // A list, not a comma-joined string: clip titles are things like "1" and
    // "10 sekunder", which run together unreadably when joined.
    const clips = screen.getByTestId('timeline-event-detail').querySelectorAll('ol li');
    expect(Array.from(clips).map((li) => li.textContent)).toEqual([
      'Ready on the firing line',
      'Beep',
      'Commence fire',
    ]);
  });

  it('previews on hover and lets go again', () => {
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'default' });
    const event = eventsOfSeries(0)[0];

    fireEvent.mouseEnter(event);
    expect(screen.getByTestId('timeline-event-detail')).toBeTruthy();

    fireEvent.mouseLeave(event);
    expect(screen.queryByTestId('timeline-event-detail')).toBeNull();
  });

  it('keeps the detail up after a tap, because a phone has no hover', () => {
    // The whole reason clicking pins: on a touch screen the pointer leaves the
    // instant the finger does, so a hover-only panel would flash and vanish.
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'default' });
    const event = eventsOfSeries(0)[0];

    fireEvent.click(event);
    fireEvent.mouseLeave(event);
    expect(screen.getByTestId('timeline-event-detail')).toBeTruthy();

    // Tapping the same event again lets it go.
    fireEvent.click(event);
    expect(screen.queryByTestId('timeline-event-detail')).toBeNull();
  });

  it('places the event within its series, in seconds', () => {
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'default' });

    // Event 1 starts where event 0 ended.
    const events = eventsOfSeries(0);
    fireEvent.click(events[1]);
    const startsAt = detailRow('Starts at');
    expect(startsAt).toContain('s into');
    expect(detailRow('Ends at')).toMatch(/^[\d.]+ s$/);
  });
});
