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
  it('marks nothing when the series anchors at 0, and nothing when the field is absent', () => {
    renderTimeline(anchored(0, true), { mode: 'default' });
    expect(screen.queryByTestId('timeline-anchor-0')).toBeNull();
    cleanup();

    renderTimeline(anchored(undefined, true), { mode: 'default' });
    expect(screen.queryByTestId('timeline-anchor-0')).toBeNull();
  });
});
