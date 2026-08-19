#include "programs.h"

#include <dirent.h>

#include <cstdio>
#include <cstring>

#include "config.h"
#include "esp_log.h"
#include "storage.h"

namespace programs {
namespace {

const char *TAG = "programs";
std::map<int32_t, rt::Program> s_programs;

std::string path_for(const char *dir, int32_t id) {
  return std::string(dir) + "/" + std::to_string(id) + ".json";
}

bool read_file(const std::string &path, std::string &out) {
  FILE *f = fopen(path.c_str(), "rb");
  if (f == nullptr) return false;

  fseek(f, 0, SEEK_END);
  const long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  if (size <= 0 || static_cast<size_t>(size) > kMaxUploadBytes) {
    fclose(f);
    return false;
  }

  out.resize(static_cast<size_t>(size));
  const size_t got = fread(&out[0], 1, out.size(), f);
  fclose(f);
  out.resize(got);
  return got > 0;
}

void load_dir(const char *dir, bool readonly) {
  DIR *d = opendir(dir);
  if (d == nullptr) {
    ESP_LOGD(TAG, "No program directory at %s", dir);
    return;
  }

  int loaded = 0;
  while (dirent *entry = readdir(d)) {
    int32_t id = 0;
    if (!rt::parse_program_filename(entry->d_name, id)) continue;

    std::string json;
    if (!read_file(std::string(dir) + "/" + entry->d_name, json)) {
      ESP_LOGW(TAG, "Could not read %s/%s", dir, entry->d_name);
      continue;
    }

    rt::Program program;
    if (!rt::parse_program(json, readonly, program)) {
      ESP_LOGW(TAG, "Malformed program %s/%s", dir, entry->d_name);
      continue;
    }
    // The filename is the authority on the id, not the document: that is what
    // keeps delete (which removes `<id>.json`) consistent with the store.
    program.id = id;
    s_programs[id] = program;
    loaded++;
  }
  closedir(d);
  ESP_LOGI(TAG, "Loaded %d program(s) from %s", loaded, dir);
}

}  // namespace

void load_all() {
  s_programs.clear();
  load_dir(kShippedProgramDir, true);
  load_dir(kUploadProgramDir, false);
  ESP_LOGI(TAG, "Total programs: %u", static_cast<unsigned>(s_programs.size()));
}

const rt::Program *get(int32_t id) {
  auto it = s_programs.find(id);
  return it == s_programs.end() ? nullptr : &it->second;
}

const std::map<int32_t, rt::Program> &all() {
  return s_programs;
}

int32_t add_uploaded(const char *json, size_t len) {
  rt::Program program;
  if (!rt::parse_program(json, len, false, program)) {
    ESP_LOGW(TAG, "Rejected malformed upload");
    return -1;
  }

  int32_t id = kFirstUploadId;
  while (s_programs.count(id) > 0) id++;
  program.id = id;

  // The document is rewritten from the parsed program rather than stored
  // verbatim, so the persisted id is the assigned one and the file cannot
  // carry fields that would come back differently on the next boot.
  const std::string serialized = rt::program_json(program);
  const std::string path = path_for(kUploadProgramDir, id);

  storage::make_dirs(kUploadProgramDir);
  FILE *f = fopen(path.c_str(), "wb");
  if (f == nullptr) {
    ESP_LOGE(TAG, "Cannot write %s", path.c_str());
    return -1;
  }
  const size_t written = fwrite(serialized.data(), 1, serialized.size(), f);
  fclose(f);
  if (written != serialized.size()) {
    ESP_LOGE(TAG, "Short write for %s", path.c_str());
    // ::remove, not remove: unqualified lookup finds programs::remove(int32_t)
    // in the enclosing namespace and stops there, so <cstdio>'s remove is never
    // considered. It also returns false immediately, because the program is not
    // inserted into s_programs until below - so the truncated file was left on
    // flash and rescanned on every boot.
    ::remove(path.c_str());
    return -1;
  }

  s_programs[id] = program;
  ESP_LOGI(TAG, "Uploaded program %d", static_cast<int>(id));
  return id;
}

bool remove(int32_t id) {
  auto it = s_programs.find(id);
  if (it == s_programs.end() || it->second.readonly) return false;

  const std::string path = path_for(kUploadProgramDir, id);
  if (::remove(path.c_str()) != 0) {
    ESP_LOGW(TAG, "Could not delete %s", path.c_str());
    return false;
  }
  s_programs.erase(it);
  return true;
}

}  // namespace programs
