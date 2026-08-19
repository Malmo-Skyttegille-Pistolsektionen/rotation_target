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

// Register an already-saved upload under the next free id. Returns -1 if the
// index could not be rewritten.
int32_t add_uploaded(const std::string &title, const std::string &filename);

bool remove(int32_t id);

}  // namespace audios
