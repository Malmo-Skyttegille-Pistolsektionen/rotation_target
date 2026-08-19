#include "rgb_led.h"

#include "config.h"
#include "esp_log.h"
#include "led_strip.h"

namespace rgb_led {
namespace {

const char *TAG = "rgb_led";
led_strip_handle_t s_strip = nullptr;

}  // namespace

void init() {
  led_strip_config_t strip_cfg = {};
  strip_cfg.strip_gpio_num = kRgbLedPin;
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
void red() {
  set(100, 0, 0);
}
void green() {
  set(0, 10, 0);
}
void yellow() {
  set(255, 255, 0);
}

}  // namespace rgb_led
