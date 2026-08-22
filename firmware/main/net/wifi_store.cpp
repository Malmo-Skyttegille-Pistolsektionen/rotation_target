#include "wifi_store.h"

#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"

namespace wifi_store {
namespace {

const char *TAG = "wifi_store";
constexpr const char *kNamespace = "rotation";
constexpr const char *kSsidKey = "wifi_ssid";
constexpr const char *kPassKey = "wifi_pass";

bool read_key(nvs_handle_t handle, const char *key, std::string &out) {
  size_t len = 0;
  if (nvs_get_str(handle, key, nullptr, &len) != ESP_OK || len == 0) return false;

  out.resize(len);
  if (nvs_get_str(handle, key, &out[0], &len) != ESP_OK) return false;
  // nvs_get_str counts the NUL; std::string tracks length itself.
  out.resize(len > 0 ? len - 1 : 0);
  return true;
}

}  // namespace

Credentials load() {
  Credentials out{CONFIG_RT_WIFI_SSID, CONFIG_RT_WIFI_PASSWORD};

  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READONLY, &handle) != ESP_OK) return out;

  std::string ssid;
  if (read_key(handle, kSsidKey, ssid) && !ssid.empty()) {
    out.ssid = ssid;
    // A saved network may legitimately be open, so an absent password key is
    // not a reason to fall back to the compiled-in one.
    std::string password;
    out.password = read_key(handle, kPassKey, password) ? password : "";
    ESP_LOGI(TAG, "Using provisioned network '%s'", out.ssid.c_str());
  }

  nvs_close(handle);
  return out;
}

namespace {

// "changeme" is the Kconfig default and means "nothing configured here".
bool is_set(const std::string &ssid) { return !ssid.empty() && ssid != "changeme"; }

void append_unique(std::vector<Credentials> &out, const Credentials &candidate) {
  if (!is_set(candidate.ssid)) return;
  for (const auto &existing : out) {
    if (existing.ssid == candidate.ssid) return;
  }
  out.push_back(candidate);
}

}  // namespace

std::vector<Credentials> load_all() {
  std::vector<Credentials> out;

  // The provisioned network first: it is the most recent human decision about
  // where this device lives, and at a new site it is the only one that can be
  // right.
  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READONLY, &handle) == ESP_OK) {
    std::string ssid;
    if (read_key(handle, kSsidKey, ssid) && !ssid.empty()) {
      std::string password;
      append_unique(out, {ssid, read_key(handle, kPassKey, password) ? password : ""});
    }
    nvs_close(handle);
  }

  append_unique(out, {CONFIG_RT_WIFI_SSID, CONFIG_RT_WIFI_PASSWORD});
  append_unique(out, {CONFIG_RT_WIFI_SSID_2, CONFIG_RT_WIFI_PASSWORD_2});

  ESP_LOGI(TAG, "%d network(s) to try", static_cast<int>(out.size()));
  return out;
}

bool save(const std::string &ssid, const std::string &password) {
  if (ssid.empty()) return false;

  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) return false;

  bool ok = nvs_set_str(handle, kSsidKey, ssid.c_str()) == ESP_OK &&
            nvs_set_str(handle, kPassKey, password.c_str()) == ESP_OK &&
            nvs_commit(handle) == ESP_OK;
  nvs_close(handle);

  ESP_LOGI(TAG, "%s network '%s'", ok ? "Saved" : "Failed to save", ssid.c_str());
  return ok;
}

bool clear() {
  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) return false;

  nvs_erase_key(handle, kSsidKey);
  nvs_erase_key(handle, kPassKey);
  const bool ok = nvs_commit(handle) == ESP_OK;
  nvs_close(handle);
  return ok;
}

bool provisioned() {
  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READONLY, &handle) != ESP_OK) return false;

  std::string ssid;
  const bool found = read_key(handle, kSsidKey, ssid) && !ssid.empty();
  nvs_close(handle);
  return found;
}

}  // namespace wifi_store
