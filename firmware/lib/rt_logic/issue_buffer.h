// ============================================================================
//  rt_logic/issue_buffer.h
//  A bounded store of `backend_issue` payloads that had no client to go to.
//
//  Issues raised before the HTTP server exists cannot be sent, and the boot
//  program scan raises exactly those. Keeping them here is what lets
//  GET /api/v2/diagnostics/info answer for a stored program that would not
//  parse, instead of it being visible only on the serial console.
// ============================================================================
#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace rt {

// Holds at most `capacity` payloads, dropping the oldest to make room. Bounded
// rather than growing: the input is a directory of files, so a filesystem full
// of unparsable ones would otherwise be an unbounded allocation at boot on a
// device with 512 KB of heap.
//
// Oldest-dropped rather than newest-refused so the store always reflects where
// the scan finished; a full store may therefore be a truncated one, which the
// contract says out loud.
class IssueBuffer {
 public:
  explicit IssueBuffer(size_t capacity) : capacity_(capacity) {}

  void push(std::string payload) {
    if (capacity_ == 0) return;
    if (entries_.size() >= capacity_) entries_.erase(entries_.begin());
    entries_.push_back(std::move(payload));
  }

  const std::vector<std::string> &entries() const { return entries_; }

 private:
  size_t capacity_;
  std::vector<std::string> entries_;
};

// `[{...},{...}]` from payloads that are already JSON objects - what
// `backend_issue_json` returns - so nothing is re-serialized or re-escaped.
inline std::string issue_array_json(const std::vector<std::string> &payloads) {
  std::string out = "[";
  bool first = true;
  for (const std::string &payload : payloads) {
    if (!first) out += ',';
    first = false;
    out += payload;
  }
  out += ']';
  return out;
}

}  // namespace rt
