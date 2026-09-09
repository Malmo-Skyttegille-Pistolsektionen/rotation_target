#include "targets.h"

#include <string>
#include <vector>

#include "config.h"
#include "config/hardware_store.h"
#include "esp_log.h"

namespace targets {
namespace {

const char *TAG = "targets";

struct Bank {
  gpio_num_t pin;
  int level_shown;
  int level_hidden;
};

// Latched at init(), not read per call. The pins and their polarities come from
// NVS now (#144), and a value that could move mid-run would leave the old pin
// driving whatever state it was last set to while the new one starts from its
// reset value - with a program possibly running between the two.
std::vector<Bank> s_banks;
bool s_shown_at_boot = true;

}  // namespace

void init() {
  const rt::HardwareConfig &hw = hardware_store::current();
  s_shown_at_boot = hw.targets_shown_at_boot;

  s_banks.clear();
  s_banks.reserve(hw.banks.size());
  for (const rt::TargetBank &configured : hw.banks) {
    // Active low means a low level opens the BC547B and shows the bank.
    s_banks.push_back({static_cast<gpio_num_t>(configured.gpio), configured.active_low ? 0 : 1,
                       configured.active_low ? 1 : 0});
  }

  // The latch first, while the output driver is still off. gpio_config() turns
  // the driver on with the latch at its reset value of 0, which on an active-low
  // board is the shown level - so configuring first drives "shown" for the gap
  // before set() lands. Harmless when that is the boot state anyway, wrong when
  // it is not.
  //
  // gpio_set_level() writes the output register whether or not the pad is an
  // output yet, so the value is already correct the moment the driver is
  // enabled and the pin never drives shown at all. Per bank, so no pin presents
  // an intermediate level however many there are.
  for (const Bank &bank : s_banks) {
    gpio_set_level(bank.pin, s_shown_at_boot ? bank.level_shown : bank.level_hidden);

    gpio_config_t cfg = {};
    cfg.pin_bit_mask = 1ULL << bank.pin;
    // INPUT_OUTPUT, not OUTPUT: with the input buffer left on, gpio_get_level()
    // reads the real pad voltage rather than the output latch, so a pin that is
    // being held by something external is distinguishable from one the firmware
    // never drove.
    cfg.mode = GPIO_MODE_INPUT_OUTPUT;
    cfg.pull_up_en = GPIO_PULLUP_DISABLE;
    cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
    cfg.intr_type = GPIO_INTR_DISABLE;
    ESP_ERROR_CHECK(gpio_config(&cfg));
  }

  // Redundant against the pre-config writes above, and kept: it is the call that
  // logs, so the boot record still says what the pins were told to do.
  set(rt::kAllBanksMask, s_shown_at_boot);
}

size_t count() {
  return s_banks.size();
}

int pin(size_t bank) {
  return bank < s_banks.size() ? static_cast<int>(s_banks[bank].pin) : -1;
}

int level(size_t bank) {
  return bank < s_banks.size() ? gpio_get_level(s_banks[bank].pin) : -1;
}

int level_shown(size_t bank) {
  return bank < s_banks.size() ? s_banks[bank].level_shown : -1;
}

void set(rt::BankMask bank_mask, bool shown) {
  std::string letters;
  for (size_t i = 0; i < s_banks.size(); i++) {
    if ((bank_mask & rt::bank_bit(i)) == 0) continue;
    gpio_set_level(s_banks[i].pin, shown ? s_banks[i].level_shown : s_banks[i].level_hidden);
    letters += rt::bank_letter(i);
  }
  if (letters.empty()) return;

  // INFO, not DEBUG: transitions are rare (one per program event) and this is
  // the only record of what the pins were told to do - on hardware it is the
  // first thing to compare against the relay, and under QEMU the serial log is
  // the only effects-layer observation channel (GPIO reads are stubbed).
  ESP_LOGI(TAG, "Targets %s (bank %s)", shown ? "shown" : "hidden", letters.c_str());
}

}  // namespace targets
