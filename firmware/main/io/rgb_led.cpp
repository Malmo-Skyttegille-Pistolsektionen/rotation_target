#include "config/hardware_store.h"
#include "rgb_led.h"

#include "config.h"
#include "esp_log.h"
#include "sdkconfig.h"

#if CONFIG_RT_RGB_LED_ENABLED
#include "led_strip.h"
#endif

namespace rgb_led {

#if !CONFIG_RT_RGB_LED_ENABLED

// The board has no addressable LED - a bare ESP32-S3-WROOM module does not
// carry one, unlike the DevKitC-1. Every call is a no-op rather than a driver
// failure logged on each boot; the same status is in the serial log and in
// GET /api/v2/diagnostics/info.
void init() {}
void set(uint8_t, uint8_t, uint8_t) {}
void off() {}
void status_joining() {}
void status_offline() {}
void status_online() {}
void status_serving() {}
void status_portal() {}

#else

namespace {
const char *TAG = "rgb_led";
led_strip_handle_t s_strip = nullptr;
}  // namespace

void init() {
  led_strip_config_t strip_cfg = {};
  // From the store, not config.h: the LED's pin is configurable (#144).
  strip_cfg.strip_gpio_num = hardware_store::current().led_gpio;
  strip_cfg.max_leds = 1;
  strip_cfg.led_model = LED_MODEL_WS2812;
  strip_cfg.color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB;

  led_strip_rmt_config_t rmt_cfg = {};
  rmt_cfg.clk_src = RMT_CLK_SRC_DEFAULT;
  rmt_cfg.resolution_hz = 10 * 1000 * 1000;

  esp_err_t err = led_strip_new_rmt_device(&strip_cfg, &rmt_cfg, &s_strip);
  if (err != ESP_OK) {
    // A missing status LED must never stop the device serving; every call
    // below no-ops from here.
    ESP_LOGW(TAG, "LED strip unavailable (%s) - status LED disabled", esp_err_to_name(err));
    s_strip = nullptr;
    return;
  }
  off();
}

void set(uint8_t r, uint8_t g, uint8_t b) {
  if (s_strip == nullptr) return;
  led_strip_set_pixel(s_strip, 0, r, g, b);
  led_strip_refresh(s_strip);
}

// Kept dim deliberately: the device sits on a shooting range in the dark and a
// full-brightness LED is a distraction downrange.
void off() {
  set(0, 0, 0);
}

namespace {
void red() {
  set(100, 0, 0);
}
void green() {
  set(0, 10, 0);
}
void yellow() {
  set(60, 60, 0);
}
void blue() {
  set(0, 0, 60);
}

// Latched rather than asked of the server, so the policy stays here and the
// LED does not depend on the web server's lifetime.
bool s_serving = false;
}  // namespace

void status_joining() {
  // Starts false so the first call - app_main, before any join attempt - lands
  // on red rather than off. Getting this backwards leaves the device dark for
  // the whole of boot, which reads as "no power".
  static bool on = false;
  on = !on;
  if (on) {
    red();
  } else {
    off();
  }
}

void status_offline() {
  red();
}

void status_online() {
  if (s_serving) {
    green();
  } else {
    yellow();
  }
}

void status_serving() {
  s_serving = true;
  green();
}

void status_portal() {
  blue();
}

#endif  // CONFIG_RT_RGB_LED_ENABLED

}  // namespace rgb_led
