#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "esp_system.h"

// What the flash table holds and how full each part of it is.
//
// Shared rather than owned by the HTTP layer: the same figures answer
// GET /api/v2/diagnostics/info and the serial console's `status`, and the
// app-slot size is the awkward one - ESP-IDF has no runtime call for it, so it
// is walked out of the image header, and that wants exactly one implementation.
namespace diagnostics {

struct PartitionUsage {
  const char *name;
  bool is_app;
  size_t size_bytes;
  // False where the device genuinely cannot tell - otadata, and any data
  // subtype with no accounting behind it. Reporting 0 there would be a
  // stronger claim than the device can make.
  bool used_known;
  size_t used_bytes;
  // App partitions only; false for everything else.
  bool running;
};

// Every partition in the table, in flash-offset order - the order
// partitions.csv reads in.
std::vector<PartitionUsage> partitions();

// The reset cause as a stable lowercase word, for GET /diagnostics/info and the
// serial console. Shared for the same reason as the partition figures: two
// callers must not answer this differently.
const char *reset_reason_name(esp_reset_reason_t reason);

}  // namespace diagnostics
