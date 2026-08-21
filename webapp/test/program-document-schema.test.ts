/**
 * Cross-check: `src/lib/program-document.ts` against `contracts/program.schema.json`.
 *
 * D-18 shipped a hand-written validator instead of ajv, and named the cost:
 * the validator and the schema are two hand-maintained descriptions of one
 * document, which is the drift shape that produced the 100x `duration` bug
 * (D-01). This is the structural guard D-18 asked for.
 *
 * The two are *not* meant to agree. The validator is written against
 * `rt::parse_program` in `firmware/lib/rt_logic/program.cpp` — what the device
 * does — and the schema is stricter than the device in places, so this suite
 * asserts the divergences are exactly the reasoned set in `DIVERGENCES` below.
 * A new one fails the run until someone writes down why it exists; a removed
 * one fails until the stale entry goes.
 *
 * **ajv is used here on purpose and costs nothing shipped.** It is already a
 * devDependency (`src_legacy` uses it), this file is a test, and nothing here
 * is reachable from `src/` — so D-18's ~45 KB gz win is intact. Do not
 * "clean up" the dependency.
 */
import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';

import { parseProgramDocument } from '../src/lib/program-document';

const SCHEMA_URL = new URL('../../contracts/program.schema.json', import.meta.url);
const PROGRAMS_DIR = new URL('../../resources/programs/files/', import.meta.url);

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateAgainstSchema = ajv.compile(JSON.parse(readFileSync(SCHEMA_URL, 'utf8')));

type Verdict = 'accepted' | 'refused';

interface Divergence {
  /** What `contracts/program.schema.json` says. */
  schema: string;
  /** What `src/lib/program-document.ts` does instead. */
  validator: string;
  /** The `program.cpp` behaviour that makes the validator's choice the right one. */
  firmware: string;
}

/**
 * Every place the validator and the schema are allowed to disagree, and why.
 *
 * Adding a divergence means adding an entry here — that is the whole point of
 * this file. Each entry must be exercised by at least one case below, so an
 * entry that stops being true (the firmware tightens, the schema is fixed)
 * fails the run rather than sitting here as folklore.
 *
 * `command` is deliberately absent: the schema's enum and the validator agree
 * that only `show`/`hide` are acceptable, and since PR #80 so does
 * `parse_command` — the only daylight left is `null` and `""`, which the device
 * reads as "no command" while both descriptions here refuse them.
 */
export const DIVERGENCES = {
  'unknown-fields-dropped': {
    schema: '`additionalProperties: false` at every level; an unknown key is an error.',
    validator: 'Warns and drops the key, because the file will come back without it.',
    firmware:
      'parse_program/parse_series/parse_event read only the keys they know, and ArduinoJson re-serialises from the parsed struct, so an unknown key is gone after the first rewrite.',
  },
  'schema-required-superset': {
    schema:
      'Requires `id`, `title`, `description`, `readonly`, `series`; a series requires all of `name`, `optional`, `events`.',
    validator: 'Requires only `title` and `series` (and `name` on a series).',
    firmware:
      'Every read is `src["key"] | <default>`: a missing `id` is 0, `description` "", `optional` false, and a missing `events` yields an empty JsonArrayConst. Only `title` and `series` decide whether anything runnable comes out.',
  },
  'duration-below-min-clamped': {
    schema: '`minimum: 0` — accepts 0, refuses anything negative.',
    validator: 'Accepts both, and warns that the device will store 1 ms.',
    firmware:
      'parse_event clamps to kMinEventMs (1) rather than refusing: `duration < kMinEventMs ? kMinEventMs : ...`. The floor is 1, not 0, because locate_event() uses a half-open interval and a zero-length event could never fire its command or audio.',
  },
  'duration-above-max-clamped': {
    schema: 'No `maximum`; any integer is accepted.',
    validator: 'Accepts, and warns that the device will store 3600000 ms.',
    firmware: 'parse_event caps at kMaxEventMs (3600000) so Series::total_ms() cannot overflow the int32 it sums into.',
  },
  'audio-id-int32-range': {
    schema: '`type: integer` with no bounds.',
    validator: 'Accepts, and warns that an id outside int32 will be dropped and its clip never play.',
    firmware: 'parse_event keeps an id only `if (id.is<int32_t>())`; the rest go silently.',
  },
  'readonly-imposed-by-device': {
    schema: '`type: boolean`, required — the document states it.',
    validator: 'Accepts any value and warns that the document does not decide this.',
    firmware:
      '`out.readonly = readonly` — the parse argument, from the directory the file came out of, overwrites whatever the document said.',
  },
  'v1-keys-warned': {
    schema: 'Declares `target_system` and `start` on an Event so v1-era files still validate.',
    validator: 'Accepts and warns, because dropping them silently changes what the program does.',
    firmware:
      'parse_event reads neither, so a v1 file runs with every target system affected and the series starting at its first event regardless.',
  },
  'null-id-ignored': {
    schema: '`type: integer` refuses `null`.',
    validator: 'Treats `id: null` as no id at all.',
    firmware:
      '`*id_present = !root["id"].isNull()` — an explicit null is "absent", which is what POST wants and what PUT compares against.',
  },
  'negative-id-refused': {
    schema: '`type: integer` with no `minimum`, so -1 validates.',
    validator: 'Refuses it: an id is a filename, and there is no negative one.',
    firmware:
      'parse_program_filename accepts digits only, so no stored program can ever have a negative id; `PUT /programs/-1` could only ever be a mismatch.',
  },
  'empty-title-refused': {
    schema: '`type: string` with no `minLength`, so "" validates.',
    validator: 'Refuses an empty title.',
    firmware:
      '`out.title = root["title"] | ""` parses fine, but an untitled program is unidentifiable in the list the device serves — refused at authoring time rather than uploaded.',
  },
  'empty-series-refused': {
    schema: '`type: array` with no `minItems`, so `[]` validates.',
    validator: 'Refuses a program with no series.',
    firmware:
      'parse_program accepts it, but the executor has nothing to enter: a program with no series cannot be run, only stored.',
  },
} satisfies Record<string, Divergence>;

type DivergenceId = keyof typeof DIVERGENCES;

interface Case {
  name: string;
  doc: unknown;
  schema: Verdict;
  validator: Verdict;
  /** Exactly the warning paths the validator must report. Absent means none. */
  warnings?: string[];
  /** Required whenever the two disagree; forbidden when they do not. */
  divergence?: DivergenceId;
}

const EVENT_PATH = '/series/0/events/0';

function anEvent(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { duration: 1000, command: 'show', audio_ids: [7], ...patch };
}

function aSeries(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'Serie 1', optional: false, events: [anEvent()], ...patch };
}

function aProgram(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 100,
    title: 'Base',
    description: 'A program both descriptions accept',
    readonly: false,
    series: [aSeries()],
    ...patch,
  };
}

/** A program whose single event is `event`. */
function withEvent(event: unknown): Record<string, unknown> {
  return aProgram({ series: [aSeries({ events: [event] })] });
}

function without(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...source };
  delete copy[key];
  return copy;
}

const CASES: Case[] = [
  {
    name: 'the document both descriptions were written for',
    doc: aProgram(),
    schema: 'accepted',
    validator: 'accepted',
  },

  // --- unknown fields -----------------------------------------------------
  {
    name: 'an unknown top-level key',
    doc: aProgram({ colour: 'red' }),
    schema: 'refused',
    validator: 'accepted',
    warnings: ['/colour'],
    divergence: 'unknown-fields-dropped',
  },
  {
    name: 'an unknown series key',
    doc: aProgram({ series: [aSeries({ repeat: 3 })] }),
    schema: 'refused',
    validator: 'accepted',
    warnings: ['/series/0/repeat'],
    divergence: 'unknown-fields-dropped',
  },
  {
    name: 'an unknown event key',
    doc: withEvent(anEvent({ colour: 'red' })),
    schema: 'refused',
    validator: 'accepted',
    warnings: [`${EVENT_PATH}/colour`],
    divergence: 'unknown-fields-dropped',
  },

  // --- fields the schema requires and the device defaults ------------------
  {
    name: 'no id',
    doc: without(aProgram(), 'id'),
    schema: 'refused',
    validator: 'accepted',
    divergence: 'schema-required-superset',
  },
  {
    name: 'no description',
    doc: without(aProgram(), 'description'),
    schema: 'refused',
    validator: 'accepted',
    divergence: 'schema-required-superset',
  },
  {
    name: 'no readonly',
    doc: without(aProgram(), 'readonly'),
    schema: 'refused',
    validator: 'accepted',
    divergence: 'schema-required-superset',
  },
  {
    name: 'no optional on a series',
    doc: aProgram({ series: [without(aSeries(), 'optional')] }),
    schema: 'refused',
    validator: 'accepted',
    divergence: 'schema-required-superset',
  },
  {
    name: 'no events on a series',
    doc: aProgram({ series: [without(aSeries(), 'events')] }),
    schema: 'refused',
    validator: 'accepted',
    divergence: 'schema-required-superset',
  },
  // The two fields without which nothing runs: both descriptions refuse them.
  { name: 'no title', doc: without(aProgram(), 'title'), schema: 'refused', validator: 'refused' },
  { name: 'no series', doc: without(aProgram(), 'series'), schema: 'refused', validator: 'refused' },
  {
    name: 'no name on a series',
    doc: aProgram({ series: [without(aSeries(), 'name')] }),
    schema: 'refused',
    validator: 'refused',
  },

  // --- duration ------------------------------------------------------------
  {
    name: 'duration 0',
    doc: withEvent(anEvent({ duration: 0 })),
    schema: 'accepted',
    validator: 'accepted',
    warnings: [`${EVENT_PATH}/duration`],
    divergence: 'duration-below-min-clamped',
  },
  {
    name: 'a negative duration',
    doc: withEvent(anEvent({ duration: -1 })),
    schema: 'refused',
    validator: 'accepted',
    warnings: [`${EVENT_PATH}/duration`],
    divergence: 'duration-below-min-clamped',
  },
  {
    name: 'a duration above kMaxEventMs',
    doc: withEvent(anEvent({ duration: 3_600_001 })),
    schema: 'accepted',
    validator: 'accepted',
    warnings: [`${EVENT_PATH}/duration`],
    divergence: 'duration-above-max-clamped',
  },
  {
    name: 'a duration exactly kMaxEventMs',
    doc: withEvent(anEvent({ duration: 3_600_000 })),
    schema: 'accepted',
    validator: 'accepted',
  },
  {
    name: 'a fractional duration',
    doc: withEvent(anEvent({ duration: 1000.5 })),
    schema: 'refused',
    validator: 'refused',
  },
  {
    name: 'a duration as text',
    doc: withEvent(anEvent({ duration: '1000' })),
    schema: 'refused',
    validator: 'refused',
  },
  // The firmware would take this one — a missing duration reads as 0 and
  // clamps to 1 ms — but a 1 ms event is never what the author meant, so both
  // descriptions refuse it. Deliberately stricter than the device, in step.
  { name: 'no duration', doc: withEvent(without(anEvent(), 'duration')), schema: 'refused', validator: 'refused' },

  // --- command -------------------------------------------------------------
  { name: 'no command', doc: withEvent(without(anEvent(), 'command')), schema: 'accepted', validator: 'accepted' },
  { name: 'command "show"', doc: withEvent(anEvent({ command: 'show' })), schema: 'accepted', validator: 'accepted' },
  { name: 'command "hide"', doc: withEvent(anEvent({ command: 'hide' })), schema: 'accepted', validator: 'accepted' },
  // Refused by the device too, since PR #80.
  {
    name: 'an unrecognised command',
    doc: withEvent(anEvent({ command: 'toggle' })),
    schema: 'refused',
    validator: 'refused',
  },
  { name: 'an empty command', doc: withEvent(anEvent({ command: '' })), schema: 'refused', validator: 'refused' },
  {
    name: 'a command that is not text',
    doc: withEvent(anEvent({ command: 5 })),
    schema: 'refused',
    validator: 'refused',
  },

  // --- audio_ids -----------------------------------------------------------
  { name: 'no audio_ids', doc: withEvent(without(anEvent(), 'audio_ids')), schema: 'accepted', validator: 'accepted' },
  { name: 'empty audio_ids', doc: withEvent(anEvent({ audio_ids: [] })), schema: 'accepted', validator: 'accepted' },
  {
    name: 'a fractional audio id',
    doc: withEvent(anEvent({ audio_ids: [1.5] })),
    schema: 'refused',
    validator: 'refused',
  },
  {
    name: 'an audio id as text',
    doc: withEvent(anEvent({ audio_ids: ['1'] })),
    schema: 'refused',
    validator: 'refused',
  },
  {
    name: 'audio_ids that is not a list',
    doc: withEvent(anEvent({ audio_ids: 5 })),
    schema: 'refused',
    validator: 'refused',
  },
  {
    name: 'an audio id above int32',
    doc: withEvent(anEvent({ audio_ids: [2_147_483_648] })),
    schema: 'accepted',
    validator: 'accepted',
    warnings: [`${EVENT_PATH}/audio_ids/0`],
    divergence: 'audio-id-int32-range',
  },
  {
    name: 'an audio id below int32',
    doc: withEvent(anEvent({ audio_ids: [-2_147_483_649] })),
    schema: 'accepted',
    validator: 'accepted',
    warnings: [`${EVENT_PATH}/audio_ids/0`],
    divergence: 'audio-id-int32-range',
  },

  // --- readonly ------------------------------------------------------------
  { name: 'readonly false', doc: aProgram({ readonly: false }), schema: 'accepted', validator: 'accepted' },
  {
    name: 'readonly true',
    doc: aProgram({ readonly: true }),
    schema: 'accepted',
    validator: 'accepted',
    warnings: ['/readonly'],
    divergence: 'readonly-imposed-by-device',
  },
  {
    name: 'readonly that is not a boolean',
    doc: aProgram({ readonly: 'yes' }),
    schema: 'refused',
    validator: 'accepted',
    warnings: ['/readonly'],
    divergence: 'readonly-imposed-by-device',
  },

  // --- id ------------------------------------------------------------------
  { name: 'an id as text', doc: aProgram({ id: '100' }), schema: 'refused', validator: 'refused' },
  {
    name: 'a null id',
    doc: aProgram({ id: null }),
    schema: 'refused',
    validator: 'accepted',
    divergence: 'null-id-ignored',
  },
  {
    name: 'a negative id',
    doc: aProgram({ id: -1 }),
    schema: 'accepted',
    validator: 'refused',
    divergence: 'negative-id-refused',
  },

  // --- shapes --------------------------------------------------------------
  {
    name: 'an empty title',
    doc: aProgram({ title: '' }),
    schema: 'accepted',
    validator: 'refused',
    divergence: 'empty-title-refused',
  },
  {
    name: 'no series at all',
    doc: aProgram({ series: [] }),
    schema: 'accepted',
    validator: 'refused',
    divergence: 'empty-series-refused',
  },
  { name: 'series that is not a list', doc: aProgram({ series: {} }), schema: 'refused', validator: 'refused' },
  { name: 'a series that is not an object', doc: aProgram({ series: [5] }), schema: 'refused', validator: 'refused' },
  {
    name: 'events that is not a list',
    doc: aProgram({ series: [aSeries({ events: {} })] }),
    schema: 'refused',
    validator: 'refused',
  },
  {
    name: 'an event that is not an object',
    doc: aProgram({ series: [aSeries({ events: [5] })] }),
    schema: 'refused',
    validator: 'refused',
  },
  {
    name: 'optional that is not a boolean',
    doc: aProgram({ series: [aSeries({ optional: 'yes' })] }),
    schema: 'refused',
    validator: 'refused',
  },
  {
    name: 'a description that is not text',
    doc: aProgram({ description: 5 }),
    schema: 'refused',
    validator: 'refused',
  },
  { name: 'a root that is a list', doc: [aProgram()], schema: 'refused', validator: 'refused' },
  { name: 'a root that is text', doc: 'a program', schema: 'refused', validator: 'refused' },
  { name: 'a root that is null', doc: null, schema: 'refused', validator: 'refused' },

  // --- API v1 leftovers ----------------------------------------------------
  {
    name: 'a v1 target_system on an event',
    doc: withEvent(anEvent({ target_system: [1, 2] })),
    schema: 'accepted',
    validator: 'accepted',
    warnings: [`${EVENT_PATH}/target_system`],
    divergence: 'v1-keys-warned',
  },
  {
    name: 'a v1 start on an event',
    doc: withEvent(anEvent({ start: true })),
    schema: 'accepted',
    validator: 'accepted',
    warnings: [`${EVENT_PATH}/start`],
    divergence: 'v1-keys-warned',
  },
];

/** `Array.prototype.toSorted` needs lib es2023; the tsconfig targets ES2020. */
function sorted<T>(values: readonly T[]): T[] {
  return [...values].sort();
}

function schemaVerdict(doc: unknown): Verdict {
  return validateAgainstSchema(doc) ? 'accepted' : 'refused';
}

function validatorVerdict(doc: unknown): { verdict: Verdict; warnings: string[] } {
  const result = parseProgramDocument(JSON.stringify(doc));
  return result.ok
    ? { verdict: 'accepted', warnings: result.warnings.map((issue) => issue.path) }
    : { verdict: 'refused', warnings: [] };
}

/**
 * Two descriptions disagree when they reach different verdicts, and also when
 * the schema calls a document fine while the validator says the device will
 * store something else. Both need a reason written down.
 */
function diverges(expected: Case): boolean {
  return (
    expected.schema !== expected.validator || (expected.schema === 'accepted' && (expected.warnings?.length ?? 0) > 0)
  );
}

describe('the hand-written validator against contracts/program.schema.json', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, expected) => {
    const actual = validatorVerdict(expected.doc);

    expect({
      schema: schemaVerdict(expected.doc),
      validator: actual.verdict,
      warnings: sorted(actual.warnings),
    }).toEqual({
      schema: expected.schema,
      validator: expected.validator,
      warnings: sorted(expected.warnings ?? []),
    });
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s: any disagreement is a declared one', (_name, expected) => {
    if (diverges(expected)) {
      expect(expected.divergence, 'the two disagree here — name the entry in DIVERGENCES that allows it').toBeDefined();
      expect(Object.keys(DIVERGENCES)).toContain(expected.divergence);
    } else {
      expect(expected.divergence, 'the two agree here — this divergence claim is stale').toBeUndefined();
    }
  });

  it('has no divergence on the books that nothing exercises', () => {
    const claimed = CASES.map((c) => c.divergence).filter((id) => id !== undefined);
    expect(sorted(Object.keys(DIVERGENCES))).toEqual(sorted([...new Set(claimed)]));
  });

  it('documents every divergence against the firmware that justifies it', () => {
    for (const [id, entry] of Object.entries(DIVERGENCES)) {
      expect(entry.firmware.length, `${id} needs a firmware justification`).toBeGreaterThan(40);
    }
  });
});

describe('every shipped program, against both descriptions', () => {
  const files = ['1.json', '2.json', '20.json', '40.json', '50.json', '100.json', '101.json'];

  it.each(files)('%s', (name) => {
    const text = readFileSync(new URL(name, PROGRAMS_DIR), 'utf8');
    const document = JSON.parse(text) as Record<string, unknown>;

    expect(schemaVerdict(document), ajv.errorsText(validateAgainstSchema.errors)).toBe('accepted');

    const result = parseProgramDocument(text);
    if (!result.ok)
      throw new Error(`the validator refused a shipped program:\n${JSON.stringify(result.errors, null, 2)}`);

    // A shipped program is read-only because of where it lives, so a file that
    // says so draws the one warning that is not a finding: re-uploading it
    // makes an editable copy. Every other warning would mean the device stores
    // something other than what we ship.
    expect(result.warnings.map((issue) => issue.path)).toEqual(document.readonly === true ? ['/readonly'] : []);

    // Nothing clamped, nothing dropped: what we ship is what the device runs.
    expect(result.program.series).toEqual(document.series);
  });

  it('checks every file in resources/programs/files', async () => {
    const { readdirSync } = await import('node:fs');
    expect(sorted(readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.json')))).toEqual(sorted(files));
  });
});
