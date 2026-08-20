import { describe, expect, it } from 'vitest';

import { parseProgramDocument, programTotalMs } from '../src/lib/program-document';
import { PROGRAM_MILITARY_SNABBMATCH } from './fixtures';

/** Errors as one string, so a test can assert on the wording it will show. */
function errorText(text: string): string {
  const result = parseProgramDocument(text);
  if (result.ok) throw new Error('expected the document to be refused');
  return result.errors.map((issue) => `${issue.path} ${issue.message}`).join('\n');
}

function accepted(document: unknown) {
  const result = parseProgramDocument(JSON.stringify(document));
  if (!result.ok) throw new Error(`expected the document to be accepted:\n${JSON.stringify(result.errors, null, 2)}`);
  return result;
}

describe('a program the device would accept', () => {
  it('round-trips a shipped program unchanged', () => {
    const result = accepted(PROGRAM_MILITARY_SNABBMATCH);

    expect(result.warnings.filter((w) => w.path !== '/readonly')).toEqual([]);
    expect(result.program.series).toEqual(PROGRAM_MILITARY_SNABBMATCH.series);
    expect(result.declaredId).toBe(PROGRAM_MILITARY_SNABBMATCH.id);
  });

  it('keeps the declared id separate from the document it will send', () => {
    // `POST` ignores the id and `PUT` refuses a mismatching one, so the caller
    // needs it named rather than buried in the body.
    const result = accepted({ ...PROGRAM_MILITARY_SNABBMATCH, id: 42 });
    expect(result.declaredId).toBe(42);
  });

  it('accepts a document with no id at all', () => {
    const withoutId: Record<string, unknown> = { ...PROGRAM_MILITARY_SNABBMATCH };
    delete withoutId.id;
    expect(accepted(withoutId).declaredId).toBeNull();
  });

  it('defaults what the schema lets a document leave out', () => {
    const result = accepted({
      title: 'Minimal',
      series: [{ name: 'Serie 1', events: [{ duration: 1000 }] }],
    });

    expect(result.program).toEqual({
      id: 0,
      title: 'Minimal',
      description: '',
      readonly: false,
      series: [{ name: 'Serie 1', optional: false, events: [{ duration: 1000 }] }],
    });
  });
});

describe('what the device will change, reported as warnings', () => {
  it('clamps a duration outside 1…3600000 and says what will be stored', () => {
    const result = accepted({
      title: 'Clamped',
      series: [{ name: 'Serie 1', optional: false, events: [{ duration: 0 }, { duration: 9_000_000 }] }],
    });

    expect(result.program.series[0].events).toEqual([{ duration: 1 }, { duration: 3600000 }]);
    expect(result.warnings.map((w) => w.path)).toEqual(['/series/0/events/0/duration', '/series/0/events/1/duration']);
    expect(result.warnings[0].message).toContain('store it as 1 ms');
  });

  it('drops fields that are not part of a program, at every level', () => {
    const result = accepted({
      title: 'Extras',
      nickname: 'dropped',
      series: [{ name: 'Serie 1', optional: false, colour: 'dropped', events: [{ duration: 1000, tempo: 4 }] }],
    });

    expect(result.warnings.map((w) => w.path)).toEqual(['/nickname', '/series/0/colour', '/series/0/events/0/tempo']);
    expect(result.program.series[0].events[0]).toEqual({ duration: 1000 });
  });

  it('keeps the v1 fields the schema still allows, without storing them', () => {
    const result = accepted({
      title: 'From v1',
      series: [{ name: 'Serie 1', events: [{ duration: 1000, start: true, target_system: [1, 2] }] }],
    });

    expect(result.warnings).toEqual([]);
    expect(result.program.series[0].events[0]).toEqual({ duration: 1000 });
  });

  it('warns that a document cannot make itself read-only', () => {
    const result = accepted({ ...PROGRAM_MILITARY_SNABBMATCH, readonly: true });

    expect(result.program.readonly).toBe(false);
    expect(result.warnings.map((w) => w.path)).toContain('/readonly');
  });
});

describe('what it refuses, and how it says so', () => {
  it('names the parse failure for a file that is not JSON', () => {
    expect(errorText('{ not json')).toContain('Not valid JSON');
  });

  it('refuses a JSON document that is not an object', () => {
    expect(errorText('[1, 2, 3]')).toContain('must be a JSON object');
  });

  it('requires a title and a series list', () => {
    const text = errorText(JSON.stringify({ description: 'nothing else' }));
    expect(text).toContain('/title A program needs a title.');
    expect(text).toContain('/series A program needs a "series" list.');
  });

  it('refuses a program with no series at all', () => {
    expect(errorText(JSON.stringify({ title: 'Empty', series: [] }))).toContain('at least one series');
  });

  it('points at the series and event that are wrong', () => {
    const text = errorText(
      JSON.stringify({
        title: 'Broken',
        series: [
          { name: 'Serie 1', events: [{ duration: 1000 }] },
          { optional: false, events: [] },
          { name: 'Serie 3', events: [{ duration: '1000' }, { duration: 1000, command: 'sideways' }] },
        ],
      }),
    );

    expect(text).toContain('/series/1/name Every series needs a name.');
    expect(text).toContain('/series/2/events/0/duration Duration must be a whole number');
    expect(text).toContain('/series/2/events/1/command Command must be "show" or "hide", but this is "sideways".');
  });

  it('refuses audio ids that are not whole numbers', () => {
    const text = errorText(
      JSON.stringify({ title: 'Audio', series: [{ name: 'S', events: [{ duration: 1000, audio_ids: ['26'] }] }] }),
    );
    expect(text).toContain('/series/0/events/0/audio_ids');
  });
});

describe('programTotalMs', () => {
  it('adds up every event in every series', () => {
    const expected = PROGRAM_MILITARY_SNABBMATCH.series
      .flatMap((series) => series.events)
      .reduce((sum, event) => sum + event.duration, 0);

    expect(programTotalMs(PROGRAM_MILITARY_SNABBMATCH)).toBe(expected);
  });
});
