#include "targets.h"

#include "config.h"
#include "esp_log.h"

namespace targets {
namespace {
const char *TAG = "targets";
}

void init() {
  // The latch first, while the output driver is still off. gpio_config() turns
  // the driver on with the latch at its reset value of 0, which on an active-low
  // board is kTargetLevelShown - so configuring first drives "shown" for the gap
  // before set() lands. Harmless when that is the boot state anyway, wrong when
  // it is not.
  //
  // gpio_set_level() writes the output register whether or not the pad is an
  // output yet, so the value is already correct the moment the driver is
  // enabled and the pin never drives shown at all.
  gpio_set_level(kTargetPin, kTargetsShownAtBoot ? kTargetLevelShown : kTargetLevelHidden);

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

  // Redundant against the pre-config write above, and kept: it is the call that
  // logs, so the boot record still says what the pin was told to do.
  set(kTargetsShownAtBoot);
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
