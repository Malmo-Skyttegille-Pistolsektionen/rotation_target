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
  // `boot-targets [shown|hidden]` - reads with no argument, sets with one.
  // Serial-only by design (#144): which position is safe at rest is a property
  // of the target system, so it must be configurable, but it is also the
  // setting that protects somebody standing downrange - so changing it needs
  // physical access rather than a web form.
  kBootTargets,
  // `wifi-scan` - what the radio can hear, with signal and encryption.
  // `wifi-info` - what this device is joined to, and how.
  //
  // Serial-only on purpose, and not because they are dangerous: they are a
  // diagnostic for somebody standing at a range wondering why a board will not
  // join, and that person has a cable. Adding an API surface for them would be
  // a surface to secure for no gain.
  kWifiScan,
  kWifiInfo,
  // `factory-reset` - reports what it would destroy; `factory-reset confirm`
  // does it. The button gesture (#222) is the route for somebody with no
  // cable; this is the route for somebody who already has one, and it can say
  // in words what a white LED cannot.
  kFactoryReset,
  // `play [id]` - no argument lists the clips, an id queues that clip. Serial
  // access to the same playback the API offers, because the person testing a
  // DAC at a bench (or a range with no usable network) has a cable and no
  // browser.
  kPlay,
};

// What followed `boot-targets` on the line.
enum class BootTargets {
  kMissing,  // no argument: report, do not change
  kShown,
  kHidden,
  kInvalid,  // a word that is neither
};

// The argument of a `boot-targets` line. Case-insensitive, like the command.
BootTargets parse_boot_targets(std::string_view line);

// What followed `play` on the line.
enum class PlayArg {
  kMissing,  // no argument: list the clips, do not play
  kId,       // a well-formed id, delivered through the out-parameter
  kInvalid,  // something that is not a clip id
};

// The argument of a `play` line. An id is decimal digits only, bounded so it
// cannot overflow; whether a clip with that id exists is the caller's question.
PlayArg parse_play(std::string_view line, int32_t &id);

// Whether a `factory-reset` line carries the confirmation word. Anything else
// after the command - including a near miss like `yes` - is not a
// confirmation, because the reply the device printed says exactly what to
// type and a destructive command should take only what it asked for.
bool factory_reset_confirmed(std::string_view line);

// Parses one line. Leading and trailing whitespace is ignored, and matching is
// case-insensitive: someone typing at a serial terminal at a range should not
// be corrected on capitalisation.
Command parse_command(std::string_view line);

// The word a command came from, for echoing back what was not understood.
std::string first_word(std::string_view line);

}  // namespace rt::console
