#include "build_info.h"

#include "build_info.generated.h"

namespace build_info {
namespace {

// Generated. Everything is a string literal in .rodata, so the whole blob
// costs a few hundred bytes against a 3 MB slot and nothing at runtime.
constexpr Detail kDetails[] = {RT_BUILD_DETAILS};

}  // namespace

const char *version() {
  return RT_BUILD_VERSION;
}

const char *commit() {
  return RT_BUILD_COMMIT;
}

bool dirty() {
  return RT_BUILD_DIRTY;
}

const char *build_time() {
  return RT_BUILD_TIME;
}

const Detail *details() {
  return kDetails;
}

size_t detail_count() {
  return sizeof(kDetails) / sizeof(kDetails[0]);
}

}  // namespace build_info
