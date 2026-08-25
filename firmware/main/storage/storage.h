#pragma once

// LittleFS on the `userdata` partition: uploaded programs and clips, and
// nothing else.
//
// The shipped content is in the app image (#227), so **no update path writes
// this partition** - not a guarded write, no write. That is why it is a
// partition of its own rather than a directory beside the shipped files, and
// why `idf.py flash` no longer destroys uploads.
namespace storage {

// Mounts the partition and creates the upload directories. Returns false if
// the partition could not be mounted, in which case nothing else here works.
bool init();

// mkdir -p, tolerating components that already exist.
bool make_dirs(const char *path);

}  // namespace storage
