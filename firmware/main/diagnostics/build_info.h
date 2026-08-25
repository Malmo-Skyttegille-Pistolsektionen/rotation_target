// ============================================================================
//  diagnostics/build_info.h
//  What produced this image (#228).
// ============================================================================
#pragma once

#include <cstddef>

// The device could answer "what version am I" and very little else. When a
// board comes back from a range day behaving oddly the useful questions are
// "which commit is this", "was it built from a clean tree" and "which runner
// built it", and none of them were answerable.
//
// Four typed values plus a free-form map. The split is the point: anything the
// UI reasons about wants a type, but adding a build-metadata key should not be
// a contract change, a regenerated `generated.d.ts` and a mock-server update
// every time. `details()` is rendered as a table and never branched on.
//
// Everything here is generated from git at build time by
// cmake/build_info.cmake - no version constant is ever committed (D-29).
namespace build_info {

struct Detail {
  const char *key;
  const char *value;
};

// `git describe`, the same string esp_app_desc_t carries. Repeated so a copied
// `build` block stands on its own when it is pasted into an issue.
const char *version();

// Abbreviated sha, or empty when the image was built without a repository -
// a tarball, or a container without the checkout.
const char *commit();

// Whether the working tree had uncommitted changes.
bool dirty();

// UTC, ISO 8601. The one field that stops a build being byte-reproducible;
// SOURCE_DATE_EPOCH is the escape hatch if that ever matters.
const char *build_time();

// The untyped half. Keys come and go without a contract change.
const Detail *details();
size_t detail_count();

}  // namespace build_info
