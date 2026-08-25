#include "version.h"

namespace rt {
namespace {

// Reads one decimal field, advancing `cursor`. False on no digits at all, or
// on a value too large for the field - which is the case sscanf could not
// report and cert-err34-c exists to point at.
bool take_number(std::string_view text, size_t &cursor, uint32_t &out) {
  const size_t start = cursor;
  uint64_t value = 0;
  while (cursor < text.size() && text[cursor] >= '0' && text[cursor] <= '9') {
    value = value * 10 + static_cast<uint64_t>(text[cursor] - '0');
    if (value > UINT32_MAX) return false;
    cursor++;
  }
  if (cursor == start) return false;
  out = static_cast<uint32_t>(value);
  return true;
}

bool take_dot(std::string_view text, size_t &cursor) {
  if (cursor >= text.size() || text[cursor] != '.') return false;
  cursor++;
  return true;
}

}  // namespace

bool parse_semver(std::string_view describe, SemVer &out) {
  out = SemVer{};

  size_t cursor = 0;
  SemVer parsed;
  if (!take_number(describe, cursor, parsed.major) || !take_dot(describe, cursor) ||
      !take_number(describe, cursor, parsed.minor) || !take_dot(describe, cursor) ||
      !take_number(describe, cursor, parsed.patch)) {
    return false;
  }

  // What follows has to be a semver continuation, or this was never a version:
  // `2.0.0`, `2.0.0-3-gab12cde`, `2.0.0+meta`. Anything else - `2.0.0.1`,
  // `2.0.0rc` - is a string that merely starts like one.
  if (cursor != describe.size() && describe[cursor] != '-' && describe[cursor] != '+') {
    return false;
  }

  out = parsed;
  return true;
}

}  // namespace rt
