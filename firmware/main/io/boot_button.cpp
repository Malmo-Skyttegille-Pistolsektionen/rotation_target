#include "boot_button.h"

#include <atomic>

#include "button_gesture.h"
#include "press_sequence.h"
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
// RAM only, so it dies with the boot. A window that survived a restart would be
// one nobody remembers opening.
std::atomic<int64_t> s_window_until_ms{0};
std::atomic<bool> s_available{false};
WindowChangedFn s_on_changed = nullptr;
BlockedFn s_blocked = nullptr;
// What was last published. The deadline as well as the flag: re-arming an
// already-open window does not change `open`, so publishing on that alone
// leaves every browser counting down from a deadline that has moved.
bool s_last_published_open = false;
int64_t s_last_published_until_ms = 0;

int64_t now_ms() {
  return esp_timer_get_time() / 1000;
}

void task(void *) {
  rt::ButtonGesture gesture;
  rt::PressSequence unlock;
  for (;;) {
    const bool pressed = gpio_get_level(kPin) == kPressedLevel;
    switch (gesture.update(pressed, now_ms())) {
      case rt::Gesture::kShortPress:
        // Every press is recorded for the setup portal, which needs proof of
        // presence and takes one (#208). Only a rhythm of three opens the
        // configuration window, which needs proof of intent.
        s_last_press_ms.store(now_ms());
        if (unlock.press(now_ms())) {
          s_window_until_ms.store(now_ms() + kConfigWindowMs);
          ESP_LOGI(TAG, "Configuration window open for %d minutes",
                   static_cast<int>(kConfigWindowMs / 60000));
        } else {
          ESP_LOGI(TAG, "Button pressed");
        }
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
    // The lapse has no event of its own anywhere else in the system: it is
    // simply a moment passing. Watched here because this task is already awake,
    // and because a window that closed silently would leave every open browser
    // showing a tab that no longer does anything.
    const bool open_now = config_window_open();
    const int64_t until_now = s_window_until_ms.load();
    if (open_now != s_last_published_open || until_now != s_last_published_until_ms) {
      s_last_published_open = open_now;
      s_last_published_until_ms = until_now;
      if (s_on_changed != nullptr) s_on_changed(open_now, config_window_remaining_s());
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

void on_window_changed(WindowChangedFn callback) {
  s_on_changed = callback;
}

void block_when(BlockedFn condition) {
  s_blocked = condition;
}

bool config_window_open() {
  // Blocking comes first, whatever the button situation. A run holds the window
  // shut on every build - the contract says so, and the mock implements it that
  // way, so returning true here on a no-button build made the two disagree
  // about a device that would refuse the write anyway.
  if (s_blocked != nullptr && s_blocked()) return false;
  // A build with no button has no way to open the window, and refusing every
  // change on it would make the device unconfigurable rather than safe.
  if (!s_available.load()) return true;
  return now_ms() < s_window_until_ms.load();
}

int32_t config_window_remaining_s() {
  if (s_blocked != nullptr && s_blocked()) return 0;
  // A window with no button never closes, so there is no countdown to show.
  // Reported as the whole window rather than 0: "unlocked for 0:00" is a
  // contradiction, and it is what the UI renders literally.
  if (!s_available.load()) return static_cast<int32_t>(kConfigWindowMs / 1000);
  const int64_t left = s_window_until_ms.load() - now_ms();
  return left > 0 ? static_cast<int32_t>(left / 1000) : 0;
}

}  // namespace boot_button
