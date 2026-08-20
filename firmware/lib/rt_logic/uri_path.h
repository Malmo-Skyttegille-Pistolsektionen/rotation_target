// ============================================================================
//  rt_logic/uri_path.h
//  URI path-segment parsing - host-testable, no HTTP server.
//
//  This is the security boundary for every `{id}` route, so it lives here
//  rather than in main/net/web_server.cpp: pure by nature, and being here means
//  host_test/test_uri_path covers it under ASan/UBSan.
// ============================================================================
#pragma once

#include <cstdint>
#include <string>

namespace rt {

// Pull the numeric segment out of a URI shaped `<prefix><id><suffix>`, e.g.
// "/api/v2/programs/" + 12 + "/load".
//
// Anything non-numeric, empty, mismatched or out of int32 range is refused, so
// a malformed path becomes a 404 rather than silently reading as id 0 the way
// an atoi()-style parse would.
inline bool path_id(const char *uri, const char *prefix, const char *suffix, int32_t &out) {
  if (uri == nullptr) return false;

  std::string path(uri);
  const size_t query = path.find('?');
  if (query != std::string::npos) path.resize(query);

  const size_t prefix_len = std::string(prefix).size();
  const size_t suffix_len = std::string(suffix).size();
  if (path.size() <= prefix_len + suffix_len) return false;
  if (path.compare(0, prefix_len, prefix) != 0) return false;
  if (suffix_len > 0 && path.compare(path.size() - suffix_len, suffix_len, suffix) != 0) {
    return false;
  }

  const std::string digits = path.substr(prefix_len, path.size() - prefix_len - suffix_len);
  if (digits.empty()) return false;

  // int64 accumulator: overflowing an int32 here would be UB, and the range
  // check has to happen before the narrowing cast, not after.
  int64_t value = 0;
  for (char c : digits) {
    if (c < '0' || c > '9') return false;
    value = value * 10 + (c - '0');
    if (value > INT32_MAX) return false;
  }
  out = static_cast<int32_t>(value);
  return true;
}

}  // namespace rt
