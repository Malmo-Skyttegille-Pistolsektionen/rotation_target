#pragma once

#include <map>
#include <string>

#include "program.h"

// The programs the device knows about: those flashed with the firmware
// (read-only) and those uploaded to it.
//
// Programs are stored in a std::map so that references stay valid across
// inserts - ProgramState holds a bare `const rt::Program *` at whatever is
// loaded, and a rehash would dangle it.
namespace programs {

void load_all();

// Null when there is no such program.
const rt::Program *get(int32_t id);

const std::map<int32_t, rt::Program> &all();

// Persist an uploaded document and add it, assigning the next free id from
// kFirstUploadId. Returns the new id, or -1 if the document is invalid or
// could not be written.
int32_t add_uploaded(const char *json, size_t len);

enum class UpdateResult {
  kOk,
  kNotFound,
  kReadonly,
  kInvalid,
  // The document declares an `id` other than the one being written.
  kIdMismatch,
  kWriteFailed,
};

// Replace the stored document for an existing uploaded program, rewritten from
// the parsed model exactly as add_uploaded() writes a new one. The id stays
// the one the caller asked for: a document declaring a different one is
// refused rather than renumbered, because the filename - not the document - is
// the authority on the id.
//
// The caller must ensure the program is not loaded in the executor; this
// replaces the map value a `const rt::Program *` may point into.
UpdateResult update_uploaded(int32_t id, const char *json, size_t len);

// Deletes an uploaded program. Read-only (shipped) programs are refused, which
// is also what an unknown id gets.
bool remove(int32_t id);

}  // namespace programs
