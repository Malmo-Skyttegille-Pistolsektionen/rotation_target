#include "targets.h"

#include "config.h"
#include "config/hardware_store.h"
#include "esp_log.h"

namespace targets {
namespace {

const char *TAG = "targets";

// Latched at init(), not read per call. The pin and its polarity come from NVS
// now (#144), and a value that could move mid-run would leave the old pin
// driving whatever state it was last set to while the new one starts from its
// reset value - with a program possibly running between the two.
gpio_num_t s_pin = static_cast<gpio_num_t>(CONFIG_RT_TARGET_GPIO);
int s_level_shown = 0;
int s_level_hidden = 1;

}  // namespace

void init() {
  const rt::HardwareConfig &hw = hardware_store::current();
  s_pin = static_cast<gpio_num_t>(hw.target_gpio);
  // Active low means a low level opens the BC547B and shows the targets.
  s_level_shown = hw.target_active_low ? 0 : 1;
  s_level_hidden = hw.target_active_low ? 1 : 0;

  // The latch first, while the output driver is still off. gpio_config() turns
  // the driver on with the latch at its reset value of 0, which on an active-low
  // board is kTargetLevelShown - so configuring first drives "shown" for the gap
  // before set() lands. Harmless when that is the boot state anyway, wrong when
  // it is not.
  //
  // gpio_set_level() writes the output register whether or not the pad is an
  // output yet, so the value is already correct the moment the driver is
  // enabled and the pin never drives shown at all.
  gpio_set_level(s_pin, kTargetsShownAtBoot ? s_level_shown : s_level_hidden);

  gpio_config_t cfg = {};
  cfg.pin_bit_mask = 1ULL << s_pin;
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
  return gpio_get_level(s_pin);
}

int pin() {
  return static_cast<int>(s_pin);
}

int level_shown() {
  return s_level_shown;
}

void set(bool shown) {
  gpio_set_level(s_pin, shown ? s_level_shown : s_level_hidden);
  // INFO, not DEBUG: transitions are rare (one per program event) and this is
  // the only record of what the pin was told to do - on hardware it is the
  // first thing to compare against the relay, and under QEMU the serial log is
  // the only effects-layer observation channel (GPIO reads are stubbed).
  ESP_LOGI(TAG, "Targets %s", shown ? "shown" : "hidden");
}

}  // namespace targets
