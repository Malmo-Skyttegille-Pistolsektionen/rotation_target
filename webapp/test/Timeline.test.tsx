// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Timeline } from '../src/components/Timeline';
import type { Program, Series } from '../src/api/types';
import { PROGRAM_FALT_TRANING, PROGRAM_MILITARY_SNABBMATCH, PROGRAM_PRECISION } from './fixtures';

afterEach(cleanup);

type Position = {
  currentSeriesIndex?: number | null;
  currentEventIndex?: number | null;
  tickerMs?: number | null;
  mode?: 'auto' | 'default' | 'field';
  audioTitles?: Record<number, string>;
  bankCount?: number;
};

function renderTimeline(program: Program, position: Position = {}) {
  return render(
    <Timeline
      program={program}
      currentSeriesIndex={position.currentSeriesIndex ?? null}
      currentEventIndex={position.currentEventIndex ?? null}
      tickerMs={position.tickerMs ?? null}
      mode={position.mode}
      bankCount={position.bankCount}
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

  // The simulation runs in a memo, above the guard that returns null, so a
  // document missing the fields the contract makes required has to survive it.
  it('renders nothing for a program with no series on a multi-bank device', () => {
    const { container } = renderTimeline({ id: 0, title: '', description: '', readonly: true } as Program, {
      bankCount: 4,
    });
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

describe('centring the running series (#131)', () => {
  /** happy-dom has no layout, so scrollIntoView is a stub worth recording. */
  function recordScrolls(): Array<{ index: number; behavior?: ScrollBehavior }> {
    const calls: Array<{ index: number; behavior?: ScrollBehavior }> = [];
    Element.prototype.scrollIntoView = function (this: Element, options?: boolean | ScrollIntoViewOptions) {
      const all = Array.from(document.querySelectorAll('.series'));
      calls.push({
        index: all.indexOf(this),
        behavior: typeof options === 'object' ? options.behavior : undefined,
      });
    };
    return calls;
  }

  it('does not move the page when a program is first loaded', () => {
    // The operator is at the top working the controls at that moment; yanking
    // the page out from under them is not help.
    const calls = recordScrolls();
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'default', currentSeriesIndex: 0 });
    expect(calls).toHaveLength(0);
  });

  it('centres the new series when the run moves on', () => {
    const calls = recordScrolls();
    const { rerender } = renderTimeline(PROGRAM_MILITARY_SNABBMATCH, {
      mode: 'default',
      currentSeriesIndex: 0,
    });

    rerender(
      <Timeline
        program={PROGRAM_MILITARY_SNABBMATCH}
        currentSeriesIndex={1}
        currentEventIndex={null}
        tickerMs={null}
        mode='default'
      />,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].index).toBe(1);
  });

  it('does not scroll again while the run stays in one series', () => {
    // Continuous scrolling would drag back an operator who deliberately
    // scrolled away to look at something else.
    const calls = recordScrolls();
    const { rerender } = renderTimeline(PROGRAM_MILITARY_SNABBMATCH, {
      mode: 'default',
      currentSeriesIndex: 0,
    });

    const at = (seriesIndex: number, eventIndex: number) =>
      rerender(
        <Timeline
          program={PROGRAM_MILITARY_SNABBMATCH}
          currentSeriesIndex={seriesIndex}
          currentEventIndex={eventIndex}
          tickerMs={eventIndex * 1000}
          mode='default'
        />,
      );

    at(1, 0);
    expect(calls).toHaveLength(1);

    at(1, 1);
    at(1, 2);
    expect(calls).toHaveLength(1);
  });

  it('jumps rather than glides when motion is not wanted', () => {
    const calls = recordScrolls();
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
      }) as MediaQueryList) as typeof window.matchMedia;

    try {
      const { rerender } = renderTimeline(PROGRAM_MILITARY_SNABBMATCH, {
        mode: 'default',
        currentSeriesIndex: 0,
      });
      rerender(
        <Timeline
          program={PROGRAM_MILITARY_SNABBMATCH}
          currentSeriesIndex={1}
          currentEventIndex={null}
          tickerMs={null}
          mode='default'
        />,
      );
      expect(calls[0].behavior).toBe('auto');
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('optional series (#133)', () => {
  it('badges the reshoot series so it is obvious before the program starts', () => {
    // Militar Snabbmatch is 4x10s plus two extra 10s, and the same for 8s and
    // 6s. The extras are reshoots after an approved malfunction; most runs
    // skip them, and the operator should know which two before starting.
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'default' });

    const badges = screen.getAllByText('Optional');
    expect(badges.length).toBeGreaterThan(0);

    const optionalSeries = PROGRAM_MILITARY_SNABBMATCH.series.filter((series) => series.optional === true);
    expect(badges).toHaveLength(optionalSeries.length);
  });

  it('offers Skip only on the series the run is sitting at', () => {
    const skipped: number[] = [];
    const optionalIndex = PROGRAM_MILITARY_SNABBMATCH.series.findIndex((series) => series.optional === true);
    expect(optionalIndex).toBeGreaterThan(-1);

    render(
      <Timeline
        program={PROGRAM_MILITARY_SNABBMATCH}
        currentSeriesIndex={optionalIndex}
        currentEventIndex={null}
        tickerMs={null}
        mode='default'
        onSkipSeries={(index) => skipped.push(index)}
      />,
    );

    // Exactly one Skip, on the current series - not on every optional one.
    const buttons = screen.getAllByRole('button', { name: 'Skip' });
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]);
    expect(skipped).toEqual([optionalIndex + 1]);
  });

  it('never offers Skip on a scoring series', () => {
    // Skipping a scoring series by mistake is worse than the trip back to the
    // dropdown, which still reaches every series.
    const scoringIndex = PROGRAM_MILITARY_SNABBMATCH.series.findIndex((series) => series.optional !== true);

    render(
      <Timeline
        program={PROGRAM_MILITARY_SNABBMATCH}
        currentSeriesIndex={scoringIndex}
        currentEventIndex={null}
        tickerMs={null}
        mode='default'
        onSkipSeries={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('offers no Skip at all when the operator cannot control the device', () => {
    const optionalIndex = PROGRAM_MILITARY_SNABBMATCH.series.findIndex((series) => series.optional === true);
    renderTimeline(PROGRAM_MILITARY_SNABBMATCH, { mode: 'default', currentSeriesIndex: optionalIndex });

    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });
});

describe('the timer anchor (#126)', () => {
  /** Two events, so index 1 is a legal anchor on both timeline types. */
  function anchored(timerStartIndex: number | undefined, longEvent: boolean): Program {
    return {
      id: 1,
      title: 'Anchored',
      description: '',
      readonly: false,
      series: [
        {
          name: 'Serie 1',
          optional: false,
          ...(timerStartIndex === undefined ? {} : { timer_start_index: timerStartIndex }),
          events: [
            { duration: longEvent ? 60000 : 4000, command: 'hide' },
            { duration: 10000, command: 'show' },
          ],
        },
      ],
    };
  }

  // The zero point has to be visible before the series runs - that is the
  // requirement's own reason for the countdown ("makes it obvious where you
  // are on the timeline"), and a marker only the running cursor reveals does
  // not meet it.
  it('marks the anchor event on the event-based timeline', () => {
    renderTimeline(anchored(1, true), { mode: 'default' });
    expect(screen.getByTestId('timeline-anchor-0')).toBeTruthy();
    expect(within(screen.getByTestId('timeline-event-0-1')).getByText('0:00')).toBeTruthy();
  });

  it('marks the anchor on the time-scaled timeline', () => {
    renderTimeline(anchored(1, false), { mode: 'field' });
    expect(screen.getByTestId('timeline-anchor-line-0')).toBeTruthy();
  });

  // Index 0 is the default and means "the clock starts with the series", which
  // is what every program meant before the field existed. Marking it would put
  // a badge on the first event of every shipped program.
  // The cumulative on each card is what the run clock will read there, so the
  // card the badge calls 0:00 says 0 rather than 72. Decided on #126: one clock
  // on the page, not two answering different questions.
  // The card carries the time the run clock will read where that event *ends*.
  // With the anchor on event 1, event 0 ends exactly at zero.
  it('reads the card cumulative from the anchor, signed', () => {
    renderTimeline(anchored(1, true), { mode: 'default' });
    expect(screen.getByTestId('timeline-cumulative-0-0').textContent).toBe('0');
    expect(screen.getByTestId('timeline-cumulative-0-1').textContent).toBe('+10');
  });

  it('leaves the cumulative unsigned and series-absolute when there is no anchor', () => {
    renderTimeline(anchored(undefined, true), { mode: 'default' });
    expect(screen.getByTestId('timeline-cumulative-0-0').textContent).toBe('60');
    expect(screen.getByTestId('timeline-cumulative-0-1').textContent).toBe('70');
  });

  it('marks nothing when the series anchors at 0, and nothing when the field is absent', () => {
    renderTimeline(anchored(0, true), { mode: 'default' });
    expect(screen.queryByTestId('timeline-anchor-0')).toBeNull();
    cleanup();

    renderTimeline(anchored(undefined, true), { mode: 'default' });
    expect(screen.queryByTestId('timeline-anchor-0')).toBeNull();
  });
});

/**
 * A four-bank program in the shape the example ships: a baseline that hides
 * everything, one letter shown per event, and a pause that names nothing.
 */
const BANKED: Program = {
  id: 41,
  title: 'Fältträning, 4 mål',
  description: '',
  readonly: false,
  series: [
    {
      name: 'Station 1',
      optional: false,
      events: [
        { duration: 7000, command: 'hide', audio_ids: [26] },
        { duration: 4000, banks: { A: 'show' } },
        { duration: 4000, command: 'hide', banks: { B: 'show' } },
        { duration: 3000, command: 'hide' },
        { duration: 4000 },
      ],
    },
  ],
};

describe('target banks', () => {
  // The property the whole feature is built around: a one-bank device renders
  // what it always rendered. A snapshot of the real DOM rather than a
  // comparison with itself, so a change to the shared path has to be
  // acknowledged rather than passing silently.
  it('renders the one-bank card view exactly as before', () => {
    const { container } = render(
      <Timeline
        program={PROGRAM_MILITARY_SNABBMATCH}
        currentSeriesIndex={null}
        currentEventIndex={null}
        tickerMs={null}
        mode='default'
      />,
    );
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<div class="timelineWrapper" data-testid="timeline"><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>Provserie 10s</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-0-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-0-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-0-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-0-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-0-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-0-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-0-3"><span class="duration">10</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-0-3">82</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-0-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-0-4">83</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-0-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-0-5">86</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-0-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-0-6">87</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>10s Serie 1</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-1-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-1-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-1-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-1-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-1-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-1-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-1-3"><span class="duration">10</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-1-3">82</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-1-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-1-4">83</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-1-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-1-5">86</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-1-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-1-6">87</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>10s Serie 2</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-2-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-2-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-2-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-2-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-2-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-2-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-2-3"><span class="duration">10</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-2-3">82</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-2-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-2-4">83</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-2-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-2-5">86</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-2-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-2-6">87</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>10s Serie 3</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-3-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-3-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-3-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-3-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-3-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-3-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-3-3"><span class="duration">10</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-3-3">82</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-3-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-3-4">83</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-3-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-3-5">86</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-3-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-3-6">87</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>10s Serie 4</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-4-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-4-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-4-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-4-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-4-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-4-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-4-3"><span class="duration">10</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-4-3">82</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-4-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-4-4">83</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-4-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-4-5">86</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-4-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-4-6">87</span></button></div></div><div class="series optional" data-testid="timeline-series"><div class="seriesTitle"><span>Färdigskjutning 1, 10 sekunder</span><span class="optionalBadge">Optional</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-5-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-5-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-5-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-5-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-5-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-5-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-5-3"><span class="duration">10</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-5-3">82</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-5-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-5-4">83</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-5-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-5-5">86</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-5-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-5-6">87</span></button></div></div><div class="series optional" data-testid="timeline-series"><div class="seriesTitle"><span>Färdigskjutning 2, 10 sekunder</span><span class="optionalBadge">Optional</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-6-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-6-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-6-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-6-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-6-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-6-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-6-3"><span class="duration">10</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-6-3">82</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-6-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-6-4">83</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-6-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-6-5">86</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-6-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-6-6">87</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>8s Serie 1</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-7-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-7-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-7-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-7-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-7-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-7-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-7-3"><span class="duration">8</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-7-3">80</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-7-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-7-4">81</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-7-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-7-5">84</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-7-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-7-6">85</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>8s Serie 2</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-8-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-8-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-8-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-8-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-8-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-8-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-8-3"><span class="duration">8</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-8-3">80</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-8-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-8-4">81</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-8-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-8-5">84</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-8-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-8-6">85</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>8s Serie 3</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-9-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-9-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-9-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-9-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-9-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-9-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-9-3"><span class="duration">8</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-9-3">80</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-9-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-9-4">81</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-9-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-9-5">84</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-9-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-9-6">85</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>8s Serie 4</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-10-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-10-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-10-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-10-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-10-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-10-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-10-3"><span class="duration">8</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-10-3">80</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-10-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-10-4">81</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-10-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-10-5">84</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-10-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-10-6">85</span></button></div></div><div class="series optional" data-testid="timeline-series"><div class="seriesTitle"><span>Färdigskjutning 1, 8 sekunder</span><span class="optionalBadge">Optional</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-11-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-11-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-11-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-11-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-11-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-11-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-11-3"><span class="duration">8</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-11-3">80</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-11-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-11-4">81</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-11-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-11-5">84</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-11-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-11-6">85</span></button></div></div><div class="series optional" data-testid="timeline-series"><div class="seriesTitle"><span>Färdigskjutning 2, 8 sekunder</span><span class="optionalBadge">Optional</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-12-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-12-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-12-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-12-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-12-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-12-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-12-3"><span class="duration">8</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-12-3">80</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-12-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-12-4">81</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-12-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-12-5">84</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-12-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-12-6">85</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>6s Serie 1</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-13-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-13-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-13-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-13-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-13-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-13-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-13-3"><span class="duration">6</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-13-3">78</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-13-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-13-4">79</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-13-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-13-5">82</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-13-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-13-6">83</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>6s Serie 2</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-14-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-14-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-14-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-14-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-14-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-14-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-14-3"><span class="duration">6</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-14-3">78</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-14-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-14-4">79</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-14-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-14-5">82</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-14-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-14-6">83</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>6s Serie 3</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-15-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-15-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-15-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-15-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-15-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-15-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-15-3"><span class="duration">6</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-15-3">78</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-15-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-15-4">79</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-15-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-15-5">82</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-15-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-15-6">83</span></button></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>6s Serie 4</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-16-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-16-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-16-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-16-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-16-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-16-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-16-3"><span class="duration">6</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-16-3">78</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-16-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-16-4">79</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-16-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-16-5">82</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-16-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-16-6">83</span></button></div></div><div class="series optional" data-testid="timeline-series"><div class="seriesTitle"><span>Färdigskjutning 1, 6 sekunder</span><span class="optionalBadge">Optional</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-17-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-17-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-17-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-17-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-17-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-17-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-17-3"><span class="duration">6</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-17-3">78</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-17-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-17-4">79</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-17-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-17-5">82</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-17-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-17-6">83</span></button></div></div><div class="series optional" data-testid="timeline-series"><div class="seriesTitle"><span>Färdigskjutning 2, 6 sekunder</span><span class="optionalBadge">Optional</span></div><div class="defaultSeries"><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-18-0"><span class="duration">5</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-18-0">5</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-18-1"><span class="duration">60</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-18-1">65</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-18-2"><span class="duration">7</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-18-2">72</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-18-3"><span class="duration">6</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg></span><span class="accumulated" data-testid="timeline-cumulative-18-3">78</span></button><button type="button" class="eventBox hide" aria-pressed="false" data-testid="timeline-event-18-4"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets hidden" role="img" fill="currentColor"><rect x="6.9" y="2" width="2.2" height="12" rx="1.1"></rect></svg></span><span class="accumulated" data-testid="timeline-cumulative-18-4">79</span></button><button type="button" class="eventBox" aria-pressed="false" data-testid="timeline-event-18-5"><span class="duration">3</span><span class="symbol"><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-18-5">82</span></button><button type="button" class="eventBox show" aria-pressed="false" data-testid="timeline-event-18-6"><span class="duration">1</span><span class="symbol"><svg class="commandIcon" viewBox="0 0 16 16" width="13" height="13" aria-label="Targets shown" role="img"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle><circle cx="8" cy="8" r="2.2" fill="currentColor"></circle></svg><svg class="audioIcon" viewBox="0 0 16 16" width="12" height="12" aria-label="Plays audio" role="img" fill="currentColor"><path d="M8 2.5v11a.6.6 0 0 1-1 .43L4.2 11.2H2.4a.9.9 0 0 1-.9-.9V5.7a.9.9 0 0 1 .9-.9h1.8L7 2.07A.6.6 0 0 1 8 2.5Z"></path><path d="M10.6 5.3a.7.7 0 0 1 1-.06 4 4 0 0 1 0 5.52.7.7 0 1 1-1-.94 2.6 2.6 0 0 0 0-3.64.7.7 0 0 1 0-.88Z"></path></svg></span><span class="accumulated" data-testid="timeline-cumulative-18-6">83</span></button></div></div></div>"`,
    );
  });

  it('renders the one-bank time-scaled view exactly as before', () => {
    const { container } = render(
      <Timeline program={PROGRAM_FALT_TRANING} currentSeriesIndex={0} currentEventIndex={2} tickerMs={9000} />,
    );
    expect(container.innerHTML).toMatchInlineSnapshot(`
      "<div class="timelineWrapper" data-testid="timeline"><div class="series active" data-testid="timeline-series"><div class="seriesTitle"><span>Series 1 (x=3, y=3)</span></div><div class="fieldContainer"><div class="centerLine"></div><div class="segment hide" style="left: 0%; width: 35.714285714285715%;" title="Duration: 10s
      Command: hide"><span class="segmentLabel">10s Hide</span></div><div class="segment show" style="left: 35.714285714285715%; width: 10.714285714285714%;" title="Duration: 3s
      Command: show"><span class="segmentLabel">3s Show</span></div><div class="segment active hide" style="left: 46.42857142857143%; width: 10.714285714285714%;" title="Duration: 3s
      Command: hide"><span class="segmentLabel">3s Hide</span></div><div class="segment show" style="left: 57.142857142857146%; width: 10.714285714285714%;" title="Duration: 3s
      Command: show"><span class="segmentLabel">3s Show</span></div><div class="segment hide" style="left: 67.85714285714286%; width: 10.714285714285714%;" title="Duration: 3s
      Command: hide"><span class="segmentLabel">3s Hide</span></div><div class="segment show" style="left: 78.57142857142857%; width: 10.714285714285714%;" title="Duration: 3s
      Command: show"><span class="segmentLabel">3s Show</span></div><div class="segment hide" style="left: 89.28571428571428%; width: 10.714285714285714%;" title="Duration: 3s
      Command: hide"><span class="segmentLabel">3s Hide</span></div><div class="cursor" style="left: 32.142857142857146%;" data-testid="timeline-cursor"><div class="cursorHead"></div></div><div class="axis"><div class="tick" style="left: 0%;"><span class="tickLabel">0</span></div><div class="tick" style="left: 3.571428571428571%;"><span class="tickLabel">1</span></div><div class="tick" style="left: 7.142857142857142%;"><span class="tickLabel">2</span></div><div class="tick" style="left: 10.714285714285714%;"><span class="tickLabel">3</span></div><div class="tick" style="left: 14.285714285714285%;"><span class="tickLabel">4</span></div><div class="tick" style="left: 17.857142857142858%;"><span class="tickLabel">5</span></div><div class="tick" style="left: 21.428571428571427%;"><span class="tickLabel">6</span></div><div class="tick" style="left: 25%;"><span class="tickLabel">7</span></div><div class="tick" style="left: 28.57142857142857%;"><span class="tickLabel">8</span></div><div class="tick" style="left: 32.142857142857146%;"><span class="tickLabel">9</span></div><div class="tick" style="left: 35.714285714285715%;"><span class="tickLabel">10</span></div><div class="tick" style="left: 39.285714285714285%;"><span class="tickLabel">11</span></div><div class="tick" style="left: 42.857142857142854%;"><span class="tickLabel">12</span></div><div class="tick" style="left: 46.42857142857143%;"><span class="tickLabel">13</span></div><div class="tick" style="left: 50%;"><span class="tickLabel">14</span></div><div class="tick" style="left: 53.57142857142857%;"><span class="tickLabel">15</span></div><div class="tick" style="left: 57.14285714285714%;"><span class="tickLabel">16</span></div><div class="tick" style="left: 60.71428571428571%;"><span class="tickLabel">17</span></div><div class="tick" style="left: 64.28571428571429%;"><span class="tickLabel">18</span></div><div class="tick" style="left: 67.85714285714286%;"><span class="tickLabel">19</span></div><div class="tick" style="left: 71.42857142857143%;"><span class="tickLabel">20</span></div><div class="tick" style="left: 75%;"><span class="tickLabel">21</span></div><div class="tick" style="left: 78.57142857142857%;"><span class="tickLabel">22</span></div><div class="tick" style="left: 82.14285714285714%;"><span class="tickLabel">23</span></div><div class="tick" style="left: 85.71428571428571%;"><span class="tickLabel">24</span></div><div class="tick" style="left: 89.28571428571429%;"><span class="tickLabel">25</span></div><div class="tick" style="left: 92.85714285714286%;"><span class="tickLabel">26</span></div><div class="tick" style="left: 96.42857142857143%;"><span class="tickLabel">27</span></div><div class="tick" style="left: 100%;"><span class="tickLabel">28<span class="tickUnit"> s</span></span></div></div></div></div><div class="series" data-testid="timeline-series"><div class="seriesTitle"><span>Series 2 (x=2, y=3)</span></div><div class="fieldContainer"><div class="centerLine"></div><div class="segment hide" style="left: 0%; width: 40%;" title="Duration: 10s
      Command: hide"><span class="segmentLabel">10s Hide</span></div><div class="segment show" style="left: 40%; width: 8%;" title="Duration: 2s
      Command: show"><span class="segmentLabel">2s Show</span></div><div class="segment hide" style="left: 48%; width: 12%;" title="Duration: 3s
      Command: hide"><span class="segmentLabel">3s Hide</span></div><div class="segment show" style="left: 60%; width: 8%;" title="Duration: 2s
      Command: show"><span class="segmentLabel">2s Show</span></div><div class="segment hide" style="left: 68%; width: 12%;" title="Duration: 3s
      Command: hide"><span class="segmentLabel">3s Hide</span></div><div class="segment show" style="left: 80%; width: 8%;" title="Duration: 2s
      Command: show"><span class="segmentLabel">2s Show</span></div><div class="segment hide" style="left: 88%; width: 12%;" title="Duration: 3s
      Command: hide"><span class="segmentLabel">3s Hide</span></div><div class="axis"><div class="tick" style="left: 0%;"><span class="tickLabel">0</span></div><div class="tick" style="left: 4%;"><span class="tickLabel">1</span></div><div class="tick" style="left: 8%;"><span class="tickLabel">2</span></div><div class="tick" style="left: 12%;"><span class="tickLabel">3</span></div><div class="tick" style="left: 16%;"><span class="tickLabel">4</span></div><div class="tick" style="left: 20%;"><span class="tickLabel">5</span></div><div class="tick" style="left: 24%;"><span class="tickLabel">6</span></div><div class="tick" style="left: 28.000000000000004%;"><span class="tickLabel">7</span></div><div class="tick" style="left: 32%;"><span class="tickLabel">8</span></div><div class="tick" style="left: 36%;"><span class="tickLabel">9</span></div><div class="tick" style="left: 40%;"><span class="tickLabel">10</span></div><div class="tick" style="left: 44%;"><span class="tickLabel">11</span></div><div class="tick" style="left: 48%;"><span class="tickLabel">12</span></div><div class="tick" style="left: 52%;"><span class="tickLabel">13</span></div><div class="tick" style="left: 56.00000000000001%;"><span class="tickLabel">14</span></div><div class="tick" style="left: 60%;"><span class="tickLabel">15</span></div><div class="tick" style="left: 64%;"><span class="tickLabel">16</span></div><div class="tick" style="left: 68%;"><span class="tickLabel">17</span></div><div class="tick" style="left: 72%;"><span class="tickLabel">18</span></div><div class="tick" style="left: 76%;"><span class="tickLabel">19</span></div><div class="tick" style="left: 80%;"><span class="tickLabel">20</span></div><div class="tick" style="left: 84%;"><span class="tickLabel">21</span></div><div class="tick" style="left: 88%;"><span class="tickLabel">22</span></div><div class="tick" style="left: 92%;"><span class="tickLabel">23</span></div><div class="tick" style="left: 96%;"><span class="tickLabel">24</span></div><div class="tick" style="left: 100%;"><span class="tickLabel">25<span class="tickUnit"> s</span></span></div></div></div></div></div>"
    `);
  });

  it('draws a lettered cell per bank on each card', () => {
    renderTimeline(BANKED, { mode: 'default', bankCount: 4 });

    const glyph = screen.getByTestId('timeline-event-0-1').querySelector('.glyph');
    expect(Array.from(glyph?.children ?? []).map((cell) => cell.textContent)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('shows the resulting state of every bank, carried from the previous event', () => {
    renderTimeline(BANKED, { mode: 'default', bankCount: 4 });

    // `hide` with `{A: show}` on top: A shown and addressed, B-D hidden and
    // addressed by the baseline.
    const cells = screen.getByTestId('timeline-event-0-1').querySelectorAll('.glyph > *');
    expect(cells[0].className).toContain('bankShown');
    expect(cells[1].className).toContain('bankHidden');

    // The pause names nothing, so every cell carries the previous state and
    // none of them is solid.
    const carried = screen.getByTestId('timeline-event-0-4').querySelectorAll('.glyph > *');
    expect(Array.from(carried).every((cell) => !cell.className.includes('addressed'))).toBe(true);
  });

  it('tints a card only when every bank agrees', () => {
    renderTimeline(BANKED, { mode: 'default', bankCount: 4 });

    // Every bank hidden.
    expect(screen.getByTestId('timeline-event-0-0').className).toContain('hide');
    // A shown, the rest hidden.
    const mixed = screen.getByTestId('timeline-event-0-1').className;
    expect(mixed).not.toContain('hide');
    expect(mixed).not.toContain('show');
  });

  it('drops the command icon on an event that names a bank, and keeps it otherwise', () => {
    renderTimeline(BANKED, { mode: 'default', bankCount: 4 });

    expect(screen.getByTestId('timeline-event-0-2').querySelector('svg[aria-label="Targets hidden"]')).toBeNull();
    expect(screen.getByTestId('timeline-event-0-3').querySelector('svg[aria-label="Targets hidden"]')).toBeTruthy();
  });

  it('draws one lane per bank in the time-scaled view, plus the cursor', () => {
    renderTimeline(BANKED, { mode: 'field', bankCount: 4, currentSeriesIndex: 0, tickerMs: 9000 });

    expect(document.querySelectorAll('.lane')).toHaveLength(4);
    expect(screen.getByTestId('timeline-lane-0-C')).toBeTruthy();
    expect(screen.getByTestId('timeline-cursor')).toBeTruthy();
    // One segment per event, per lane.
    expect(screen.getByTestId('timeline-lane-0-A').querySelectorAll('.laneSegment')).toHaveLength(5);
  });

  it('marks the lane edge only where that bank actually moved', () => {
    renderTimeline(BANKED, { mode: 'field', bankCount: 4 });

    const laneA = screen.getByTestId('timeline-lane-0-A').querySelectorAll('.laneSegment');
    // A: hidden, shown, hidden, hidden, hidden - edges at events 1 and 2 only.
    expect(Array.from(laneA).map((segment) => segment.className.includes('edge'))).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
  });

  it('labels the lane axis with round numbers and the series edges', () => {
    // Militär Snabbmatch's Provserie: 5 + 60 + 7 + 10 + 1 + 3 + 1 = 87 s.
    const provserie: Series = {
      name: 'Provserie 10s',
      optional: false,
      events: [5000, 60000, 7000, 10000, 1000, 3000, 1000].map((duration) => ({ duration, command: 'show' })),
    };
    renderTimeline(
      { id: 1, title: '', description: '', readonly: true, series: [provserie] },
      {
        mode: 'field',
        bankCount: 2,
      },
    );
    const labels = Array.from(screen.getByTestId('timeline-lane-axis-0').querySelectorAll('span')).map(
      (span) => span.textContent,
    );
    // 87 s at a 15 s step: the quarter marks (22, 44, 65) are gone.
    expect(labels).toEqual(['0', '15', '30', '45', '60', '75', '87 s']);
  });

  it('puts the lane axis zero where the run timer reads zero', () => {
    const anchored: Series = {
      name: 'Anchored',
      optional: false,
      timer_start_index: 1,
      events: [5000, 60000, 7000, 10000, 1000, 3000, 1000].map((duration) => ({ duration, command: 'show' })),
    };
    renderTimeline(
      { id: 1, title: '', description: '', readonly: true, series: [anchored] },
      {
        mode: 'field',
        bankCount: 2,
      },
    );
    const labels = Array.from(screen.getByTestId('timeline-lane-axis-0').querySelectorAll('span')).map(
      (span) => span.textContent,
    );
    // The series starts 5 s before the timer's zero; that edge is too close
    // to the zero tick to label separately, so zero takes its place.
    expect(labels).toEqual(['0', '+15', '+30', '+45', '+60', '+75', '+82 s']);
  });

  it('keeps the single-lane time-scaled view on a one-bank device', () => {
    renderTimeline(PROGRAM_FALT_TRANING, { mode: 'field' });
    expect(document.querySelectorAll('.lane')).toHaveLength(0);
    expect(document.querySelector('.fieldContainer')).toBeTruthy();
  });

  it('lists every bank in the detail panel, naming the ones the event left alone', () => {
    renderTimeline(BANKED, { mode: 'default', bankCount: 4 });
    fireEvent.click(screen.getByTestId('timeline-event-0-1'));

    const targets = detailRow('Targets');
    expect(targets).toContain('A shown');
    expect(targets).toContain('B hidden');
    expect(targets).not.toContain('A shown (unchanged)');

    cleanup();
    renderTimeline(BANKED, { mode: 'default', bankCount: 4 });
    fireEvent.click(screen.getByTestId('timeline-event-0-4'));
    expect(detailRow('Targets')).toContain('D hidden (unchanged)');
  });
});
