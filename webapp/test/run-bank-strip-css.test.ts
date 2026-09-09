import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The bank strip's colour is its whole point, and jsdom does not compute the
 * cascade — so no rendering test can see this class of bug. It shipped once:
 * `.bankCell` set `background-color`, `color` and `border`, and was declared
 * *after* `.badgeGreen` / `.badgeRed` at the same specificity, so every cell
 * painted the same neutral grey whatever the device reported. The buttons
 * worked, the DOM was right, the aria-labels were right, and operators
 * concluded the controls were dead.
 *
 * This parses the stylesheet as text rather than asserting on a render, which
 * is the only place the ordering rule is visible.
 */
const CSS = readFileSync(fileURLToPath(new URL('../src/routes/run.module.css', import.meta.url)), 'utf-8');

/** The declarations of the rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const match = new RegExp(`(^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm').exec(CSS);
  expect(match, `no rule for ${selector} in run.module.css`).not.toBeNull();
  return match![2];
}

describe('the target bank strip paints the state it is given', () => {
  // The base rule is geometry only. Anything visual here silently outranks the
  // state classes above it.
  it('sets no colour on .bankCell, which would outrank the state classes', () => {
    const body = ruleBody('.bankCell');
    expect(body).not.toMatch(/(^|[\s;])background(-color)?\s*:/);
    expect(body).not.toMatch(/(^|[\s;])color\s*:/);
    expect(body).not.toMatch(/(^|[\s;])border\s*:/);
  });

  // And the two hues are still declared, so "no colour anywhere" cannot pass
  // this file by deleting them instead.
  it('keeps the two state hues on .badgeGreen and .badgeRed', () => {
    for (const selector of ['.badgeGreen', '.badgeRed']) {
      const body = ruleBody(selector);
      expect(body, selector).toMatch(/background-color\s*:/);
      expect(body, selector).toMatch(/border\s*:/);
    }
  });

  // Order is the other half of the rule: were a colouring `.bankCell` rule ever
  // added back, it would have to come after these to win - and it must not win.
  //
  // Matched on the rule head rather than on the bare class name, or a comment
  // mentioning `.badgeGreen` above the strip would satisfy this without a rule
  // being there at all.
  it('declares .badgeGreen and .badgeRed before .bankCell', () => {
    const at = (selector: string): number => {
      const index = CSS.search(new RegExp(`^\\${selector}\\s*\\{`, 'm'));
      expect(index, `no rule head for ${selector}`).toBeGreaterThan(-1);
      return index;
    };
    expect(at('.badgeGreen')).toBeLessThan(at('.bankCell'));
    expect(at('.badgeRed')).toBeLessThan(at('.bankCell'));
  });
});
