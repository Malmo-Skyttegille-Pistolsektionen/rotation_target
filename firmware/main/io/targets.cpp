#include "targets.h"

#include "config.h"
#include "esp_log.h"

namespace targets {
namespace {
const char *TAG = "targets";
}

void init() {
  gpio_config_t cfg = {};
  cfg.pin_bit_mask = 1ULL << kTargetPin;
  // INPUT_OUTPUT, not OUTPUT: with the input buffer left on, gpio_get_level()
  // reads the real pad voltage rather than the output latch, so a pin that is
  // being held by something external is distinguishable from one the firmware
  // never drove.
  cfg.mode = GPIO_MODE_INPUT_OUTPUT;
  cfg.pull_up_en = GPIO_PULLUP_DISABLE;
  cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
  cfg.intr_type = GPIO_INTR_DISABLE;
  ESP_ERROR_CHECK(gpio_config(&cfg));

  // Immediately, not once the executor starts. gpio_config() enables the driver
  // with the output latch at its reset value of 0 - which is kTargetLevelShown.
  // Between here and executor::init() the firmware mounts LittleFS, scans both
  // repositories and brings up I2S; the targets faced the shooters for that
  // whole window on every boot and every watchdog reboot.
  set(false);
}

int level() {
  return gpio_get_level(kTargetPin);
}

int pin() {
  return static_cast<int>(kTargetPin);
}

void set(bool shown) {
  gpio_set_level(kTargetPin, shown ? kTargetLevelShown : kTargetLevelHidden);
  // INFO, not DEBUG: transitions are rare (one per program event) and this is
  // the only record of what the pin was told to do - on hardware it is the
  // first thing to compare against the relay, and under QEMU the serial log is
  // the only effects-layer observation channel (GPIO reads are stubbed).
  ESP_LOGI(TAG, "Targets %s", shown ? "shown" : "hidden");
}

}  // namespace targets
