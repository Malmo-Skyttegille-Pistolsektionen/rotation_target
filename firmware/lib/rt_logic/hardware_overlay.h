// ============================================================================
//  rt_logic/hardware_overlay.h
//  Laying a stored hardware configuration over the compiled defaults, and the
//  key names that is done with. Host-testable: the store is an interface, and
//  the NVS implementation stays in main/config/hardware_store.cpp.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

#include "hardware_config.h"

namespace rt {

// NVS caps a key at 15 characters, which is why these are abbreviated rather
// than spelled out. Here rather than beside the store so the overlay and the
// writer cannot drift apart over a key name.
namespace hw_key {
constexpr const char *kBankCount = "hw_bank_cnt";
constexpr const char *kHostname = "hw_hostname";
constexpr const char *kDisplayName = "hw_disp_name";
constexpr const char *kBootShown = "hw_boot_shown";
constexpr const char *kLedGpio = "hw_led_gpio";
constexpr const char *kI2sPort = "hw_i2s_port";
constexpr const char *kI2sBck = "hw_i2s_bck";
constexpr const char *kI2sWs = "hw_i2s_ws";
constexpr const char *kI2sDout = "hw_i2s_dout";
constexpr const char *kHttpPort = "hw_http_port";
constexpr const char *kWifiRetry = "hw_wifi_retry";
}  // namespace hw_key

// `hw_bk<i>_gpio`, `hw_bk<i>_alow`, `hw_bk<i>_name` - built rather than spelled
// out. Eleven characters at a single-digit index, inside NVS's cap of fifteen;
// the buffer is larger only so the compiler can see it cannot truncate.
static_assert(kMaxTargetBanks <= 10, "a two-digit bank index would need shorter key names");
struct BankKey {
  char text[24];

  BankKey(size_t bank, const char *suffix);
};

// Where a stored configuration is read from. One method per stored type,
// because the store is typed and pretending otherwise costs a `signed char`
// widening at every boolean. The return says whether the key was there at all;
// `false` leaves `out` alone.
class ConfigReader {
 public:
  virtual ~ConfigReader() = default;
  virtual bool read_i32(const char *key, int32_t &out) = 0;
  virtual bool read_bool(const char *key, bool &out) = 0;
  virtual bool read_str(const char *key, std::string &out) = 0;
};

// Lays whatever the store holds over `out`, which the caller has already filled
// with the compiled defaults. Returns whether anything was overlaid.
//
// Per key, not all-or-nothing: a device configured before a firmware update
// added a key picks up the new key's compiled default rather than losing the
// values it already had.
bool overlay_config(ConfigReader &reader, HardwareConfig &out);

}  // namespace rt
