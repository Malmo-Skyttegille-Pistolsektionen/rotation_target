// ============================================================================
//  rt_logic/library_changed.h
//  The `libraryChanged` SSE payload: the stored programs or audio clips are no
//  longer what a client last fetched, so it should fetch them again.
// ============================================================================
#pragma once

#include <string>

#include "json_util.h"

namespace rt {

// Which collection changed. Kept in lock-step with the `kind` enum in
// contracts/asyncapi.yaml - a client switches on these to pick the list to
// refetch.
namespace library_kind {
constexpr const char *kAudio = "audio";
constexpr const char *kProgram = "program";
}  // namespace library_kind

// `{"kind":"audio"}` / `{"kind":"program"}`.
//
// Deliberately carries no id and no operation: the event says a list is stale,
// and the client answers with the GET it would have made anyway. Anything more
// would be a delta the client could apply, which is a different contract.
inline std::string library_changed_json(const std::string &kind) {
  return "{\"kind\":" + json_quote(kind) + "}";
}

}  // namespace rt
