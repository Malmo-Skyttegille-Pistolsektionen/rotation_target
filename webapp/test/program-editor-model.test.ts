/**
 * The editing operations, without a DOM.
 *
 * The legacy editor had no test of any of this: the operations lived inside
 * click handlers over a mutable module-level object, and the same reorder was
 * written three times (Form, Events, Timeline) with three chances to be wrong.
 * Here they are one reducer, so this file is the whole surface.
 */
import { describe, expect, it } from 'vitest';

import type { Program } from '../src/api/types';
import { authoringIssues, authoringRegressions, parseProgramDocument } from '../src/lib/program-document';
import {
  createEditorState,
  describeEvent,
  durationMs,
  editorReducer,
  isDirty,
  seriesMs,
  toDocument,
  toJson,
  toPreviewProgram,
  type DraftEvent,
  type EditorAction,
  type EditorState,
} from '../src/lib/program-editor';
import { PROGRAM_FALT_TRANING } from './fixtures';

/** Apply a list of actions, the way a session of clicks would. */
function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

function seriesNames(state: EditorState): string[] {
  return state.draft.series.map((series) => series.name);
}

function durations(state: EditorState, seriesIndex = 0): string[] {
  return state.draft.series[seriesIndex].events.map((event) => event.duration);
}

describe('opening a session', () => {
  it('starts a new program with one series holding one event', () => {
    const state = createEditorState(null);

    expect(state.draft.title).toBe('');
    expect(state.draft.series).toHaveLength(1);
    expect(state.draft.series[0].events).toHaveLength(1);
    expect(durations(state)).toEqual(['1000']);
    expect(isDirty(state)).toBe(false);
  });

  it('carries an existing program in, and drops the fields the device owns', () => {
    const state = createEditorState(PROGRAM_FALT_TRANING);

    expect(state.draft.title).toBe(PROGRAM_FALT_TRANING.title);
    expect(state.draft.series).toHaveLength(PROGRAM_FALT_TRANING.series.length);
    // `id` and `readonly` are the device's, so the draft has nowhere to put
    // them and the document it emits never carries them.
    expect(Object.keys(toDocument(state.draft))).toEqual(['title', 'description', 'series']);
  });

  it('gives every series and event a key that survives a reorder', () => {
    const state = createEditorState(PROGRAM_FALT_TRANING);
    const before = state.draft.series.map((series) => series.key);

    const moved = editorReducer(state, { type: 'moveSeries', from: 0, to: 1 });

    expect(moved.draft.series.map((series) => series.key)).toEqual([before[1], before[0], ...before.slice(2)]);
  });
});

describe('dirty tracking', () => {
  it('is clean until the document changes, and clean again when it changes back', () => {
    const state = createEditorState(PROGRAM_FALT_TRANING);
    const typed = editorReducer(state, { type: 'setTitle', value: 'Klubbserie' });

    expect(isDirty(typed)).toBe(true);
    expect(isDirty(editorReducer(typed, { type: 'setTitle', value: PROGRAM_FALT_TRANING.title }))).toBe(false);
  });

  it('does not count collapsing or selecting as an edit', () => {
    const state = createEditorState(PROGRAM_FALT_TRANING);
    const key = state.draft.series[0].key;

    expect(isDirty(run(state, { type: 'toggleCollapsed', key }, { type: 'selectAllEvents' }))).toBe(false);
  });

  it('is clean against what the device stored, not against what was sent', () => {
    const state = editorReducer(createEditorState(null), { type: 'setTitle', value: 'Ny' });
    const stored: Program = {
      id: 102,
      title: 'Ny',
      description: '',
      readonly: false,
      series: PROGRAM_FALT_TRANING.series,
    };

    const saved = editorReducer(state, { type: 'saved', program: stored });

    expect(isDirty(saved)).toBe(false);
    expect(saved.draft.series).toHaveLength(stored.series.length);
  });
});

describe('series operations', () => {
  const base = createEditorState({
    ...PROGRAM_FALT_TRANING,
    series: [
      { name: 'A', optional: false, events: [{ duration: 1000 }] },
      { name: 'B', optional: false, events: [{ duration: 2000 }] },
      { name: 'C', optional: true, events: [{ duration: 3000 }] },
    ],
  });

  it('moves one up and one down', () => {
    expect(seriesNames(editorReducer(base, { type: 'moveSeries', from: 2, to: 1 }))).toEqual(['A', 'C', 'B']);
    expect(seriesNames(editorReducer(base, { type: 'moveSeries', from: 0, to: 1 }))).toEqual(['B', 'A', 'C']);
  });

  it('ignores a move off either end', () => {
    expect(seriesNames(editorReducer(base, { type: 'moveSeries', from: 0, to: -1 }))).toEqual(['A', 'B', 'C']);
    expect(seriesNames(editorReducer(base, { type: 'moveSeries', from: 2, to: 3 }))).toEqual(['A', 'B', 'C']);
  });

  it('duplicates one in place, marked as a copy, with its own keys', () => {
    const copied = editorReducer(base, { type: 'duplicateSeries', series: 1 });

    expect(seriesNames(copied)).toEqual(['A', 'B', 'B (copy)', 'C']);
    expect(copied.draft.series[2].key).not.toBe(copied.draft.series[1].key);
    expect(copied.draft.series[2].events[0].key).not.toBe(copied.draft.series[1].events[0].key);
    expect(copied.draft.series[2].events[0].duration).toBe('2000');
  });

  it('copies the audio list rather than sharing it with the original', () => {
    const withAudio = editorReducer(base, { type: 'addAudio', series: 0, event: 0, audioId: 26 });
    const copied = editorReducer(withAudio, { type: 'duplicateSeries', series: 0 });

    const added = editorReducer(copied, { type: 'addAudio', series: 1, event: 0, audioId: 33 });

    expect(added.draft.series[1].events[0].audioIds).toEqual([26, 33]);
    // The original keeps its own list: a shared array would have grown too.
    expect(added.draft.series[0].events[0].audioIds).toEqual([26]);
  });

  it('deletes one, and forgets it was collapsed or had events selected', () => {
    const gone = run(
      base,
      { type: 'toggleCollapsed', key: base.draft.series[1].key },
      { type: 'selectAllEvents' },
      { type: 'removeSeries', series: 1 },
    );

    expect(seriesNames(gone)).toEqual(['A', 'C']);
    expect(gone.collapsed).toEqual([]);
    expect(gone.selection).toHaveLength(2);
  });

  it('collapses and expands every series at once', () => {
    const collapsed = editorReducer(base, { type: 'setAllCollapsed', collapsed: true });

    expect(collapsed.collapsed).toEqual(base.draft.series.map((series) => series.key));
    expect(editorReducer(collapsed, { type: 'setAllCollapsed', collapsed: false }).collapsed).toEqual([]);
  });
});

describe('event operations', () => {
  const base = createEditorState({
    ...PROGRAM_FALT_TRANING,
    series: [
      {
        name: 'A',
        optional: false,
        events: [
          { duration: 1000, command: 'hide' },
          { duration: 2000, command: 'show', audio_ids: [26, 33] },
          { duration: 3000 },
        ],
      },
    ],
  });

  it('reorders inside the series it belongs to', () => {
    expect(durations(editorReducer(base, { type: 'moveEvent', series: 0, from: 0, to: 2 }))).toEqual([
      '2000',
      '3000',
      '1000',
    ]);
  });

  it('duplicates one directly after itself, audio and all', () => {
    const copied = editorReducer(base, { type: 'duplicateEvent', series: 0, event: 1 });

    expect(durations(copied)).toEqual(['1000', '2000', '2000', '3000']);
    expect(copied.draft.series[0].events[2].audioIds).toEqual([26, 33]);
    // A copied list, not the same one: pushing a clip onto the copy must not
    // append it to the original.
    expect(copied.draft.series[0].events[2].audioIds).not.toBe(copied.draft.series[0].events[1].audioIds);
  });

  it('appends a new event with the default duration and no command', () => {
    const added = editorReducer(base, { type: 'addEvent', series: 0 });

    expect(durations(added)).toEqual(['1000', '2000', '3000', '1000']);
    expect(added.draft.series[0].events[3].command).toBe('none');
  });

  it('keeps the duration as typed, and reports it as milliseconds only when it is a number', () => {
    const typed = run(
      base,
      { type: 'setEventDuration', series: 0, event: 0, value: '' },
      { type: 'setEventDuration', series: 0, event: 1, value: '12x' },
    );

    expect(durationMs(typed.draft.series[0].events[0])).toBeNull();
    expect(durationMs(typed.draft.series[0].events[1])).toBeNull();
    expect(durationMs(typed.draft.series[0].events[2])).toBe(3000);
    // The series total counts what it can, so the header does not read NaN.
    expect(seriesMs(typed.draft.series[0])).toBe(3000);
  });

  it('holds each clip once, in the order they were added, and reorders them', () => {
    const withAudio = run(
      createEditorState(null),
      { type: 'addAudio', series: 0, event: 0, audioId: 26 },
      { type: 'addAudio', series: 0, event: 0, audioId: 33 },
      { type: 'addAudio', series: 0, event: 0, audioId: 26 },
    );

    expect(withAudio.draft.series[0].events[0].audioIds).toEqual([26, 33]);
    expect(
      editorReducer(withAudio, { type: 'moveAudio', series: 0, event: 0, from: 1, to: 0 }).draft.series[0].events[0]
        .audioIds,
    ).toEqual([33, 26]);
    expect(
      editorReducer(withAudio, { type: 'removeAudio', series: 0, event: 0, index: 0 }).draft.series[0].events[0]
        .audioIds,
    ).toEqual([33]);
  });
});

describe('selection across series', () => {
  const base = createEditorState({
    ...PROGRAM_FALT_TRANING,
    series: [
      { name: 'A', optional: false, events: [{ duration: 1000 }, { duration: 2000 }] },
      { name: 'B', optional: false, events: [{ duration: 3000 }] },
    ],
  });

  it('deletes every ticked event wherever it lives, and keeps the series', () => {
    const first = base.draft.series[0].events[0].key;
    const last = base.draft.series[1].events[0].key;

    const pruned = run(
      base,
      { type: 'toggleSelected', key: first },
      { type: 'toggleSelected', key: last },
      { type: 'removeSelected' },
    );

    expect(durations(pruned, 0)).toEqual(['2000']);
    // Emptied, not removed: an empty series is a save-time error the author is
    // told about, not a name deleted on their behalf.
    expect(pruned.draft.series[1].events).toEqual([]);
    expect(pruned.selection).toEqual([]);
  });

  it('ticks only the events on screen, and unticks the ones a collapse hides', () => {
    const collapsedFirst = editorReducer(base, { type: 'toggleCollapsed', key: base.draft.series[0].key });

    // "Select all events" cannot reach into a collapsed series: "Delete
    // selected" would then take rows the author never saw.
    const selected = editorReducer(collapsedFirst, { type: 'selectAllEvents' });
    expect(selected.selection).toEqual([base.draft.series[1].events[0].key]);

    // And collapsing after selecting gives the same guarantee.
    const thenCollapsed = run(
      base,
      { type: 'selectAllEvents' },
      { type: 'toggleCollapsed', key: base.draft.series[1].key },
    );
    expect(thenCollapsed.selection).toEqual(base.draft.series[0].events.map((event) => event.key));

    expect(run(base, { type: 'selectAllEvents' }, { type: 'setAllCollapsed', collapsed: true }).selection).toEqual([]);
  });

  it('unticks an event that is deleted on its own', () => {
    const key = base.draft.series[0].events[1].key;
    const gone = run(base, { type: 'toggleSelected', key }, { type: 'removeEvent', series: 0, event: 1 });

    expect(gone.selection).toEqual([]);
  });
});

describe('the document the draft emits', () => {
  it('omits a command of "no change" and an empty clip list', () => {
    const state = run(
      createEditorState(null),
      { type: 'setTitle', value: 'Ny' },
      { type: 'setSeriesName', series: 0, value: 'Serie 1' },
    );

    expect(toDocument(state.draft)).toEqual({
      title: 'Ny',
      description: '',
      series: [{ name: 'Serie 1', optional: false, events: [{ duration: 1000 }] }],
    });
  });

  it('passes a duration that is not a number through as typed, for the validator to explain', () => {
    const state = editorReducer(createEditorState(PROGRAM_FALT_TRANING), {
      type: 'setEventDuration',
      series: 0,
      event: 0,
      value: 'x',
    });
    const result = parseProgramDocument(toJson(state.draft));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].path).toBe('/series/0/events/0/duration');
      expect(result.errors[0].message).toContain('whole number');
    }
  });

  it('keeps every event in the preview while its duration is being retyped', () => {
    const state = editorReducer(createEditorState(null), { type: 'setEventDuration', series: 0, event: 0, value: '' });

    expect(toPreviewProgram(state.draft).series[0].events).toEqual([{ duration: 0 }]);
  });
});

describe('what the validator says about a draft on its way out', () => {
  it('accepts a finished program unchanged', () => {
    const state = createEditorState(PROGRAM_FALT_TRANING);
    const result = parseProgramDocument(toJson(state.draft));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
      expect(authoringIssues(result.program)).toEqual([]);
      // The whole point of the round trip: what goes to the device is what the
      // program was, minus the fields the device assigns.
      expect(result.program.series).toEqual(PROGRAM_FALT_TRANING.series);
    }
  });

  it('warns rather than refuses when the device would clamp a duration', () => {
    const state = editorReducer(createEditorState(PROGRAM_FALT_TRANING), {
      type: 'setEventDuration',
      series: 0,
      event: 0,
      value: '0',
    });
    const result = parseProgramDocument(toJson(state.draft));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.map((warning) => warning.message)).toEqual([
        '0 ms is outside 1…3600000; the device will store it as 1 ms.',
      ]);
      expect(result.program.series[0].events[0].duration).toBe(1);
    }
  });

  it('counts only the authoring problems this session introduced', () => {
    const stored: Program = {
      id: 140,
      title: 'Stored',
      description: '',
      readonly: false,
      series: [{ name: 'Tom', optional: false, events: [] }],
    };
    const before = authoringIssues(stored);

    // A description-only edit: the same problem, still there, still not ours.
    // The device took this document once and will take it again, so refusing
    // it would make a stored program uneditable.
    expect(authoringRegressions(before, authoringIssues({ ...stored, description: 'Ny text' }))).toEqual([]);

    // A second empty series is this session's doing, and is refused.
    const worse = authoringIssues({
      ...stored,
      series: [...stored.series, { name: 'Också tom', optional: false, events: [] }],
    });
    expect(authoringRegressions(before, worse)).toHaveLength(2);

    // A different kind of problem is a regression even when the count of the
    // first kind has not moved.
    const unnamed = authoringIssues({ ...stored, series: [{ name: '', optional: false, events: [] }] });
    expect(authoringRegressions(before, unnamed).map((issue) => issue.kind)).toEqual(['unnamed-series']);
  });

  it('refuses an unnamed or empty series, which the device itself would accept', () => {
    const program: Program = {
      id: 0,
      title: 'Ny',
      description: '',
      readonly: false,
      series: [
        { name: '  ', optional: false, events: [{ duration: 1000 }] },
        { name: 'Tom', optional: false, events: [] },
      ],
    };

    expect(authoringIssues(program).map((issue) => issue.path)).toEqual(['/series/0/name', '/series/1/events']);
  });
});

describe('the timer anchor in the editor (#196)', () => {
  const anchoredProgram: Program = {
    id: 1,
    title: 'Anchored',
    description: '',
    readonly: false,
    series: [
      {
        name: 'Serie 1',
        optional: false,
        timer_start_index: 2,
        events: [
          { duration: 5000, command: 'show' },
          { duration: 60000, command: 'show' },
          { duration: 10000, command: 'show' },
        ],
      },
    ],
  };

  // The editor used to drop the field entirely: open an anchored program in
  // the form, save, and the anchor was gone with nothing said.
  it('round-trips an anchor through the form', () => {
    const state = createEditorState(anchoredProgram);
    expect(toDocument(state.draft)).toMatchObject({
      series: [{ timer_start_index: 2 }],
    });
  });

  // The whole reason the draft holds a key rather than an index.
  it('keeps the anchor on its own event when the events are reordered', () => {
    let state = createEditorState(anchoredProgram);
    // Dragged to the top, the anchor is still on the same event - and an
    // anchor at index 0 is the absent case, so the document says nothing.
    state = editorReducer(state, { type: 'moveEvent', series: 0, from: 2, to: 0 });
    expect(toDocument(state.draft).series).toEqual([
      expect.not.objectContaining({ timer_start_index: expect.anything() }),
    ]);

    state = editorReducer(state, { type: 'moveEvent', series: 0, from: 0, to: 2 });
    expect(toDocument(state.draft)).toMatchObject({ series: [{ timer_start_index: 2 }] });
  });

  it('follows the anchored event when an earlier one is deleted', () => {
    let state = createEditorState(anchoredProgram);
    state = editorReducer(state, { type: 'removeEvent', series: 0, event: 0 });
    expect(toDocument(state.draft)).toMatchObject({ series: [{ timer_start_index: 1 }] });
  });

  // Degrades to "starts with the series" rather than pointing at whichever
  // event inherited the position.
  it('drops the anchor when the event it named is deleted', () => {
    let state = createEditorState(anchoredProgram);
    state = editorReducer(state, { type: 'removeEvent', series: 0, event: 2 });
    expect(toDocument(state.draft).series).toEqual([
      expect.not.objectContaining({ timer_start_index: expect.anything() }),
    ]);
  });

  it('sets and clears the anchor from the event control', () => {
    let state = createEditorState(anchoredProgram);
    const firstEventKey = state.draft.series[0].events[0].key;

    state = editorReducer(state, { type: 'setSeriesTimerStart', series: 0, eventKey: firstEventKey });
    // Index 0 is the absent case, so naming the first event emits nothing.
    expect(toDocument(state.draft).series).toEqual([
      expect.not.objectContaining({ timer_start_index: expect.anything() }),
    ]);

    const lastEventKey = state.draft.series[0].events[2].key;
    state = editorReducer(state, { type: 'setSeriesTimerStart', series: 0, eventKey: lastEventKey });
    expect(toDocument(state.draft)).toMatchObject({ series: [{ timer_start_index: 2 }] });

    state = editorReducer(state, { type: 'setSeriesTimerStart', series: 0, eventKey: null });
    expect(toDocument(state.draft).series).toEqual([
      expect.not.objectContaining({ timer_start_index: expect.anything() }),
    ]);
  });

  it('carries the anchor into a duplicated series, by position', () => {
    let state = createEditorState(anchoredProgram);
    state = editorReducer(state, { type: 'duplicateSeries', series: 0 });
    expect(toDocument(state.draft)).toMatchObject({
      series: [{ timer_start_index: 2 }, { timer_start_index: 2 }],
    });
  });
});

describe('target banks', () => {
  const BANKED: Program = {
    id: 41,
    title: 'Banked',
    description: '',
    readonly: false,
    series: [
      {
        name: 'S',
        optional: false,
        events: [
          { duration: 4000, command: 'hide', banks: { B: 'show' } },
          { duration: 4000, command: 'hide', banks: { D: 'show' } },
        ],
      },
    ],
  };

  const eventBanks = (state: EditorState, index = 0) => state.draft.series[0].events[index].banks;

  it('opens at the banks the document needs, and at one for a new program', () => {
    expect(createEditorState(BANKED).bankCount).toBe(4);
    expect(createEditorState(PROGRAM_FALT_TRANING).bankCount).toBe(1);
    expect(createEditorState(null).bankCount).toBe(1);
  });

  it('sets and clears one bank without touching the others', () => {
    const state = run(
      createEditorState(BANKED),
      { type: 'setEventBankOverride', series: 0, event: 0, letter: 'C', value: 'hide' },
      { type: 'setEventBankOverride', series: 0, event: 0, letter: 'B', value: null },
    );
    expect(eventBanks(state)).toEqual({ C: 'hide' });
  });

  it('keys the document in letter order however the buttons were pressed', () => {
    const state = run(
      createEditorState(BANKED),
      { type: 'setEventBankOverride', series: 0, event: 0, letter: 'D', value: 'hide' },
      { type: 'setEventBankOverride', series: 0, event: 0, letter: 'A', value: 'show' },
    );
    const event = (toDocument(state.draft).series as { events: { banks: object }[] }[])[0].events[0];
    expect(Object.keys(event.banks)).toEqual(['A', 'B', 'D']);
  });

  it('omits banks from the document when the event names none', () => {
    const state = run(createEditorState(BANKED), {
      type: 'setEventBankOverride',
      series: 0,
      event: 0,
      letter: 'B',
      value: null,
    });
    const event = (toDocument(state.draft).series as { events: Record<string, unknown>[] }[])[0].events[0];
    expect(event).not.toHaveProperty('banks');
    expect(toPreviewProgram(state.draft).series[0].events[0].banks).toBeUndefined();
  });

  it('drops the overrides above the count when the stepper is lowered', () => {
    const state = run(createEditorState(BANKED), { type: 'setBankCount', value: 2 });
    expect(state.bankCount).toBe(2);
    expect(eventBanks(state, 0)).toEqual({ B: 'show' });
    expect(eventBanks(state, 1)).toEqual({});
    // Dropping an override changes the document, so the session is dirty.
    expect(isDirty(state)).toBe(true);
  });

  it('is not an edit to widen the stepper', () => {
    expect(isDirty(run(createEditorState(BANKED), { type: 'setBankCount', value: 8 }))).toBe(false);
  });

  it('clamps the stepper to 1…8', () => {
    const state = createEditorState(BANKED);
    expect(run(state, { type: 'setBankCount', value: 0 }).bankCount).toBe(1);
    expect(run(state, { type: 'setBankCount', value: 99 }).bankCount).toBe(8);
  });

  it('never narrows below what a replacement document needs', () => {
    const state = run(createEditorState(PROGRAM_FALT_TRANING), { type: 'replaceDocument', program: BANKED });
    expect(state.bankCount).toBe(4);
  });

  it('round-trips a banked document through the JSON view unchanged', () => {
    const result = parseProgramDocument(toJson(createEditorState(BANKED).draft));
    if (!result.ok) throw new Error('the validator refused the editor’s own output');
    expect(result.program.series).toEqual(BANKED.series);
  });
});

describe('describeEvent', () => {
  const event = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
    key: 'k1',
    duration: '4000',
    command: 'hide',
    banks: {},
    audioIds: [],
    ...patch,
  });

  it('says what one bank does, without mentioning banks', () => {
    expect(describeEvent(event(), 1)).toBe('Hide for 4 s.');
    expect(describeEvent(event({ command: 'none' }), 1)).toBe('Leave the targets where they are for 4 s.');
  });

  it('separates the exceptions from the baseline', () => {
    expect(describeEvent(event({ banks: { B: 'show' } }), 4)).toBe('On entry: show B; hide A, C, D. Hold 4 s.');
  });

  it('says the rest are left alone when there is no baseline', () => {
    expect(describeEvent(event({ command: 'none', banks: { A: 'show' } }), 3)).toBe(
      'On entry: show A; leave B, C as they are. Hold 4 s.',
    );
  });

  it('does not invent a duration while one is being typed', () => {
    expect(describeEvent(event({ duration: '' }), 2)).toContain('Hold its duration.');
  });
});
