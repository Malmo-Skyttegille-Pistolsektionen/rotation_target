// ============================================================================
//  rt_logic/backend_issue.h
//  The `backend_issue` SSE payload: a device-side failure no client asked for
//  and so cannot learn about from a REST response.
// ============================================================================
#pragma once

#include <string>
#include <utility>
#include <vector>

#include "json_util.h"

namespace rt {

// The machine-readable half of the payload. Kept in lock-step with the `code`
// enum in contracts/asyncapi.yaml - a client switches on these.
namespace issue_code {
constexpr const char *kAudioPlaybackFailed = "audio_playback_failed";
constexpr const char *kProgramInvalid = "program_invalid";
// Raised by the boot scan (see #129): an uploaded program or audio clip's id
// already belongs to a shipped one. The shipped entry is kept; the uploaded
// file is left on disk, unloaded, for an operator to clean up.
constexpr const char *kProgramIdCollision = "program_id_collision";
constexpr const char *kAudioIdCollision = "audio_id_collision";
}  // namespace issue_code

// Ordered because the emitted JSON should be stable across builds, and because
// there are never more than a couple of entries.
using IssueContext = std::vector<std::pair<std::string, std::string>>;

// `{"code":...,"message":...,"context":{...}}`, with `context` omitted when
// empty. Every part goes through json_quote: the values are filesystem paths
// and filenames, which reach here from user uploads.
inline std::string backend_issue_json(const std::string &code, const std::string &message,
                                      const IssueContext &context = {}) {
  std::string out = "{\"code\":" + json_quote(code) + ",\"message\":" + json_quote(message);
  if (!context.empty()) {
    out += ",\"context\":{";
    bool first = true;
    for (const auto &entry : context) {
      if (!first) out += ',';
      first = false;
      out += json_quote(entry.first);
      out += ':';
      out += json_quote(entry.second);
    }
    out += '}';
  }
  out += '}';
  return out;
}

}  // namespace rt
