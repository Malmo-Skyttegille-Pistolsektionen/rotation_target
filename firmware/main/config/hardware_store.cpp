#include "hardware_store.h"

#include <cstring>

#include "config.h"
#include "esp_log.h"
#include "nvs.h"
#include "sdkconfig.h"

namespace hardware_store {
namespace {

const char *TAG = "hw_store";

// The same namespace `wifi_store` writes to, so one `nvs` partition holds all
// of the device's provisioning rather than two.
constexpr const char *kNamespace = "rotation";

// NVS keys are capped at 15 characters, which is why these are abbreviated
// rather than spelled out.
constexpr const char *kGpioKey = "hw_tgt_gpio";
constexpr const char *kActiveLowKey = "hw_tgt_alow";
constexpr const char *kHostnameKey = "hw_hostname";
constexpr const char *kDisplayNameKey = "hw_disp_name";

rt::HardwareConfig s_current;
bool s_overridden = false;

bool read_str(nvs_handle_t handle, const char *key, std::string &out) {
  size_t len = 0;
  if (nvs_get_str(handle, key, nullptr, &len) != ESP_OK || len == 0) return false;

  out.resize(len);
  if (nvs_get_str(handle, key, &out[0], &len) != ESP_OK) return false;
  // nvs_get_str counts the NUL; std::string tracks its own length.
  out.resize(len > 0 ? len - 1 : 0);
  return true;
}

}  // namespace

rt::HardwareConfig defaults() {
  rt::HardwareConfig config;
  config.target_gpio = CONFIG_RT_TARGET_GPIO;
#if CONFIG_RT_TARGET_ACTIVE_LOW
  config.target_active_low = true;
#else
  config.target_active_low = false;
#endif
  config.hostname = CONFIG_RT_HOSTNAME;
  // No compiled default: a device that has never been named has no name to
  // show, and inventing one would put the same string on every device.
  config.display_name = "";
  return config;
}

namespace {

// The compiled defaults with whatever NVS currently holds laid over them.
// Returns whether anything was overlaid.
//
// Per key, not all-or-nothing: a device configured before a firmware update
// added a key picks up the new key's compiled default rather than losing the
// values it already had.
bool overlay_from_nvs(rt::HardwareConfig &out) {
  bool found = false;

  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READONLY, &handle) != ESP_OK) return false;

  int32_t gpio = 0;
  if (nvs_get_i32(handle, kGpioKey, &gpio) == ESP_OK) {
    out.target_gpio = gpio;
    found = true;
  }

  int8_t active_low = 0;
  if (nvs_get_i8(handle, kActiveLowKey, &active_low) == ESP_OK) {
    out.target_active_low = active_low != 0;
    found = true;
  }

  std::string text;
  if (read_str(handle, kHostnameKey, text)) {
    out.hostname = text;
    found = true;
  }
  if (read_str(handle, kDisplayNameKey, text)) {
    out.display_name = text;
    found = true;
  }

  nvs_close(handle);
  return found;
}

}  // namespace

rt::HardwareConfig saved() {
  // Re-read rather than served from the cache: between a write and the restart
  // that adopts it, this is the only thing that knows what the device has been
  // told. That gap is exactly what `restartRequired` reports.
  rt::HardwareConfig out = defaults();
  overlay_from_nvs(out);
  // A stored value this build refuses is reported as the default it will
  // actually boot on, matching init()'s fallback - so the API never claims the
  // device is about to use something it would reject.
  if (rt::validate(out) != rt::ConfigRefusal::kNone) return defaults();
  return out;
}

void init() {
  s_current = defaults();
  s_overridden = overlay_from_nvs(s_current);

  // A configuration written by an older firmware, or corrupted in place, must
  // not brick the device: fall back rather than driving a pin this build does
  // not consider safe.
  const rt::ConfigRefusal refusal = rt::validate(s_current);
  if (refusal != rt::ConfigRefusal::kNone) {
    ESP_LOGE(TAG, "Stored configuration refused (%s); using compiled defaults",
             rt::refusal_message(refusal));
    s_current = defaults();
    s_overridden = false;
    return;
  }

  if (s_overridden) {
    ESP_LOGI(TAG, "Hardware configuration from NVS: gpio=%d active_low=%d hostname=%s",
             static_cast<int>(s_current.target_gpio), s_current.target_active_low ? 1 : 0,
             s_current.hostname.c_str());
  }
}

const rt::HardwareConfig &current() {
  return s_current;
}

bool overridden() {
  // Re-read, like saved(), rather than answering from the boot cache. This
  // means "NVS holds an override right now", so a save made since boot counts -
  // the cached flag would answer for the configuration the device came up on
  // and report false immediately after a successful write.
  rt::HardwareConfig probe = defaults();
  return overlay_from_nvs(probe);
}

rt::ConfigRefusal save(const rt::HardwareConfig &config) {
  const rt::ConfigRefusal refusal = rt::validate(config);
  if (refusal != rt::ConfigRefusal::kNone) return refusal;

  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) {
    ESP_LOGE(TAG, "Could not open NVS for writing");
    return rt::ConfigRefusal::kNone;
  }

  nvs_set_i32(handle, kGpioKey, config.target_gpio);
  nvs_set_i8(handle, kActiveLowKey, config.target_active_low ? 1 : 0);
  nvs_set_str(handle, kHostnameKey, config.hostname.c_str());
  nvs_set_str(handle, kDisplayNameKey, config.display_name.c_str());
  nvs_commit(handle);
  nvs_close(handle);

  // The cache is deliberately not updated. Everything that reads it latched its
  // value at boot - the GPIO is configured once, mDNS is registered once - so
  // moving `current()` now would make the API report a device that does not
  // exist until it restarts.
  ESP_LOGI(TAG, "Hardware configuration saved; takes effect on restart");
  return rt::ConfigRefusal::kNone;
}

bool reset() {
  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) return false;

  // Erased individually rather than with nvs_erase_all: the namespace is shared
  // with wifi_store, and taking the WiFi credentials out with the pin mapping
  // would turn "undo my hardware change" into "and now find the setup portal".
  for (const char *key : {kGpioKey, kActiveLowKey, kHostnameKey, kDisplayNameKey}) {
    const esp_err_t err = nvs_erase_key(handle, key);
    if (err != ESP_OK && err != ESP_ERR_NVS_NOT_FOUND) {
      nvs_close(handle);
      return false;
    }
  }
  nvs_commit(handle);
  nvs_close(handle);

  ESP_LOGW(TAG, "Hardware configuration reset to compiled defaults; takes effect on restart");
  return true;
}

}  // namespace hardware_store
