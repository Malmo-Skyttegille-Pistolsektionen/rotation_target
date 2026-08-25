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
// Set by forget(), cleared by save(). See the header for why erasing the
// credential keys alone does not forget a network.
constexpr const char *kNoSeedsKey = "wifi_noseeds";

bool read_key(nvs_handle_t handle, const char *key, std::string &out) {
  size_t len = 0;
  if (nvs_get_str(handle, key, nullptr, &len) != ESP_OK || len == 0) return false;

  out.resize(len);
  if (nvs_get_str(handle, key, &out[0], &len) != ESP_OK) return false;
  // nvs_get_str counts the NUL; std::string tracks length itself.
  out.resize(len > 0 ? len - 1 : 0);
  return true;
}

// "changeme" is the Kconfig default and means "nothing configured here".
bool is_set(const std::string &ssid) {
  return !ssid.empty() && ssid != "changeme";
}

bool seeds_suppressed() {
  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READONLY, &handle) != ESP_OK) return false;
  uint8_t flag = 0;
  const bool set = nvs_get_u8(handle, kNoSeedsKey, &flag) == ESP_OK && flag != 0;
  nvs_close(handle);
  return set;
}

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

  // A device that was asked to forget its networks must not fall back onto the
  // one the image was built for - see forget() in the header.
  if (seeds_suppressed()) {
    ESP_LOGI(TAG, "Seed networks suppressed by a factory reset");
  } else {
    append_unique(out, {CONFIG_RT_WIFI_SSID, CONFIG_RT_WIFI_PASSWORD});
    append_unique(out, {CONFIG_RT_WIFI_SSID_2, CONFIG_RT_WIFI_PASSWORD_2});
  }

  ESP_LOGI(TAG, "%d network(s) to try", static_cast<int>(out.size()));
  return out;
}

bool save(const std::string &ssid, const std::string &password) {
  if (ssid.empty()) return false;

  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) return false;

  // The seeds come back with a successful provisioning: the device now has a
  // network of its own, so the build's network is a harmless second choice
  // again rather than the thing the reset was trying to escape.
  nvs_erase_key(handle, kNoSeedsKey);
  bool ok = nvs_set_str(handle, kSsidKey, ssid.c_str()) == ESP_OK &&
            nvs_set_str(handle, kPassKey, password.c_str()) == ESP_OK &&
            nvs_commit(handle) == ESP_OK;
  nvs_close(handle);

  ESP_LOGI(TAG, "%s network '%s'", ok ? "Saved" : "Failed to save", ssid.c_str());
  return ok;
}

bool forget() {
  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) return false;

  nvs_erase_key(handle, kSsidKey);
  nvs_erase_key(handle, kPassKey);
  const bool ok = nvs_set_u8(handle, kNoSeedsKey, 1) == ESP_OK && nvs_commit(handle) == ESP_OK;
  nvs_close(handle);

  ESP_LOGW(TAG, "%s every stored and compiled-in network", ok ? "Forgot" : "Failed to forget");
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
