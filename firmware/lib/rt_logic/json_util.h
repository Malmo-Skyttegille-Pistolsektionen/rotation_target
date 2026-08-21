// ============================================================================
//  rt_logic/json_util.h
//  Minimal JSON string emission helpers shared by the serializers.
// ============================================================================
#pragma once

#include <cstdio>
#include <string>

namespace rt {

// Quote and escape `in` as a JSON string literal, surrounding quotes included.
//
// Program titles, series names and audio titles are uploaded by users and are
// free-form UTF-8, so they can legitimately contain the two characters that
// would otherwise break out of the literal, as well as control characters that
// are not valid raw inside one. Multi-byte UTF-8 sequences pass through
// untouched - their bytes are all >= 0x80, so they never collide with the
// ASCII characters escaped here.
inline std::string json_quote(const std::string &in) {
  std::string out;
  out.reserve(in.size() + 2);
  out += '"';
  for (unsigned char c : in) {
    switch (c) {
      case '"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      case '\b':
        out += "\\b";
        break;
      case '\f':
        out += "\\f";
        break;
      default:
        if (c < 0x20) {
          // Any remaining C0 control character needs the \u form; JSON has no
          // short escape for it.
          char buf[7];
          snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  out += '"';
  return out;
}

// `{"message":"..."}`, the shape every REST handler returns for a plain
// success. Failures are RFC 9457 problem details instead - see problem.h.
inline std::string json_message(const std::string &message) {
  return "{\"message\":" + json_quote(message) + "}";
}

}  // namespace rt
