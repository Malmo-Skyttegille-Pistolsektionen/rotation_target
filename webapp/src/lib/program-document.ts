/**
 * Reading a program document out of a file the user picked.
 *
 * The legacy editor checked the file with ajv against
 * `contracts/program.schema.json`; this does the job by hand, for two reasons.
 * Ajv plus its schema fetch is ~30 KB gz of runtime for a check a club member
 * runs once in a while, and ajv's messages ("must have required property
 * 'name'", instancePath `/series/2/events/0`) say nothing about what the device
 * will do with the file.
 *
 * **The reference is `rt::parse_program` in
 * `firmware/lib/rt_logic/program.cpp`, not the schema** — what the device does
 * with a document is what the user needs told. Deliberate departures from
 * `contracts/program.schema.json` follow from that; the three that shape the
 * most files:
 *
 * - The schema sets `additionalProperties: false` and rejects an unknown field.
 *   The firmware ignores it and drops it on rewrite, so this warns and drops.
 * - The schema requires all of `id`, `title`, `description`, `readonly`,
 *   `series`. The firmware defaults every one of them, and only `title` and
 *   `series` produce anything runnable, so only those two are required here.
 * - The schema allows `duration: 0` (`minimum: 0`). The firmware clamps to
 *   1…3600000 ms, so this warns and clamps to the value that will be stored.
 *
 * The complete list is `DIVERGENCES` in `test/program-document-schema.test.ts`,
 * each entry naming the `program.cpp` behaviour that justifies it. That test
 * runs both descriptions over every shipped program and a table of hostile
 * inputs, and fails on a divergence nobody wrote down (D-18).
 *
 * `command` used to be a departure the other way — stricter than the device.
 * PR #80 closed that: the firmware now refuses anything but `show`, `hide`,
 * absent, `null` and `""`, which is what the schema's enum already said. This
 * file keeps refusing `null` and `""` too, because at authoring time they are a
 * half-written event worth a message, not the "no command" the device reads.
 */
import type { Event, Program, Series } from '../api/types';

/** Per-event clamp `rt::parse_event` applies (`kMinEventMs` / `kMaxEventMs`). */
export const MIN_EVENT_DURATION_MS = 1;
export const MAX_EVENT_DURATION_MS = 3_600_000;

export interface DocumentIssue {
  /** Where in the document, in the JSON-pointer-ish form the schema uses. */
  path: string;
  message: string;
}

export type ProgramDocumentResult =
  | {
      ok: true;
      /** The document as the device will store it: unknown fields dropped, durations clamped. */
      program: Program;
      /**
       * The `id` the file declared, if any. Not authoritative anywhere — `POST`
       * ignores it and `PUT` rejects a mismatch — but the caller has to know it
       * to say so.
       */
      declaredId: number | null;
      /** Accepted, but the device will not store it the way the file says. */
      warnings: DocumentIssue[];
    }
  | { ok: false; errors: DocumentIssue[] };

const KNOWN_PROGRAM_KEYS = ['id', 'title', 'description', 'readonly', 'series'];
const KNOWN_SERIES_KEYS = ['name', 'optional', 'events'];
const KNOWN_EVENT_KEYS = ['duration', 'command', 'audio_ids'];

/**
 * API v1 fields `program.schema.json` still accepts so v1-era files validate.
 * The v2 firmware does not parse either, and silently dropping them changes
 * what the program does — which is the whole reason to say so.
 */
const V1_EVENT_KEYS: Record<string, string> = {
  target_system:
    'API v1 only, and not parsed by this firmware: the event will affect every target system, not the listed ones.',
  start: 'API v1 only, and not parsed by this firmware: a series always starts at its first event.',
};

/** ArduinoJson keeps an audio id only if it fits `int32_t`; the rest go silently. */
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

interface Collector {
  errors: DocumentIssue[];
  warnings: DocumentIssue[];
}

function unknownKeys(
  collector: Collector,
  path: string,
  value: Record<string, unknown>,
  known: string[],
  named: Record<string, string> = {},
): void {
  for (const key of Object.keys(value)) {
    if (known.includes(key)) continue;
    collector.warnings.push({
      path: `${path}/${key}`,
      message: named[key] ?? 'Not part of a program; the device will drop it.',
    });
  }
}

function parseEvent(collector: Collector, path: string, raw: unknown): Event | null {
  if (!isPlainObject(raw)) {
    collector.errors.push({ path, message: `An event must be an object, but this is ${describe(raw)}.` });
    return null;
  }

  unknownKeys(collector, path, raw, KNOWN_EVENT_KEYS, V1_EVENT_KEYS);

  if (!isInteger(raw.duration)) {
    collector.errors.push({
      path: `${path}/duration`,
      message:
        raw.duration === undefined
          ? 'Every event needs a duration, in milliseconds (1000 = one second).'
          : `Duration must be a whole number of milliseconds, but this is ${describe(raw.duration)}.`,
    });
    return null;
  }

  let duration = raw.duration;
  if (duration < MIN_EVENT_DURATION_MS || duration > MAX_EVENT_DURATION_MS) {
    const clamped = Math.min(Math.max(duration, MIN_EVENT_DURATION_MS), MAX_EVENT_DURATION_MS);
    collector.warnings.push({
      path: `${path}/duration`,
      message: `${duration} ms is outside 1…3600000; the device will store it as ${clamped} ms.`,
    });
    duration = clamped;
  }

  const event: Event = { duration };

  if (raw.command !== undefined) {
    if (raw.command !== 'show' && raw.command !== 'hide') {
      collector.errors.push({
        path: `${path}/command`,
        message: `Command must be "show" or "hide", but this is ${JSON.stringify(raw.command)}.`,
      });
      return null;
    }
    event.command = raw.command;
  }

  if (raw.audio_ids !== undefined) {
    if (!Array.isArray(raw.audio_ids) || !raw.audio_ids.every(isInteger)) {
      collector.errors.push({
        path: `${path}/audio_ids`,
        message: 'Audio ids must be a list of whole numbers.',
      });
      return null;
    }

    const ids: number[] = [];
    (raw.audio_ids as number[]).forEach((id, index) => {
      if (id < INT32_MIN || id > INT32_MAX) {
        collector.warnings.push({
          path: `${path}/audio_ids/${index}`,
          message: `${id} does not fit a 32-bit id; the device will drop it and the clip will not play.`,
        });
        return;
      }
      ids.push(id);
    });
    event.audio_ids = ids;
  }

  return event;
}

function parseSeries(collector: Collector, path: string, raw: unknown): Series | null {
  if (!isPlainObject(raw)) {
    collector.errors.push({ path, message: `A series must be an object, but this is ${describe(raw)}.` });
    return null;
  }

  unknownKeys(collector, path, raw, KNOWN_SERIES_KEYS);

  if (typeof raw.name !== 'string') {
    collector.errors.push({
      path: `${path}/name`,
      message: raw.name === undefined ? 'Every series needs a name.' : `A series name must be text.`,
    });
    return null;
  }

  if (raw.optional !== undefined && typeof raw.optional !== 'boolean') {
    collector.errors.push({ path: `${path}/optional`, message: '"optional" must be true or false.' });
    return null;
  }
  const optional = raw.optional === true;

  if (raw.events !== undefined && !Array.isArray(raw.events)) {
    collector.errors.push({
      path: `${path}/events`,
      message: `"events" must be a list, but this is ${describe(raw.events)}.`,
    });
    return null;
  }

  const events: Event[] = [];
  const rawEvents: unknown[] = Array.isArray(raw.events) ? raw.events : [];
  rawEvents.forEach((rawEvent, index) => {
    const event = parseEvent(collector, `${path}/events/${index}`, rawEvent);
    if (event) events.push(event);
  });

  return { name: raw.name, optional, events };
}

/**
 * Parse and check the text of a `.json` file the user picked.
 *
 * Errors are the ones that would make the device refuse the document or store
 * something meaningless; warnings are the places where it will store something
 * other than what the file says, which the user should see before it happens
 * rather than discover on the next boot.
 */
export function parseProgramDocument(text: string): ProgramDocumentResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      errors: [{ path: '/', message: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [{ path: '/', message: `A program must be a JSON object, but this file is ${describe(raw)}.` }],
    };
  }

  const collector: Collector = { errors: [], warnings: [] };
  unknownKeys(collector, '', raw, KNOWN_PROGRAM_KEYS);

  if (typeof raw.title !== 'string' || raw.title.length === 0) {
    collector.errors.push({ path: '/title', message: 'A program needs a title.' });
  }

  if (raw.description !== undefined && typeof raw.description !== 'string') {
    collector.errors.push({ path: '/description', message: 'The description must be text.' });
  }

  let declaredId: number | null = null;
  if (raw.id !== undefined && raw.id !== null) {
    if (!isInteger(raw.id) || raw.id < 0) {
      collector.errors.push({ path: '/id', message: 'The id must be a whole number.' });
    } else {
      declaredId = raw.id;
    }
  }

  // `readonly` follows from where the device stores the file, so a document
  // asserting it is not wrong, just ignored. A non-boolean is ignored just the
  // same, and saying so beats letting a typo look like it took effect.
  if (raw.readonly !== undefined && raw.readonly !== false) {
    collector.warnings.push({
      path: '/readonly',
      message:
        typeof raw.readonly === 'boolean'
          ? 'Read-only is decided by the device, not the file; an uploaded program is never read-only.'
          : `Read-only must be true or false, and is decided by the device anyway; ${describe(raw.readonly)} is ignored.`,
    });
  }

  if (!Array.isArray(raw.series)) {
    collector.errors.push({
      path: '/series',
      message:
        raw.series === undefined
          ? 'A program needs a "series" list.'
          : `"series" must be a list, but this is ${describe(raw.series)}.`,
    });
    return { ok: false, errors: collector.errors };
  }

  const series: Series[] = [];
  const rawSeriesList: unknown[] = raw.series;
  rawSeriesList.forEach((entry, index) => {
    const parsed = parseSeries(collector, `/series/${index}`, entry);
    if (parsed) series.push(parsed);
  });

  if (collector.errors.length > 0) {
    return { ok: false, errors: collector.errors };
  }

  if (series.length === 0) {
    return { ok: false, errors: [{ path: '/series', message: 'A program needs at least one series.' }] };
  }

  return {
    ok: true,
    declaredId,
    warnings: collector.warnings,
    program: {
      id: declaredId ?? 0,
      title: raw.title as string,
      description: (raw.description as string | undefined) ?? '',
      readonly: false,
      series,
    },
  };
}

/** Total milliseconds a program takes if every series is run once. */
export function programTotalMs(program: Program): number {
  return program.series.reduce(
    (total, series) => total + series.events.reduce((sum, event) => sum + event.duration, 0),
    0,
  );
}

/**
 * A problem that is not the device's to refuse, only an author's to fix.
 * `kind` is what makes one comparable to another: the paths carry indices, so
 * they change when a series moves, and the messages carry the index too.
 */
export interface AuthoringIssue extends DocumentIssue {
  kind: 'unnamed-series' | 'empty-series';
}

/**
 * The checks that only apply to a document someone is authoring, not to one
 * arriving as a file.
 *
 * The firmware accepts both of these — an unnamed series and a series with no
 * events parse and store fine — so `parseProgramDocument` does not refuse
 * them; a file that has them is still a file the device will hold, and
 * `POST /programs` will take one. But neither is ever what an author meant: an
 * unnamed series has nothing to show in the run view's series list, and an
 * empty one occupies a slot and takes no time. The legacy editor refused to
 * save either, and so does this — for the ones the author introduced. See
 * `authoringRegressions` for why that distinction has to exist.
 *
 * Runs on the output of `parseProgramDocument`, so the shape is already known
 * good and this only has to say what is missing.
 */
export function authoringIssues(program: Program): AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];

  program.series.forEach((series, index) => {
    if (series.name.trim().length === 0) {
      issues.push({
        kind: 'unnamed-series',
        path: `/series/${index}/name`,
        message: `Series ${index + 1} needs a name.`,
      });
    }
    if (series.events.length === 0) {
      issues.push({
        kind: 'empty-series',
        path: `/series/${index}/events`,
        message: `Series ${index + 1} ("${series.name}") has no events, so it would take no time and do nothing.`,
      });
    }
  });

  return issues;
}

/**
 * The authoring problems in `after` that `before` did not already have.
 *
 * Refusing every authoring problem outright would make a program the device is
 * holding uneditable: `POST /programs` accepts a document with an unnamed or
 * empty series — this app's own upload path does — and once one is stored,
 * opening it and correcting the *description* would be refused for a series the
 * author never touched. So the bar is a regression, not a state: what the
 * stored document already had is the author's to fix when they choose, and what
 * this session introduced is refused.
 *
 * Compared by `kind` and count rather than by path: a reorder renumbers every
 * path, and which particular series is unnamed is not the question — whether
 * there are more of them than there were is.
 */
export function authoringRegressions(before: AuthoringIssue[], after: AuthoringIssue[]): AuthoringIssue[] {
  const countOf = (issues: AuthoringIssue[], kind: AuthoringIssue['kind']): number =>
    issues.filter((issue) => issue.kind === kind).length;

  return after.filter((issue) => countOf(after, issue.kind) > countOf(before, issue.kind));
}
