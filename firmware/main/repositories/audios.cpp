#include "audios.h"

#include <ArduinoJson.h>

#include <cstdio>

#include "config.h"
#include "esp_log.h"
#include "json_util.h"
#include "storage.h"

namespace audios {
namespace {

const char *TAG = "audios";
std::map<int32_t, Audio> s_audios;

std::string index_path(const char *dir) {
  return std::string(dir) + "/audios.json";
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

// The index is an object keyed by id ("1": {...}), which is what the resources
// repository ships. A JSON array of entries carrying their own "id" is also
// accepted, matching the MicroPython loader.
void load_index(const char *dir, bool readonly) {
  std::string json;
  if (!read_file(index_path(dir), json)) {
    ESP_LOGD(TAG, "No audio index at %s", dir);
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, json) != DeserializationError::Ok) {
    ESP_LOGW(TAG, "Malformed audio index at %s", dir);
    return;
  }

  int loaded = 0;
  auto add = [&](int32_t id, JsonObjectConst entry) {
    const char *filename = entry["filename"] | "";
    if (filename[0] == '\0') return;

    Audio audio;
    audio.id = id;
    audio.title = entry["title"] | "";
    audio.path = std::string(dir) + "/" + filename;
    audio.readonly = readonly;
    s_audios[id] = audio;
    loaded++;
  };

  if (doc.is<JsonObjectConst>()) {
    for (JsonPairConst kv : doc.as<JsonObjectConst>()) {
      add(static_cast<int32_t>(strtol(kv.key().c_str(), nullptr, 10)),
          kv.value().as<JsonObjectConst>());
    }
  } else if (doc.is<JsonArrayConst>()) {
    for (JsonObjectConst entry : doc.as<JsonArrayConst>()) {
      add(entry["id"] | 0, entry);
    }
  }

  ESP_LOGI(TAG, "Loaded %d audio entries from %s", loaded, dir);
}

bool write_upload_index() {
  std::string out = "{";
  bool first = true;
  for (const auto &kv : s_audios) {
    if (kv.second.readonly) continue;
    if (!first) out += ',';
    first = false;

    // Only the bare filename goes in the index; the directory is implied by
    // where the index lives, which is what makes the tree relocatable.
    const std::string &path = kv.second.path;
    const size_t slash = path.find_last_of('/');
    const std::string filename = slash == std::string::npos ? path : path.substr(slash + 1);

    out += rt::json_quote(std::to_string(kv.first));
    out += ":{\"title\":";
    out += rt::json_quote(kv.second.title);
    out += ",\"filename\":";
    out += rt::json_quote(filename);
    out += '}';
  }
  out += '}';

  storage::make_dirs(kUploadAudioDir);
  FILE *f = fopen(index_path(kUploadAudioDir).c_str(), "wb");
  if (f == nullptr) return false;
  const size_t written = fwrite(out.data(), 1, out.size(), f);
  fclose(f);
  return written == out.size();
}

}  // namespace

void load_all() {
  s_audios.clear();
  load_index(kShippedAudioDir, true);
  load_index(kUploadAudioDir, false);
  ESP_LOGI(TAG, "Total audios: %u", static_cast<unsigned>(s_audios.size()));
}

const Audio *get(int32_t id) {
  auto it = s_audios.find(id);
  return it == s_audios.end() ? nullptr : &it->second;
}

const std::map<int32_t, Audio> &all() {
  return s_audios;
}

std::vector<std::string> paths_for(const std::vector<int32_t> &ids) {
  std::vector<std::string> paths;
  paths.reserve(ids.size());
  for (int32_t id : ids) {
    const Audio *audio = get(id);
    if (audio != nullptr) {
      paths.push_back(audio->path);
    } else {
      ESP_LOGD(TAG, "Audio id %d not found", static_cast<int>(id));
    }
  }
  return paths;
}

std::string list_json() {
  std::string out = "{\"audios\":[";
  bool first = true;
  for (const auto &kv : s_audios) {
    if (!first) out += ',';
    first = false;
    out += "{\"id\":";
    out += std::to_string(kv.second.id);
    out += ",\"title\":";
    out += rt::json_quote(kv.second.title);
    out += ",\"filename\":";
    out += rt::json_quote(kv.second.path);
    out += ",\"readonly\":";
    out += kv.second.readonly ? "true" : "false";
    out += '}';
  }
  out += "]}";
  return out;
}

int32_t add_uploaded(const std::string &title, const std::string &filename) {
  int32_t id = kFirstUploadId;
  while (s_audios.count(id) > 0) id++;

  Audio audio;
  audio.id = id;
  audio.title = title;
  audio.path = std::string(kUploadAudioDir) + "/" + filename;
  audio.readonly = false;
  s_audios[id] = audio;

  if (!write_upload_index()) {
    s_audios.erase(id);
    ESP_LOGE(TAG, "Could not rewrite the upload index");
    return -1;
  }
  return id;
}

bool remove(int32_t id) {
  auto it = s_audios.find(id);
  if (it == s_audios.end() || it->second.readonly) return false;

  ::remove(it->second.path.c_str());
  s_audios.erase(it);
  write_upload_index();
  return true;
}

}  // namespace audios
