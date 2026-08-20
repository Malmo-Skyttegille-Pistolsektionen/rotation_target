#pragma once

#include <map>
#include <string>
#include <vector>

// The audio clips the device can play: those flashed with the firmware
// (read-only) and those uploaded to it.
namespace audios {

struct Audio {
  int32_t id = 0;
  std::string title;
  // Absolute path on the LittleFS mount. Also what the API reports as
  // `filename`, matching the MicroPython backend, which joined the directory
  // into the value the same way.
  std::string path;
  bool readonly = false;
};

void load_all();

const Audio *get(int32_t id);

const std::map<int32_t, Audio> &all();

// Resolve audio ids to playable paths, skipping ids that do not exist.
std::vector<std::string> paths_for(const std::vector<int32_t> &ids);

std::string list_json();

// Claims the next free id for an upload staged at `staged_path`, renaming it to
// the id-derived name and registering it. Returns -1 on failure, leaving the
// staged file for the caller to clean up.
//
// The stored name is derived from the id rather than taken from the client:
// a client-supplied name could collide with the repository's own audios.json
// index (destroying it), or with an existing clip (leaving two ids sharing one
// file, so deleting either broke the other).
int32_t add_uploaded(const std::string &title, const std::string &staged_path);

enum class RemoveResult { kOk, kNotFound, kPlaying };

RemoveResult remove(int32_t id);

}  // namespace audios
