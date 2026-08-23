// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18091" }
import { describe, expect, it } from 'vitest';

import { parseProgramDocument } from '../src/lib/program-document';

/**
 * The run timer's anchor (#126). Several programs open with preamble — audio
 * announcing the series, the count, a loading period — and that is not shooting
 * time. `timer_start_index` names the event where the clock reaches zero.
 */

function documentWith(timerStartIndex: number | undefined): string {
  const series: Record<string, unknown> = {
    name: 'Provserie 10s',
    optional: false,
    events: [{ duration: 5000 }, { duration: 60000, audio_ids: [26] }, { duration: 7000 }],
  };
  if (timerStartIndex !== undefined) series.timer_start_index = timerStartIndex;
  return JSON.stringify({ id: 1, title: 'Militär Snabbmatch', series: [series] });
}

describe('timer_start_index', () => {
  it('is carried through when the document has it', () => {
    const result = parseProgramDocument(documentWith(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.series[0].timer_start_index).toBe(1);
  });

  it('is absent from the parsed document when the file omits it', () => {
    // The parsed document is what round-trips back to the device, so emitting a
    // default would make it differ from the file it came from.
    const result = parseProgramDocument(documentWith(undefined));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.series[0]).not.toHaveProperty('timer_start_index');
  });

  it('refuses an index past the end rather than clamping it', () => {
    // It names an event that is not there. Anchoring somewhere else would start
    // the clock at a moment nobody chose — the firmware refuses it too.
    const result = parseProgramDocument(documentWith(5));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].path).toContain('timer_start_index');
    expect(result.errors[0].message).toContain('3 events');
  });

  it('refuses a negative index', () => {
    const result = parseProgramDocument(documentWith(-1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].path).toContain('timer_start_index');
  });

  it('refuses a non-integer index', () => {
    const result = parseProgramDocument(documentWith(1.5));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].path).toContain('timer_start_index');
  });
});
