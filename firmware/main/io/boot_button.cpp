#include "boot_button.h"

#include <atomic>

#include "button_gesture.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace boot_button {
namespace {

const char *TAG = "boot_button";

// GPIO0 on every ESP32-S3 development board we use. Not configurable, and
// deliberately so: the hardware configuration (#144) refuses GPIO0 as an output
// precisely because it is strapping, so there is no world in which this moves
// while remaining the BOOT button.
constexpr gpio_num_t kPin = GPIO_NUM_0;

// The button pulls the pin to ground, so pressed is low.
constexpr int kPressedLevel = 0;

// Fast enough that a deliberate press is never missed, slow enough to be
// invisible: 50 samples a second on a pin nobody touches for weeks.
constexpr int kPollMs = 20;

// How long a press stays good for. Long enough to walk from the button to a
// phone and submit a form, short enough that a press nobody remembers making
// cannot authorise anything.
constexpr int64_t kPressValidMs = 60'000;

std::atomic<int64_t> s_last_press_ms{0};
std::atomic<bool> s_available{false};

int64_t now_ms() {
  return esp_timer_get_time() / 1000;
}

void task(void *) {
  rt::ButtonGesture gesture;
  for (;;) {
    const bool pressed = gpio_get_level(kPin) == kPressedLevel;
    switch (gesture.update(pressed, now_ms())) {
      case rt::Gesture::kShortPress:
        s_last_press_ms.store(now_ms());
        ESP_LOGI(TAG, "Button pressed");
        break;
      case rt::Gesture::kLongHold:
        // #209 will restart into safe mode here. Logged rather than silently
        // ignored so that holding the button does something observable, and so
        // the gesture is exercised on real hardware before anything depends on
        // it.
        ESP_LOGW(TAG, "Button held - safe-mode restart is not implemented yet (#209)");
        break;
      case rt::Gesture::kNone:
        break;
    }
    vTaskDelay(pdMS_TO_TICKS(kPollMs));
  }
}

}  // namespace

void init() {
  gpio_config_t cfg = {};
  cfg.pin_bit_mask = 1ULL << kPin;
  cfg.mode = GPIO_MODE_INPUT;
  // The boards carry an external pull-up on this pin; the internal one is
  // enabled anyway so a bare module without it still reads high when idle
  // rather than floating into phantom presses.
  cfg.pull_up_en = GPIO_PULLUP_ENABLE;
  cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
  cfg.intr_type = GPIO_INTR_DISABLE;

  const esp_err_t err = gpio_config(&cfg);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Could not configure GPIO%d: %s", static_cast<int>(kPin), esp_err_to_name(err));
    return;
  }

  if (xTaskCreate(task, "boot_button", 2560, nullptr, 5, nullptr) != pdPASS) {
    ESP_LOGE(TAG, "Could not start the button task");
    return;
  }

  s_available.store(true);
  ESP_LOGI(TAG, "Watching GPIO%d", static_cast<int>(kPin));
}

bool consume_press() {
  const int64_t at = s_last_press_ms.load();
  if (at == 0) return false;
  if (now_ms() - at > kPressValidMs) return false;
  // Consumed rather than merely read: one press authorises one submission, so
  // a single press cannot be replayed into several.
  s_last_press_ms.store(0);
  return true;
}

bool available() {
  return s_available.load();
}

}  // namespace boot_button
