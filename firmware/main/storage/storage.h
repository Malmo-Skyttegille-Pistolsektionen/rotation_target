#pragma once

// LittleFS on the `storage` partition: the shipped audio and programs flashed
// with the firmware, plus the writable half the REST API uploads into.
namespace storage {

// Mounts the partition and creates the upload directories. Returns false if
// the partition could not be mounted, in which case nothing else here works.
bool init();

// mkdir -p, tolerating components that already exist.
bool make_dirs(const char *path);

}  // namespace storage
