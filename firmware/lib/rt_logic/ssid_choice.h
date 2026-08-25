// ============================================================================
//  rt_logic/ssid_choice.h
//  Which network the setup portal's form actually asked for.
// ============================================================================
#pragma once

#include <string>
#include <string_view>

namespace rt {

// The portal offers two ways to name a network: a dropdown of what the scan
// found, and a free-text field for one it did not - a hidden network, or one
// out of range at the moment the scan ran.
//
// **Typed wins.** Somebody who typed a name did so after seeing the list, so it
// is the later and more deliberate of the two. The dropdown is the convenience.
//
// Decided here rather than in the request handler because it is a decision
// rather than an effect, and because the interesting cases are all edges: a
// field of spaces is not a network name, and a name may legitimately contain
// spaces inside it.
//
// This replaces a sentinel `<option>` carrying U+0001, which browsers were not
// obliged to preserve - a control character in an HTML attribute is a parse
// error - so "Other or hidden network" selected nothing and submitted a
// mangled name. With the text field always visible there is no mode to signal
// and nothing to encode.
inline std::string chosen_ssid(std::string_view picked, std::string_view typed) {
  const auto trim = [](std::string_view text) {
    const auto is_space = [](char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; };
    while (!text.empty() && is_space(text.front())) text.remove_prefix(1);
    while (!text.empty() && is_space(text.back())) text.remove_suffix(1);
    return text;
  };

  // Trimmed for the emptiness test *and* for the result: a phone keyboard's
  // trailing space would otherwise be saved as part of the name, and the join
  // would fail with nothing on screen to explain why.
  const std::string_view typed_trimmed = trim(typed);
  if (!typed_trimmed.empty()) return std::string(typed_trimmed);

  // The dropdown's own value, which is either an SSID the scan reported or the
  // empty placeholder. Not trimmed against the scan's bytes: an SSID may
  // legitimately begin or end with a space, and this half was not typed by
  // anybody.
  return std::string(picked);
}

}  // namespace rt
