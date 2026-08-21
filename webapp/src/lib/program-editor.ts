/**
 * The document an editing session works on, and every operation over it.
 *
 * Kept out of the component so the operations can be tested without a DOM, and
 * so there is one place where "what the editor is holding" is defined. The
 * legacy editor kept this in a module-level object mutated in place by ~900
 * lines of listeners, with two `window` flags guarding against double-attached
 * handlers; a reducer removes that whole class of bug.
 *
 * Two things the draft deliberately does not mirror from `Program`:
 *
 * - **No `id`, no `readonly`.** The device owns both — `POST` assigns the id
 *   and ignores the document's, `PUT` takes it from the path, and `readonly`
 *   follows from where the file is stored. Offering either as a field, as the
 *   legacy Form tab did, is offering a control that does nothing.
 * - **`duration` is the text the user typed**, not a number. A numeric field
 *   that cannot hold "" cannot be cleared and retyped, and a half-typed value
 *   is not an error yet. Text also means a nonsense duration reaches
 *   `parseProgramDocument` as a nonsense duration and is reported by the same
 *   validator as every other problem, rather than being silently coerced here.
 */
import type { Event, Program, Series } from '../api/types';

/** The three-way `command` control: the device's `show`, `hide`, or no key at all. */
export type DraftCommand = 'show' | 'hide' | 'none';

export interface DraftEvent {
  /** Stable across reorders, so a React list keyed by it keeps input focus. */
  key: string;
  /** Milliseconds, as typed. See the note above. */
  duration: string;
  command: DraftCommand;
  audioIds: number[];
}

export interface DraftSeries {
  key: string;
  name: string;
  optional: boolean;
  events: DraftEvent[];
}

export interface Draft {
  title: string;
  description: string;
  series: DraftSeries[];
}

export interface EditorState {
  draft: Draft;
  /** Keys of the series drawn collapsed. */
  collapsed: string[];
  /** Keys of the events ticked for a batch delete (the legacy Events view). */
  selection: string[];
  /** Source of the next key. Part of the state so the reducer stays pure. */
  nextKey: number;
  /**
   * `toJson` of the document as it was loaded or last saved. `isDirty`
   * compares against it, so typing a change back to what it was is not dirty.
   */
  baseline: string;
}

/** What a new event starts as. The legacy editor's `createEmptyEvent`. */
const NEW_EVENT_DURATION = '1000';

export type EditorAction =
  | { type: 'setTitle'; value: string }
  | { type: 'setDescription'; value: string }
  | { type: 'addSeries' }
  | { type: 'setSeriesName'; series: number; value: string }
  | { type: 'setSeriesOptional'; series: number; value: boolean }
  | { type: 'moveSeries'; from: number; to: number }
  | { type: 'duplicateSeries'; series: number }
  | { type: 'removeSeries'; series: number }
  | { type: 'toggleCollapsed'; key: string }
  | { type: 'setAllCollapsed'; collapsed: boolean }
  | { type: 'addEvent'; series: number }
  | { type: 'setEventDuration'; series: number; event: number; value: string }
  | { type: 'setEventCommand'; series: number; event: number; value: DraftCommand }
  | { type: 'moveEvent'; series: number; from: number; to: number }
  | { type: 'duplicateEvent'; series: number; event: number }
  | { type: 'removeEvent'; series: number; event: number }
  | { type: 'addAudio'; series: number; event: number; audioId: number }
  | { type: 'removeAudio'; series: number; event: number; index: number }
  | { type: 'moveAudio'; series: number; event: number; from: number; to: number }
  | { type: 'toggleSelected'; key: string }
  | { type: 'selectAllEvents' }
  | { type: 'clearSelection' }
  | { type: 'removeSelected' }
  /** The JSON view, or a save, replacing the whole document. */
  | { type: 'replaceDocument'; program: Program }
  /** Stored on the device: the draft becomes what the device kept, and is clean. */
  | { type: 'saved'; program: Program };

// --- Serialisation ---

/**
 * The draft as a program document, in the shape the device emits: no `id`, no
 * `readonly`, `command` and `audio_ids` present only when they carry something.
 *
 * Deliberately `unknown`-valued: a duration the user is midway through typing
 * is not a number, and hiding that behind a `Program` cast would put the lie
 * one layer further from where it is caught.
 */
export function toDocument(draft: Draft): Record<string, unknown> {
  return {
    title: draft.title,
    description: draft.description,
    series: draft.series.map((series) => ({
      name: series.name,
      optional: series.optional,
      events: series.events.map((event) => {
        const duration = parseDuration(event.duration);
        return {
          ...(duration === undefined ? {} : { duration }),
          ...(event.command === 'none' ? {} : { command: event.command }),
          ...(event.audioIds.length > 0 ? { audio_ids: [...event.audioIds] } : {}),
        };
      }),
    })),
  };
}

export function toJson(draft: Draft): string {
  return JSON.stringify(toDocument(draft), null, 2);
}

/**
 * A typed duration as the document should carry it: a number when it is one,
 * the text itself when it is not (so the validator can say what is wrong with
 * it), and absent when the field is empty.
 */
function parseDuration(text: string): number | string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

/** Milliseconds for a total or a preview, or `null` while the field is not a number. */
export function durationMs(event: DraftEvent): number | null {
  const parsed = parseDuration(event.duration);
  return typeof parsed === 'number' ? parsed : null;
}

/** Milliseconds a series takes, counting only the events that carry a number. */
export function seriesMs(series: DraftSeries): number {
  return series.events.reduce((total, event) => total + (durationMs(event) ?? 0), 0);
}

/**
 * A `Program` for the read-only timeline preview. Unparseable durations become
 * 0 rather than dropping the event, so a block does not vanish from the preview
 * while its duration is being retyped.
 */
export function toPreviewProgram(draft: Draft): Program {
  return {
    id: 0,
    title: draft.title,
    description: draft.description,
    readonly: false,
    series: draft.series.map((series) => ({
      name: series.name,
      optional: series.optional,
      events: series.events.map((event): Event => {
        const ms = durationMs(event);
        return {
          duration: ms === null || ms < 0 ? 0 : ms,
          ...(event.command === 'none' ? {} : { command: event.command }),
          ...(event.audioIds.length > 0 ? { audio_ids: [...event.audioIds] } : {}),
        };
      }),
    })),
  };
}

// --- Construction ---

function keysFor(count: number, from: number): string[] {
  return Array.from({ length: count }, (_, index) => `k${from + index}`);
}

function draftFromProgram(program: Program | null, from: number): { draft: Draft; nextKey: number } {
  let nextKey = from;
  const key = (): string => `k${nextKey++}`;

  const draft: Draft = {
    title: program?.title ?? '',
    description: program?.description ?? '',
    series: (program?.series ?? []).map((series: Series) => ({
      key: key(),
      name: series.name,
      optional: series.optional === true,
      events: series.events.map((event: Event) => ({
        key: key(),
        duration: String(event.duration),
        command: event.command === 'show' || event.command === 'hide' ? event.command : 'none',
        audioIds: [...(event.audio_ids ?? [])],
      })),
    })),
  };

  return { draft, nextKey };
}

/**
 * A session over `program`, or over an empty document when creating.
 *
 * A new program starts with one named-blank series holding one event: the
 * empty document the legacy editor opened with needed two clicks before
 * anything could be typed, and every program has at least one series anyway.
 */
export function createEditorState(program: Program | null): EditorState {
  const seeded = draftFromProgram(program, 1);
  let { draft, nextKey } = seeded;

  if (draft.series.length === 0) {
    const [seriesKey, eventKey] = keysFor(2, nextKey);
    nextKey += 2;
    draft = {
      ...draft,
      series: [
        {
          key: seriesKey,
          name: '',
          optional: false,
          events: [{ key: eventKey, duration: NEW_EVENT_DURATION, command: 'none', audioIds: [] }],
        },
      ],
    };
  }

  return { draft, collapsed: [], selection: [], nextKey, baseline: toJson(draft) };
}

export function isDirty(state: EditorState): boolean {
  return toJson(state.draft) !== state.baseline;
}

// --- Operations ---

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Apply `change` to one series, leaving the rest untouched. */
function withSeries(draft: Draft, index: number, change: (series: DraftSeries) => DraftSeries): Draft {
  if (index < 0 || index >= draft.series.length) return draft;
  return { ...draft, series: draft.series.map((series, i) => (i === index ? change(series) : series)) };
}

function withEvent(
  draft: Draft,
  seriesIndex: number,
  eventIndex: number,
  change: (event: DraftEvent) => DraftEvent,
): Draft {
  return withSeries(draft, seriesIndex, (series) => {
    if (eventIndex < 0 || eventIndex >= series.events.length) return series;
    return { ...series, events: series.events.map((event, i) => (i === eventIndex ? change(event) : event)) };
  });
}

/** Every event key in the series that are not collapsed. */
function visibleEventKeys(draft: Draft, collapsed: readonly string[]): string[] {
  const hidden = new Set(collapsed);
  return draft.series
    .filter((series) => !hidden.has(series.key))
    .flatMap((series) => series.events.map((event) => event.key));
}

/**
 * Drop the selected events that live in a series being collapsed.
 *
 * The selection exists to be batch-deleted, and a tick the author cannot see
 * is a row "Delete selected" would take without showing them what it took.
 */
function selectionWithin(draft: Draft, selection: readonly string[], collapsed: readonly string[]): string[] {
  const visible = new Set(visibleEventKeys(draft, collapsed));
  return selection.filter((key) => visible.has(key));
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { draft } = state;

  switch (action.type) {
    case 'setTitle':
      return { ...state, draft: { ...draft, title: action.value } };

    case 'setDescription':
      return { ...state, draft: { ...draft, description: action.value } };

    case 'addSeries': {
      const [seriesKey, eventKey] = keysFor(2, state.nextKey);
      return {
        ...state,
        nextKey: state.nextKey + 2,
        draft: {
          ...draft,
          series: [
            ...draft.series,
            {
              key: seriesKey,
              name: '',
              optional: false,
              events: [{ key: eventKey, duration: NEW_EVENT_DURATION, command: 'none', audioIds: [] }],
            },
          ],
        },
      };
    }

    case 'setSeriesName':
      return { ...state, draft: withSeries(draft, action.series, (series) => ({ ...series, name: action.value })) };

    case 'setSeriesOptional':
      return { ...state, draft: withSeries(draft, action.series, (series) => ({ ...series, optional: action.value })) };

    case 'moveSeries':
      return { ...state, draft: { ...draft, series: move(draft.series, action.from, action.to) } };

    case 'duplicateSeries': {
      const source = draft.series[action.series];
      if (!source) return state;
      let nextKey = state.nextKey;
      const copy: DraftSeries = {
        key: `k${nextKey++}`,
        name: source.name === '' ? '' : `${source.name} (copy)`,
        optional: source.optional,
        events: source.events.map((event) => ({ ...event, key: `k${nextKey++}`, audioIds: [...event.audioIds] })),
      };
      const series = [...draft.series];
      series.splice(action.series + 1, 0, copy);
      return { ...state, nextKey, draft: { ...draft, series } };
    }

    case 'removeSeries': {
      const gone = draft.series[action.series];
      if (!gone) return state;
      const goneEvents = new Set(gone.events.map((event) => event.key));
      return {
        ...state,
        draft: { ...draft, series: draft.series.filter((_, index) => index !== action.series) },
        collapsed: state.collapsed.filter((key) => key !== gone.key),
        selection: state.selection.filter((key) => !goneEvents.has(key)),
      };
    }

    case 'toggleCollapsed': {
      const collapsed = state.collapsed.includes(action.key)
        ? state.collapsed.filter((key) => key !== action.key)
        : [...state.collapsed, action.key];
      return { ...state, collapsed, selection: selectionWithin(draft, state.selection, collapsed) };
    }

    case 'setAllCollapsed': {
      const collapsed = action.collapsed ? draft.series.map((series) => series.key) : [];
      return { ...state, collapsed, selection: selectionWithin(draft, state.selection, collapsed) };
    }

    case 'addEvent': {
      const key = `k${state.nextKey}`;
      return {
        ...state,
        nextKey: state.nextKey + 1,
        draft: withSeries(draft, action.series, (series) => ({
          ...series,
          events: [...series.events, { key, duration: NEW_EVENT_DURATION, command: 'none', audioIds: [] }],
        })),
      };
    }

    case 'setEventDuration':
      return {
        ...state,
        draft: withEvent(draft, action.series, action.event, (event) => ({ ...event, duration: action.value })),
      };

    case 'setEventCommand':
      return {
        ...state,
        draft: withEvent(draft, action.series, action.event, (event) => ({ ...event, command: action.value })),
      };

    case 'moveEvent':
      return {
        ...state,
        draft: withSeries(draft, action.series, (series) => ({
          ...series,
          events: move(series.events, action.from, action.to),
        })),
      };

    case 'duplicateEvent': {
      const series = draft.series[action.series];
      const source = series?.events[action.event];
      if (!source) return state;
      const copy: DraftEvent = { ...source, key: `k${state.nextKey}`, audioIds: [...source.audioIds] };
      const events = [...series.events];
      events.splice(action.event + 1, 0, copy);
      return {
        ...state,
        nextKey: state.nextKey + 1,
        draft: withSeries(draft, action.series, (current) => ({ ...current, events })),
      };
    }

    case 'removeEvent': {
      const gone = draft.series[action.series]?.events[action.event];
      if (!gone) return state;
      return {
        ...state,
        draft: withSeries(draft, action.series, (series) => ({
          ...series,
          events: series.events.filter((_, index) => index !== action.event),
        })),
        selection: state.selection.filter((key) => key !== gone.key),
      };
    }

    case 'addAudio':
      return {
        ...state,
        draft: withEvent(draft, action.series, action.event, (event) =>
          // The device plays a clip once per listing, so the same id twice is
          // meaningless rather than louder.
          event.audioIds.includes(action.audioId) ? event : { ...event, audioIds: [...event.audioIds, action.audioId] },
        ),
      };

    case 'removeAudio':
      return {
        ...state,
        draft: withEvent(draft, action.series, action.event, (event) => ({
          ...event,
          audioIds: event.audioIds.filter((_, index) => index !== action.index),
        })),
      };

    case 'moveAudio':
      return {
        ...state,
        draft: withEvent(draft, action.series, action.event, (event) => ({
          ...event,
          audioIds: move(event.audioIds, action.from, action.to),
        })),
      };

    case 'toggleSelected':
      return {
        ...state,
        selection: state.selection.includes(action.key)
          ? state.selection.filter((key) => key !== action.key)
          : [...state.selection, action.key],
      };

    case 'selectAllEvents':
      return { ...state, selection: visibleEventKeys(draft, state.collapsed) };

    case 'clearSelection':
      return { ...state, selection: [] };

    case 'removeSelected': {
      if (state.selection.length === 0) return state;
      const selected = new Set(state.selection);
      // Series are kept even when every event in one is deleted: an empty
      // series is a save-time error the user is told about, and removing it
      // for them would delete a name they did not ask to lose.
      const series = draft.series.map((entry) => ({
        ...entry,
        events: entry.events.filter((event) => !selected.has(event.key)),
      }));
      return { ...state, draft: { ...draft, series }, selection: [] };
    }

    case 'replaceDocument': {
      const { draft: replaced, nextKey } = draftFromProgram(action.program, state.nextKey);
      return { ...state, draft: replaced, nextKey, collapsed: [], selection: [] };
    }

    case 'saved': {
      const { draft: stored, nextKey } = draftFromProgram(action.program, state.nextKey);
      return { draft: stored, nextKey, collapsed: [], selection: [], baseline: toJson(stored) };
    }
  }
}
