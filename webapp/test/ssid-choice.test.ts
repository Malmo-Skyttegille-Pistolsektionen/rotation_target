import { describe, expect, it } from 'vitest';

import { chosenSsid } from '../src/lib/ssid-choice';

/**
 * The mirror of `firmware/host_test/test_ssid_choice`, case for case.
 *
 * Both forms — the setup portal's and Expert mode's — offer a dropdown and a
 * text field, and both have to answer "which network did they ask for" the same
 * way. This file exists so that a change to one implementation without the
 * other is a red test rather than a device that joins a different network
 * depending on which page provisioned it.
 */
describe('which network the form asked for', () => {
  it('uses the dropdown when nothing was typed', () => {
    expect(chosenSsid('Klubbnat', '')).toBe('Klubbnat');
  });

  // Somebody who typed a name did so after seeing the list, so it is the later
  // and more deliberate of the two.
  it('lets typing win over the dropdown', () => {
    expect(chosenSsid('Klubbnat', 'Hidden-AP')).toBe('Hidden-AP');
  });

  it('accepts typing alone', () => {
    expect(chosenSsid('', 'Hidden-AP')).toBe('Hidden-AP');
  });

  // The placeholder option submits an empty value, and an empty form has to
  // stay empty so the device can refuse it rather than save a nameless network.
  it('is empty when nothing was chosen and nothing typed', () => {
    expect(chosenSsid('', '')).toBe('');
  });

  // A phone keyboard offers a trailing space after almost anything.
  it('trims a typed name', () => {
    expect(chosenSsid('', '  Hidden-AP  ')).toBe('Hidden-AP');
    expect(chosenSsid('', 'Hidden-AP\r\n')).toBe('Hidden-AP');
  });

  it('does not treat a field of only spaces as a name', () => {
    expect(chosenSsid('Klubbnat', '   ')).toBe('Klubbnat');
    expect(chosenSsid('Klubbnat', '\t\r\n')).toBe('Klubbnat');
    expect(chosenSsid('', '  ')).toBe('');
  });

  // Trimming the ends must not touch the middle - "Bana E" is one of ours.
  it('keeps spaces inside a name', () => {
    expect(chosenSsid('', '  Bana E  ')).toBe('Bana E');
    expect(chosenSsid('', 'a  b')).toBe('a  b');
  });

  // The scan's bytes are not typed by anybody, and an SSID may legitimately
  // begin or end with a space. Trimming that half would make such a network
  // unjoinable from the list.
  it('takes the dropdown value verbatim', () => {
    expect(chosenSsid(' spaced ', '')).toBe(' spaced ');
  });

  // `String.trim()` would strip this and the firmware's would not, which is
  // the one way these two implementations could disagree while both looking
  // correct in isolation.
  it('leaves a non-breaking space alone, as the firmware does', () => {
    expect(chosenSsid('', ' Bana ')).toBe(' Bana ');
  });

  // The old mechanism encoded "the user wants the text field" as a U+0001
  // sentinel in an HTML attribute. There is no mode to signal any more, so a
  // name that merely looks like the old sentinel is just a name.
  it('has no sentinel value any more', () => {
    expect(chosenSsid('other', '')).toBe('other');
    expect(chosenSsid('Other', '')).toBe('Other');
  });
});
