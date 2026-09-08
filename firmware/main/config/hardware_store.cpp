#include "hardware_store.h"

#include <cstdio>
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
//
// The two `hw_tgt_*` keys are the pre-bank layout (#144). Nothing writes them
// any more; they are read once, to build bank A on a device configured before
// #207, and erased by the next save.
constexpr const char *kLegacyGpioKey = "hw_tgt_gpio";
constexpr const char *kLegacyActiveLowKey = "hw_tgt_alow";
constexpr const char *kBankCountKey = "hw_bank_cnt";
constexpr const char *kHostnameKey = "hw_hostname";
constexpr const char *kDisplayNameKey = "hw_disp_name";
constexpr const char *kBootShownKey = "hw_boot_shown";
constexpr const char *kLedGpioKey = "hw_led_gpio";
constexpr const char *kI2sPortKey = "hw_i2s_port";
constexpr const char *kI2sBckKey = "hw_i2s_bck";
constexpr const char *kI2sWsKey = "hw_i2s_ws";
constexpr const char *kI2sDoutKey = "hw_i2s_dout";
constexpr const char *kHttpPortKey = "hw_http_port";
constexpr const char *kWifiRetryKey = "hw_wifi_retry";

rt::HardwareConfig s_current;
bool s_overridden = false;

// `hw_bk<i>_gpio`, `hw_bk<i>_alow`, `hw_bk<i>_name` - built rather than spelled
// out. Eleven characters at a single-digit index, inside NVS's cap of fifteen;
// the buffer is larger only so the compiler can see snprintf cannot truncate.
static_assert(rt::kMaxTargetBanks <= 10, "a two-digit bank index would need shorter key names");
struct BankKey {
  char text[24];

  BankKey(size_t bank, const char *suffix) {
    snprintf(text, sizeof(text), "hw_bk%u_%s", static_cast<unsigned>(bank), suffix);
  }
};

bool read_str(nvs_handle_t handle, const char *key, std::string &out) {
  size_t len = 0;
  if (nvs_get_str(handle, key, nullptr, &len) != ESP_OK || len == 0) return false;

  out.resize(len);
  if (nvs_get_str(handle, key, &out[0], &len) != ESP_OK) return false;
  // nvs_get_str counts the NUL; std::string tracks its own length.
  out.resize(len > 0 ? len - 1 : 0);
  return true;
}

// A key that was not there is already in the state the caller wanted.
bool erase_if_present(nvs_handle_t handle, const char *key) {
  const esp_err_t err = nvs_erase_key(handle, key);
  return err == ESP_OK || err == ESP_ERR_NVS_NOT_FOUND;
}

}  // namespace

rt::Peripherals peripherals() {
  rt::Peripherals present;
#if CONFIG_RT_AUDIO_ENABLED
  present.audio = true;
#else
  present.audio = false;
#endif
#if CONFIG_RT_RGB_LED_ENABLED
  present.led = true;
#else
  present.led = false;
#endif
  return present;
}

rt::HardwareConfig defaults() {
  rt::HardwareConfig config;
  // One bank, from the Kconfig the single target used to come from. A second
  // bank is something a device is told about, never something it ships with.
  config.banks.assign(1, rt::TargetBank{});
  config.banks[0].gpio = CONFIG_RT_TARGET_GPIO;
#if CONFIG_RT_TARGET_ACTIVE_LOW
  config.banks[0].active_low = true;
#else
  config.banks[0].active_low = false;
#endif
  config.hostname = CONFIG_RT_HOSTNAME;
#ifdef CONFIG_RT_TARGETS_HIDE_AT_BOOT
  config.targets_shown_at_boot = false;
#else
  config.targets_shown_at_boot = true;
#endif

  // Carried whether or not the peripheral is compiled in, so a value set on a
  // build that had it survives one that does not.
#if CONFIG_RT_RGB_LED_ENABLED
  config.led_gpio = CONFIG_RT_RGB_LED_GPIO;
#endif
#if CONFIG_RT_AUDIO_ENABLED
  config.i2s_port = CONFIG_RT_I2S_PORT;
  config.i2s_bck_gpio = CONFIG_RT_I2S_BCK_GPIO;
  config.i2s_ws_gpio = CONFIG_RT_I2S_WS_GPIO;
  config.i2s_dout_gpio = CONFIG_RT_I2S_DOUT_GPIO;
#endif
  config.http_port = CONFIG_RT_HTTP_PORT;
  // The QEMU profile builds without WiFi, so the symbol does not exist there.
  // The struct's own default stands in - nothing reads it on a build with no
  // radio to retry on.
#ifdef CONFIG_RT_WIFI_MAX_RETRIES
  config.wifi_max_retries = CONFIG_RT_WIFI_MAX_RETRIES;
#endif

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

  // The stored count sizes an allocation, so a value this build cannot support
  // is treated as absent rather than trusted. A device downgraded from a
  // firmware with more banks then comes up on the compiled default rather than
  // on a truncated version of what somebody configured.
  int32_t bank_count = 0;
  const bool has_banks = nvs_get_i32(handle, kBankCountKey, &bank_count) == ESP_OK &&
                         bank_count >= 1 && bank_count <= static_cast<int32_t>(rt::kMaxTargetBanks);

  std::string text;

  if (has_banks) {
    found = true;
    // resize, not assign: bank A keeps the compiled default underneath, and any
    // bank whose keys are missing lands on GPIO 0 - which validate() refuses,
    // so a half-written set falls back rather than driving an arbitrary pin.
    out.banks.resize(static_cast<size_t>(bank_count));
    for (size_t i = 0; i < out.banks.size(); i++) {
      int32_t gpio = 0;
      if (nvs_get_i32(handle, BankKey(i, "gpio").text, &gpio) == ESP_OK) out.banks[i].gpio = gpio;

      int8_t active_low = 0;
      if (nvs_get_i8(handle, BankKey(i, "alow").text, &active_low) == ESP_OK) {
        out.banks[i].active_low = active_low != 0;
      }

      if (read_str(handle, BankKey(i, "name").text, text)) out.banks[i].name = text;
    }
  } else {
    // No count key: a device configured before #207, or one that has never been
    // configured at all. Bank A comes from the pre-bank keys, per key, exactly
    // as it did - so an upgrade keeps the pin the club typed in.
    int32_t gpio = 0;
    if (nvs_get_i32(handle, kLegacyGpioKey, &gpio) == ESP_OK) {
      out.banks[0].gpio = gpio;
      found = true;
    }

    int8_t active_low = 0;
    if (nvs_get_i8(handle, kLegacyActiveLowKey, &active_low) == ESP_OK) {
      out.banks[0].active_low = active_low != 0;
      found = true;
    }
  }

  if (read_str(handle, kHostnameKey, text)) {
    out.hostname = text;
    found = true;
  }
  if (read_str(handle, kDisplayNameKey, text)) {
    out.display_name = text;
    found = true;
  }

  int8_t boot_shown = 0;
  if (nvs_get_i8(handle, kBootShownKey, &boot_shown) == ESP_OK) {
    out.targets_shown_at_boot = boot_shown != 0;
    found = true;
  }

  const struct {
    const char *key;
    int32_t *field;
  } pins[] = {
      {kLedGpioKey, &out.led_gpio},           {kI2sPortKey, &out.i2s_port},
      {kI2sBckKey, &out.i2s_bck_gpio},        {kI2sWsKey, &out.i2s_ws_gpio},
      {kI2sDoutKey, &out.i2s_dout_gpio},      {kHttpPortKey, &out.http_port},
      {kWifiRetryKey, &out.wifi_max_retries},
  };
  for (const auto &pin : pins) {
    int32_t value = 0;
    if (nvs_get_i32(handle, pin.key, &value) == ESP_OK) {
      *pin.field = value;
      found = true;
    }
  }

  nvs_close(handle);
  return found;
}

}  // namespace

namespace {

bool same_as(const rt::HardwareConfig &a, const rt::HardwareConfig &b) {
  return a.banks == b.banks && a.hostname == b.hostname && a.display_name == b.display_name &&
         a.targets_shown_at_boot == b.targets_shown_at_boot && a.led_gpio == b.led_gpio &&
         a.i2s_port == b.i2s_port && a.i2s_bck_gpio == b.i2s_bck_gpio &&
         a.i2s_ws_gpio == b.i2s_ws_gpio && a.i2s_dout_gpio == b.i2s_dout_gpio;
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
  if (rt::validate(out, peripherals()) != rt::ConfigRefusal::kNone) return defaults();
  return out;
}

void init() {
  s_current = defaults();
  s_overridden = overlay_from_nvs(s_current);

  // A configuration written by an older firmware, or corrupted in place, must
  // not brick the device: fall back rather than driving a pin this build does
  // not consider safe.
  rt::ValidationDetail detail;
  const rt::ConfigRefusal refusal = rt::validate(s_current, peripherals(), &detail);
  if (refusal != rt::ConfigRefusal::kNone) {
    ESP_LOGE(TAG, "Stored configuration refused (%s); using compiled defaults",
             rt::refusal_message(refusal, detail).c_str());
    s_current = defaults();
    s_overridden = false;
    return;
  }

  if (s_overridden) {
    ESP_LOGI(TAG,
             "Hardware configuration from NVS: %u bank(s), bank A gpio=%d active_low=%d, "
             "hostname=%s",
             static_cast<unsigned>(s_current.banks.size()),
             static_cast<int>(s_current.banks[0].gpio), s_current.banks[0].active_low ? 1 : 0,
             s_current.hostname.c_str());
  }
}

const rt::HardwareConfig &current() {
  return s_current;
}

bool overridden() {
  // "Differs from the compiled defaults", not "NVS holds a key".
  //
  // The two come apart: writing a value that happens to equal the default
  // leaves a key behind, and the key-presence reading then reports `true` with
  // nothing for a reset to undo - a UI marking overridden values would mark
  // none of them while claiming some. This is the reading the Settings page
  // needs, and the one that cannot be wrong.
  //
  // A future arm-on-first-write password (#144) wants a different signal
  // anyway: whether a password has been set, not whether configuration was
  // ever written. It should carry its own state rather than borrow this.
  return !same_as(saved(), defaults());
}

rt::ConfigRefusal save(const rt::HardwareConfig &config, rt::ValidationDetail *detail) {
  const rt::ConfigRefusal refusal = rt::validate(config, peripherals(), detail);
  if (refusal != rt::ConfigRefusal::kNone) return refusal;

  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) {
    ESP_LOGE(TAG, "Could not open NVS for writing");
    return rt::ConfigRefusal::kNone;
  }

  // `targets_shown_at_boot` is deliberately absent. This is the path an HTTP
  // request reaches, and that setting is serial-only (D-31, #144) - so it is
  // not written here *by construction*, rather than by every caller
  // remembering to strip it. save_boot_targets() is the only way in.
  nvs_set_i32(handle, kBankCountKey, static_cast<int32_t>(config.banks.size()));
  for (size_t i = 0; i < config.banks.size(); i++) {
    nvs_set_i32(handle, BankKey(i, "gpio").text, config.banks[i].gpio);
    nvs_set_i8(handle, BankKey(i, "alow").text, config.banks[i].active_low ? 1 : 0);
    nvs_set_str(handle, BankKey(i, "name").text, config.banks[i].name.c_str());
  }

  // Everything this save did not write, so nothing outlives it: the pre-bank
  // keys a migrated device still carries, and the banks a save that reduced the
  // count left behind. A stale `hw_bk3_gpio` would come back the moment the
  // count went up again, on a pin nobody chose.
  erase_if_present(handle, kLegacyGpioKey);
  erase_if_present(handle, kLegacyActiveLowKey);
  for (size_t i = config.banks.size(); i < rt::kMaxTargetBanks; i++) {
    erase_if_present(handle, BankKey(i, "gpio").text);
    erase_if_present(handle, BankKey(i, "alow").text);
    erase_if_present(handle, BankKey(i, "name").text);
  }

  nvs_set_str(handle, kHostnameKey, config.hostname.c_str());
  nvs_set_str(handle, kDisplayNameKey, config.display_name.c_str());
  nvs_set_i32(handle, kLedGpioKey, config.led_gpio);
  nvs_set_i32(handle, kI2sPortKey, config.i2s_port);
  nvs_set_i32(handle, kI2sBckKey, config.i2s_bck_gpio);
  nvs_set_i32(handle, kI2sWsKey, config.i2s_ws_gpio);
  nvs_set_i32(handle, kI2sDoutKey, config.i2s_dout_gpio);
  nvs_set_i32(handle, kHttpPortKey, config.http_port);
  nvs_set_i32(handle, kWifiRetryKey, config.wifi_max_retries);
  nvs_commit(handle);
  nvs_close(handle);

  // The cache is deliberately not updated. Everything that reads it latched its
  // value at boot - the GPIO is configured once, mDNS is registered once - so
  // moving `current()` now would make the API report a device that does not
  // exist until it restarts.
  ESP_LOGI(TAG, "Hardware configuration saved; takes effect on restart");
  return rt::ConfigRefusal::kNone;
}

bool save_boot_targets(bool shown) {
  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) {
    ESP_LOGE(TAG, "Could not open NVS for writing");
    return false;
  }
  nvs_set_i8(handle, kBootShownKey, shown ? 1 : 0);
  nvs_commit(handle);
  nvs_close(handle);

  // WARN, not INFO: this is the setting that decides what the targets do while
  // somebody may be standing downrange, so the boot record should carry it
  // whatever the log level is set to.
  ESP_LOGW(TAG, "Boot target state set to %s; takes effect on restart", shown ? "shown" : "hidden");
  return true;
}

bool reset() {
  nvs_handle_t handle;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) return false;

  // Erased individually rather than with nvs_erase_all: the namespace is shared
  // with wifi_store, and taking the WiFi credentials out with the pin mapping
  // would turn "undo my hardware change" into "and now find the setup portal".
  for (const char *key : {kLegacyGpioKey, kLegacyActiveLowKey, kBankCountKey, kHostnameKey,
                          kDisplayNameKey, kBootShownKey, kLedGpioKey, kI2sPortKey, kI2sBckKey,
                          kI2sWsKey, kI2sDoutKey, kHttpPortKey, kWifiRetryKey}) {
    if (!erase_if_present(handle, key)) {
      nvs_close(handle);
      return false;
    }
  }
  // Every bank the cap allows, not only the ones the current count covers - a
  // reset has to leave nothing behind whatever the device was configured for.
  for (size_t i = 0; i < rt::kMaxTargetBanks; i++) {
    for (const char *suffix : {"gpio", "alow", "name"}) {
      if (!erase_if_present(handle, BankKey(i, suffix).text)) {
        nvs_close(handle);
        return false;
      }
    }
  }
  nvs_commit(handle);
  nvs_close(handle);

  ESP_LOGW(TAG, "Hardware configuration reset to compiled defaults; takes effect on restart");
  return true;
}

}  // namespace hardware_store
