import { describe, expect, it } from 'vitest';
import { NEW_FILE_URL_BUDGET_BYTES, buildNewFileUrl, prCommitMessage, prDescription } from '../src/lib/pr-url';

const CTX = { id: 42, title: 'Militär Snabbmatch', origin: 'this repo, resources/programs/files/42.json' };

describe('prCommitMessage', () => {
  it('is a Conventional Commits subject carrying the id and title', () => {
    expect(prCommitMessage(CTX)).toBe('feat(programs): add program 42 — Militär Snabbmatch');
  });
});

describe('prDescription', () => {
  it('says the id, the title, where it came from, and that it has not run on a target', () => {
    const body = prDescription(CTX);
    expect(body).toContain('Program 42');
    expect(body).toContain('Militär Snabbmatch');
    expect(body).toContain(CTX.origin);
    expect(body.toLowerCase()).toContain('has not been run on a target');
  });
});

describe('buildNewFileUrl', () => {
  it('points at the new-file endpoint under resources/programs/files/', () => {
    const { url } = buildNewFileUrl('acme', 'rotation_target', '{"title":"x"}', CTX);
    expect(url.startsWith('https://github.com/acme/rotation_target/new/main?')).toBe(true);
    expect(url).toContain('filename=resources%2Fprograms%2Ffiles%2F42.json');
  });

  it('is under budget for a small document', () => {
    const { overBudget, byteLength } = buildNewFileUrl('acme', 'rotation_target', '{"title":"x"}', CTX);
    expect(overBudget).toBe(false);
    expect(byteLength).toBeLessThan(NEW_FILE_URL_BUDGET_BYTES);
  });

  it('flags a large document as over budget rather than silently truncating it', () => {
    const largeJson = JSON.stringify({ series: 'x'.repeat(NEW_FILE_URL_BUDGET_BYTES) });
    const { overBudget, url } = buildNewFileUrl('acme', 'rotation_target', largeJson, CTX);
    expect(overBudget).toBe(true);
    // Nothing is dropped to fit - the full document round-trips out of the URL,
    // and the caller decides not to offer it as a link instead.
    const value = new URL(url).searchParams.get('value');
    expect(value).toBe(largeJson);
  });
});
