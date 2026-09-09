#include "hardware_overlay.h"

#include <cstdio>

namespace rt {

BankKey::BankKey(size_t bank, const char *suffix) {
  snprintf(text, sizeof(text), "hw_bk%u_%s", static_cast<unsigned>(bank), suffix);
}

namespace {

void overlay_banks(ConfigReader &reader, HardwareConfig &out, size_t count) {
  // resize, not assign: bank A keeps the compiled default underneath, so a
  // missing `hw_bk0_gpio` leaves it on the pin this build ships with. B..H are
  // new elements and land on GPIO 0, which validate() refuses - a half-written
  // set falls back rather than driving an arbitrary pin.
  out.banks.resize(count);

  std::string text;
  for (size_t i = 0; i < out.banks.size(); i++) {
    int32_t gpio = 0;
    if (reader.read_i32(BankKey(i, "gpio").text, gpio)) out.banks[i].gpio = gpio;

    reader.read_bool(BankKey(i, "alow").text, out.banks[i].active_low);

    if (reader.read_str(BankKey(i, "name").text, text)) out.banks[i].name = text;
  }
}

}  // namespace

bool overlay_config(ConfigReader &reader, HardwareConfig &out) {
  bool found = false;

  // The stored count sizes an allocation, so a value this build cannot support
  // is treated as absent rather than trusted. A device downgraded from a
  // firmware with more banks then comes up on the compiled default rather than
  // on a truncated version of what somebody configured.
  int32_t bank_count = 0;
  const bool has_banks = reader.read_i32(hw_key::kBankCount, bank_count) && bank_count >= 1 &&
                         bank_count <= static_cast<int32_t>(kMaxTargetBanks);

  // No usable count means nothing has configured the banks, so `out` keeps the
  // single compiled bank the caller filled it with.
  if (has_banks) {
    found = true;
    overlay_banks(reader, out, static_cast<size_t>(bank_count));
  }

  std::string text;
  if (reader.read_str(hw_key::kHostname, text)) {
    out.hostname = text;
    found = true;
  }
  if (reader.read_str(hw_key::kDisplayName, text)) {
    out.display_name = text;
    found = true;
  }

  if (reader.read_bool(hw_key::kBootShown, out.targets_shown_at_boot)) found = true;

  const struct {
    const char *key;
    int32_t *field;
  } scalars[] = {
      {hw_key::kLedGpio, &out.led_gpio},           {hw_key::kI2sPort, &out.i2s_port},
      {hw_key::kI2sBck, &out.i2s_bck_gpio},        {hw_key::kI2sWs, &out.i2s_ws_gpio},
      {hw_key::kI2sDout, &out.i2s_dout_gpio},      {hw_key::kHttpPort, &out.http_port},
      {hw_key::kWifiRetry, &out.wifi_max_retries},
  };
  for (const auto &scalar : scalars) {
    int32_t value = 0;
    if (reader.read_i32(scalar.key, value)) {
      *scalar.field = value;
      found = true;
    }
  }

  return found;
}

}  // namespace rt
