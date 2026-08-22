// ============================================================================
//  rt_logic/id_range.h
//  The shipped/upload id split - host-testable, no hardware. See #129.
// ============================================================================
#pragma once

#include <cstdint>

namespace rt {

// Whether `id` falls in the shipped range: below the first id an upload can
// ever be assigned. Uploaded programs and audio are always given the next
// free id at or above `first_upload_id` (see next_free_id() below), so a
// shipped id landing at or past it means a resource was mis-numbered, not
// that an upload strayed - see kFirstUploadId in main/config.h and
// resources/programs/validate_programs.sh, which enforces this at the
// resource-authoring end.
constexpr bool is_shipped_id(int32_t id, int32_t first_upload_id) {
  return id < first_upload_id;
}

// The next id at or above `first` that `in_use` does not already claim.
// Shared by programs::add_uploaded and audios::add_uploaded so "always clear
// of the shipped range" has one implementation rather than two that can
// drift apart.
template <typename InUse>
int32_t next_free_id(int32_t first, InUse in_use) {
  int32_t id = first;
  while (in_use(id)) id++;
  return id;
}

// Whether loading an entry already backed by a shipped (read-only) one would
// silently replace it with an uploaded one. Shipped always loads first (see
// programs::load_all / audios::load_all), so `existing_readonly` is the
// readonly flag of whatever is already at this id and `incoming_readonly` is
// the directory the new entry is being loaded from - this is what turns a
// same-id shipped/upload pair into a loud, reported collision instead of the
// silent overwrite #129 found: an uploaded id can only land on a shipped one
// when the shipped range invariant above has already been violated, and the
// uploaded copy winning made a promoted program look like it had not taken
// effect.
constexpr bool would_shadow_shipped(bool existing_readonly, bool incoming_readonly) {
  return existing_readonly && !incoming_readonly;
}

}  // namespace rt
