#include "audios.h"

#include <ArduinoJson.h>

#include <cstdio>

#include "audio.h"
#include "backend_issue.h"
#include "config.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "id_range.h"
#include "json_util.h"
#include "sse_hub.h"
#include "storage.h"

namespace audios {
namespace {

const char *TAG = "audios";
std::map<int32_t, Audio> s_audios;

// The run loop reads this map (Executor -> play_audios -> paths_for) while the
// httpd task uploads and deletes. std::map rebalances on insert and frees the
// node on erase, so an unsynchronised concurrent traversal is a use-after-free.
SemaphoreHandle_t s_lock = nullptr;

struct Lock {
  Lock() {
    if (s_lock != nullptr) xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
  }
  ~Lock() {
    if (s_lock != nullptr) xSemaphoreGiveRecursive(s_lock);
  }
};

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

    // Shipped loads before uploads (see load_all()), so an existing entry
    // here can only be shipped. #129: the two ranges are meant to be
    // disjoint (kFirstUploadId in config.h); if they are not, keep the
    // shipped clip rather than let the upload silently replace it.
    auto existing = s_audios.find(id);
    if (existing != s_audios.end() &&
        rt::would_shadow_shipped(existing->second.readonly, readonly)) {
      ESP_LOGW(TAG, "Audio %d in %s collides with a shipped clip; keeping the shipped one",
               static_cast<int>(id), dir);
      sse_hub::broadcast_issue(rt::issue_code::kAudioIdCollision,
                               "An uploaded audio clip's id collides with a shipped one; the "
                               "shipped clip was kept",
                               {{"file", index_path(dir)}});
      return;
    }

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
  // Created here rather than lazily: load_all() runs in app_main before the
  // run loop or the HTTP server exist, so there is no race to create it.
  if (s_lock == nullptr) s_lock = xSemaphoreCreateRecursiveMutex();

  Lock lock;
  s_audios.clear();
  load_index(kShippedAudioDir, true);
  load_index(kUploadAudioDir, false);
  ESP_LOGI(TAG, "Total audios: %u", static_cast<unsigned>(s_audios.size()));
}

const Audio *get(int32_t id) {
  Lock lock;
  auto it = s_audios.find(id);
  return it == s_audios.end() ? nullptr : &it->second;
}

const std::map<int32_t, Audio> &all() {
  return s_audios;
}

std::vector<std::string> paths_for(const std::vector<int32_t> &ids) {
  Lock lock;
  std::vector<std::string> paths;
  paths.reserve(ids.size());
  for (int32_t id : ids) {
    auto it = s_audios.find(id);
    if (it != s_audios.end()) {
      // Copied, not referenced: the caller uses these after the lock is gone.
      paths.push_back(it->second.path);
    } else {
      ESP_LOGD(TAG, "Audio id %d not found", static_cast<int>(id));
    }
  }
  return paths;
}

std::string list_json() {
  Lock lock;
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

int32_t add_uploaded(const std::string &title, const std::string &staged_path) {
  Lock lock;

  const int32_t id = rt::next_free_id(
      kFirstUploadId, [](int32_t candidate) { return s_audios.count(candidate) > 0; });

  const std::string final_path = std::string(kUploadAudioDir) + "/" + std::to_string(id) + ".wav";
  if (rename(staged_path.c_str(), final_path.c_str()) != 0) {
    ESP_LOGE(TAG, "Could not move %s to %s", staged_path.c_str(), final_path.c_str());
    return -1;
  }

  Audio audio;
  audio.id = id;
  audio.title = title;
  audio.path = final_path;
  audio.readonly = false;
  s_audios[id] = audio;

  if (!write_upload_index()) {
    s_audios.erase(id);
    // Rolling the upload back. A failure here leaves a clip on flash that no
    // index mentions - invisible, and taking space that the next upload will
    // be told it does not have.
    if (::remove(final_path.c_str()) != 0) {
      ESP_LOGE(TAG, "Could not remove %s after a failed index write; it is now orphaned",
               final_path.c_str());
    }
    ESP_LOGE(TAG, "Could not rewrite the upload index");
    return -1;
  }
  return id;
}

RemoveResult remove(int32_t id) {
  Lock lock;

  auto it = s_audios.find(id);
  if (it == s_audios.end() || it->second.readonly) return RemoveResult::kNotFound;

  // LittleFS has no unlink-while-open, so deleting the clip the audio task is
  // reading corrupts the read rather than deferring the unlink.
  if (audio::is_playing(it->second.path)) return RemoveResult::kPlaying;

  // Said out loud rather than ignored: the entry goes from the map either way -
  // leaving it would list a clip the client has been told is gone - so a failed
  // unlink means a file on flash that nothing will ever reference or clean up.
  if (::remove(it->second.path.c_str()) != 0) {
    ESP_LOGE(TAG, "Deleted audio %d from the index but could not remove %s; it is now orphaned",
             static_cast<int>(id), it->second.path.c_str());
  }
  s_audios.erase(it);

  if (!write_upload_index()) {
    // The file is gone but the index still lists it, so the entry would come
    // back on the next boot pointing at nothing. Nothing to roll back to -
    // say so loudly rather than reporting success.
    ESP_LOGE(TAG, "Deleted audio %d but could not rewrite the index", static_cast<int>(id));
  }
  return RemoveResult::kOk;
}

}  // namespace audios
