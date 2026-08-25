// ============================================================================
//  rt_logic/version.h
//  The three-part split of a `git describe` string - host-testable.
// ============================================================================
#pragma once

#include <cstdint>
#include <string_view>

namespace rt {

// What `GET /api/v2/version` reports. Zeroed when the running image has no
// release tag reachable from it, which is the honest answer for an untagged
// build rather than a number invented from a commit hash.
struct SemVer {
  uint32_t major = 0;
  uint32_t minor = 0;
  uint32_t patch = 0;
};

// Parses the leading `MAJOR.MINOR.PATCH` of a `git describe --tags --dirty`
// output. False - and `out` left zeroed - for anything else.
//
// In rt_logic rather than in the route handler, for the reason every parser
// here is: it turns a string into meaning, so it belongs where a host test
// reaches it. It replaces an `sscanf("%u.%u.%u%n")`, which cert-err34-c
// objects to because the `%u` conversions cannot report overflow - a field of
// enough digits wrapped silently instead of failing.
//
// Strictness is the point and was learned the hard way: a bare hash like
// `9f7c98d` parsed as major=9 under a looser reading, and the device reported
// 9.0.0. So all three fields are required, and what follows them must be a
// legitimate semver continuation - end of string, or the `-N-gHASH` / `+meta`
// that describe appends.
bool parse_semver(std::string_view describe, SemVer &out);

}  // namespace rt
