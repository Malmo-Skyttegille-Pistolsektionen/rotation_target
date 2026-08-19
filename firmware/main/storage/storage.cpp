#include "storage.h"

#include <sys/stat.h>

#include <cerrno>
#include <cstring>
#include <string>

#include "config.h"
#include "esp_littlefs.h"
#include "esp_log.h"

namespace storage {
namespace {
const char *TAG = "storage";
}

bool make_dirs(const char *path) {
  std::string current;
  const char *p = path;
  // Leading '/' is part of the mount point, not a component to create.
  if (*p == '/') {
    current = "/";
    p++;
  }

  while (*p != '\0') {
    const char *slash = strchr(p, '/');
    const size_t len = slash ? static_cast<size_t>(slash - p) : strlen(p);
    if (len > 0) {
      if (current.size() > 1) current += '/';
      current.append(p, len);
      if (mkdir(current.c_str(), 0777) != 0 && errno != EEXIST) {
        ESP_LOGE(TAG, "mkdir %s failed: %s", current.c_str(), strerror(errno));
        return false;
      }
    }
    if (!slash) break;
    p = slash + 1;
  }
  return true;
}

bool init() {
  esp_vfs_littlefs_conf_t conf = {};
  conf.base_path = kStorageMount;
  conf.partition_label = "storage";
  // The image is built and flashed with the firmware (see the root
  // CMakeLists), so a failure to mount means the flash is damaged or the
  // partition table changed - reformatting would silently discard the shipped
  // audio and programs, which is worse than refusing to come up.
  conf.format_if_mount_failed = false;
  conf.dont_mount = false;

  esp_err_t err = esp_vfs_littlefs_register(&conf);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Failed to mount LittleFS: %s", esp_err_to_name(err));
    return false;
  }

  size_t total = 0, used = 0;
  if (esp_littlefs_info(conf.partition_label, &total, &used) == ESP_OK) {
    ESP_LOGI(TAG, "LittleFS mounted at %s: %u KB used of %u KB", kStorageMount,
             static_cast<unsigned>(used / 1024), static_cast<unsigned>(total / 1024));
  }

  make_dirs(kUploadAudioDir);
  make_dirs(kUploadProgramDir);
  return true;
}

}  // namespace storage
