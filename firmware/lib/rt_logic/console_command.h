#pragma once

#include <string>
#include <string_view>

// The serial console's line parser.
//
// In rt_logic rather than main/ for the usual reason: this turns outside bytes
// into meaning, so it is attacker-reachable surface and belongs where a host
// test and a sanitizer can reach it. The transport - which port, which driver -
// stays in main/.
namespace rt::console {

enum class Command {
  kNone,     // the line was blank
  kUnknown,  // a word we do not have
  kHelp,
  kStatus,
};

// Parses one line. Leading and trailing whitespace is ignored, and matching is
// case-insensitive: someone typing at a serial terminal at a range should not
// be corrected on capitalisation.
Command parse_command(std::string_view line);

// The word a command came from, for echoing back what was not understood.
std::string first_word(std::string_view line);

}  // namespace rt::console
