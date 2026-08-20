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

// Deletes an uploaded program. Read-only (shipped) programs are refused, which
// is also what an unknown id gets.
bool remove(int32_t id);

}  // namespace programs
