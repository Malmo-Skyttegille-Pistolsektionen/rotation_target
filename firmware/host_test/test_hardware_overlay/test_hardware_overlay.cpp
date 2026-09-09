// ============================================================================
//  Reading a stored hardware configuration back (#144, #207).
//
//  This is the migration path, and it runs exactly once per device: on the
//  boot after a firmware update. Getting it wrong drives a pin nobody chose,
//  or loses the pin a club typed in - and neither shows up until somebody is
//  standing on a range. QEMU cannot see it either; the harness rebuilds its
//  flash image every launch. So it is tested here, with the store behind an
//  interface and the NVS half left in main/.
// ============================================================================
#include <map>
#include <string>

#include "hardware_overlay.h"
#include "unity.h"

using rt::ConfigRefusal;
using rt::HardwareConfig;

void setUp() {}
void tearDown() {}

namespace {

// A store a test writes by hand. Absent means absent - the whole point of the
// per-key overlay is what happens to the keys that are not there.
class FakeStore : public rt::ConfigReader {
 public:
  std::map<std::string, int32_t> ints;
  std::map<std::string, bool> bools;
  std::map<std::string, std::string> strings;

  bool read_i32(const char *key, int32_t &out) override {
    const auto it = ints.find(key);
    if (it == ints.end()) return false;
    out = it->second;
    return true;
  }

  bool read_bool(const char *key, bool &out) override {
    const auto it = bools.find(key);
    if (it == bools.end()) return false;
    out = it->second;
    return true;
  }

  bool read_str(const char *key, std::string &out) override {
    const auto it = strings.find(key);
    if (it == strings.end() || it->second.empty()) return false;
    out = it->second;
    return true;
  }
};

// What `hardware_store::defaults()` builds from Kconfig: one bank on the pin
// this firmware ships with, and the shipped peripheral pins.
HardwareConfig compiled_defaults() {
  HardwareConfig config;
  config.banks.assign(1, rt::TargetBank{});
  config.banks[0].gpio = 5;
  config.banks[0].active_low = true;
  config.hostname = "rotation-target";
  config.led_gpio = 48;
  config.i2s_port = 0;
  config.i2s_bck_gpio = 10;
  config.i2s_ws_gpio = 12;
  config.i2s_dout_gpio = 11;
  config.http_port = 80;
  config.wifi_max_retries = 10;
  return config;
}

}  // namespace

// Nothing stored: the device comes up on exactly what it was compiled with,
// and reports that nothing was overridden.
void test_a_device_that_has_never_been_configured_keeps_its_defaults() {
  FakeStore store;
  HardwareConfig config = compiled_defaults();

  TEST_ASSERT_FALSE(rt::overlay_config(store, config));

  TEST_ASSERT_EQUAL_size_t(1, config.banks.size());
  TEST_ASSERT_EQUAL_INT32(5, config.banks[0].gpio);
  TEST_ASSERT_TRUE(config.banks[0].active_low);
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config));
}

// The count decides how many banks are read.
void test_a_banked_device_reads_every_bank() {
  FakeStore store;
  store.ints[rt::hw_key::kBankCount] = 3;
  store.ints[rt::BankKey(0, "gpio").text] = 5;
  store.ints[rt::BankKey(1, "gpio").text] = 6;
  store.ints[rt::BankKey(2, "gpio").text] = 7;
  store.bools[rt::BankKey(1, "alow").text] = false;
  store.strings[rt::BankKey(1, "name").text] = "Vänster";

  HardwareConfig config = compiled_defaults();
  TEST_ASSERT_TRUE(rt::overlay_config(store, config));

  TEST_ASSERT_EQUAL_size_t(3, config.banks.size());
  TEST_ASSERT_EQUAL_INT32(5, config.banks[0].gpio);
  TEST_ASSERT_EQUAL_INT32(6, config.banks[1].gpio);
  TEST_ASSERT_EQUAL_INT32(7, config.banks[2].gpio);
  TEST_ASSERT_TRUE(config.banks[0].active_low);
  TEST_ASSERT_FALSE(config.banks[1].active_low);
  TEST_ASSERT_EQUAL_STRING("Vänster", config.banks[1].name.c_str());
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config));
}

// resize, not assign: bank A keeps the compiled default underneath, so a
// missing `hw_bk0_gpio` leaves the device on the pin it ships with rather than
// on GPIO 0.
void test_a_missing_bank_a_pin_falls_back_to_the_compiled_default() {
  FakeStore store;
  store.ints[rt::hw_key::kBankCount] = 1;

  HardwareConfig config = compiled_defaults();
  TEST_ASSERT_TRUE(rt::overlay_config(store, config));

  TEST_ASSERT_EQUAL_size_t(1, config.banks.size());
  TEST_ASSERT_EQUAL_INT32(5, config.banks[0].gpio);
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config));
}

// A bank above A has no compiled default to fall back to, so a half-written
// set lands on GPIO 0 - which validate() refuses, and init() then boots the
// compiled defaults. Refused, not "mostly applied".
void test_a_half_written_bank_set_is_refused_rather_than_partly_applied() {
  FakeStore store;
  store.ints[rt::hw_key::kBankCount] = 3;
  store.ints[rt::BankKey(0, "gpio").text] = 5;
  store.ints[rt::BankKey(1, "gpio").text] = 6;
  // hw_bk2_gpio never written.

  HardwareConfig config = compiled_defaults();
  TEST_ASSERT_TRUE(rt::overlay_config(store, config));

  TEST_ASSERT_EQUAL_INT32(0, config.banks[2].gpio);
  TEST_ASSERT_EQUAL(ConfigRefusal::kGpioStrapping, rt::validate(config));
}

// The stored count sizes an allocation, so a value this build cannot support
// is treated as absent - a downgraded device comes up on the compiled default
// rather than on a truncated version of what somebody configured.
void test_a_count_this_build_cannot_support_is_treated_as_absent() {
  for (const int32_t count : {9, 0, -1}) {
    FakeStore store;
    store.ints[rt::hw_key::kBankCount] = count;
    store.ints[rt::BankKey(0, "gpio").text] = 7;

    HardwareConfig config = compiled_defaults();
    rt::overlay_config(store, config);

    // The single compiled bank, untouched: an unusable count means nothing
    // said how many banks the stored bank keys describe.
    TEST_ASSERT_EQUAL_size_t(1, config.banks.size());
    TEST_ASSERT_EQUAL_INT32(5, config.banks[0].gpio);
    TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config));
  }
}

// Per key, not all-or-nothing: a device configured before a firmware update
// added a key picks up the new key's compiled default rather than losing what
// it already had.
void test_keys_a_device_has_never_seen_keep_their_compiled_default() {
  FakeStore store;
  store.ints[rt::hw_key::kBankCount] = 1;
  store.ints[rt::BankKey(0, "gpio").text] = 9;

  HardwareConfig config = compiled_defaults();
  TEST_ASSERT_TRUE(rt::overlay_config(store, config));

  TEST_ASSERT_EQUAL_INT32(9, config.banks[0].gpio);
  TEST_ASSERT_EQUAL_INT32(48, config.led_gpio);
  TEST_ASSERT_EQUAL_INT32(80, config.http_port);
  TEST_ASSERT_EQUAL_STRING("rotation-target", config.hostname.c_str());
}

// The keys are 15 characters at most, which is what NVS accepts. A longer one
// is not a truncated key, it is a write that never happens.
void test_every_key_fits_what_nvs_accepts() {
  for (size_t i = 0; i < rt::kMaxTargetBanks; i++) {
    for (const char *suffix : {"gpio", "alow", "name"}) {
      TEST_ASSERT_LESS_OR_EQUAL_size_t(15, std::string(rt::BankKey(i, suffix).text).size());
    }
  }
  TEST_ASSERT_LESS_OR_EQUAL_size_t(15, std::string(rt::hw_key::kBankCount).size());
  TEST_ASSERT_LESS_OR_EQUAL_size_t(15, std::string(rt::hw_key::kBootShown).size());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_a_device_that_has_never_been_configured_keeps_its_defaults);
  RUN_TEST(test_a_banked_device_reads_every_bank);
  RUN_TEST(test_a_missing_bank_a_pin_falls_back_to_the_compiled_default);
  RUN_TEST(test_a_half_written_bank_set_is_refused_rather_than_partly_applied);
  RUN_TEST(test_a_count_this_build_cannot_support_is_treated_as_absent);
  RUN_TEST(test_keys_a_device_has_never_seen_keep_their_compiled_default);
  RUN_TEST(test_every_key_fits_what_nvs_accepts);
  return UNITY_END();
}
