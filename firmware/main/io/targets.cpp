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
  cfg.mode = GPIO_MODE_OUTPUT;
  cfg.pull_up_en = GPIO_PULLUP_DISABLE;
  cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
  cfg.intr_type = GPIO_INTR_DISABLE;
  ESP_ERROR_CHECK(gpio_config(&cfg));
}

void set(bool shown) {
  gpio_set_level(kTargetPin, shown ? kTargetLevelShown : kTargetLevelHidden);
  ESP_LOGD(TAG, "Targets %s", shown ? "shown" : "hidden");
}

}  // namespace targets
