/**
 * Which network the form actually asked for, when there is both a dropdown and
 * a text field.
 *
 * Kept in lock-step with `rt::chosen_ssid` in
 * `firmware/lib/rt_logic/ssid_choice.h`, which the setup portal uses for the
 * same form. Both places have to agree, because a club member who provisions a
 * hidden network at the portal and later moves the device from Expert mode
 * would otherwise get two different answers to the same two fields.
 *
 * **Typed wins.** Somebody who typed a name did so after seeing the list, so it
 * is the later and more deliberate of the two.
 */
export function chosenSsid(picked: string, typed: string): string {
  // Trimmed for the emptiness test *and* for the result: a phone keyboard's
  // trailing space would otherwise be saved as part of the name, and the join
  // would fail with nothing on screen to explain why.
  const typedTrimmed = trim(typed);
  if (typedTrimmed !== '') return typedTrimmed;

  // Not trimmed: an SSID may legitimately begin or end with a space, and this
  // half was not typed by anybody — it is the scan's own bytes.
  return picked;
}

/**
 * The four characters `rt::chosen_ssid` trims, and not one more.
 *
 * Deliberately not `String.trim()`, which also strips U+00A0 and the Unicode
 * space separators. An SSID is arbitrary bytes: one containing a non-breaking
 * space is legal, joinable, and would be silently mangled by the wider rule —
 * and mangled *here only*, since the firmware's trim would have kept it.
 */
function trim(text: string): string {
  return text.replace(/^[ \t\r\n]+/, '').replace(/[ \t\r\n]+$/, '');
}
