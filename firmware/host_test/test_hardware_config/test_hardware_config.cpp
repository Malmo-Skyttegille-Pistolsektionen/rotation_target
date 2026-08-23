// ============================================================================
//  What a device may be told about its own hardware (#144).
//
//  These are refusals, not preferences. A configuration this accepts is one a
//  club member typed into a web form on a device they may not be standing next
//  to, and the recovery from a bad value is a USB cable - which is the thing
//  configurability was supposed to remove.
// ============================================================================
#include "hardware_config.h"
#include "unity.h"

using rt::ConfigRefusal;
using rt::HardwareConfig;

void setUp() {}
void tearDown() {}

namespace {

/**
 * A configuration that passes, so each test can spoil exactly one field.
 *
 * The peripheral pins carry the shipped defaults rather than being left at
 * zero: every pin in use has to be distinct, so a fixture of zeroes is itself
 * a collision.
 */
HardwareConfig good() {
  HardwareConfig config;
  config.target_gpio = 5;
  config.target_active_low = true;
  config.hostname = "rotation-target";
  config.display_name = "Bana 1";
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

void test_the_shipped_defaults_are_accepted() {
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(good()));
}

// --- the GPIO --------------------------------------------------------------

void test_a_gpio_outside_the_chip_is_refused() {
  HardwareConfig config = good();
  config.target_gpio = 49;
  TEST_ASSERT_EQUAL(ConfigRefusal::kGpioOutOfRange, rt::validate(config));

  config.target_gpio = -1;
  TEST_ASSERT_EQUAL(ConfigRefusal::kGpioOutOfRange, rt::validate(config));
}

// 26..32 are the module's own flash and PSRAM. Driving one does not produce a
// target that fails to move; it produces a device that does not boot.
void test_the_flash_and_psram_pins_are_refused() {
  for (int32_t gpio = 26; gpio <= 32; gpio++) {
    HardwareConfig config = good();
    config.target_gpio = gpio;
    TEST_ASSERT_EQUAL(ConfigRefusal::kGpioReserved, rt::validate(config));
  }
}

void test_pins_absent_from_this_chip_are_refused() {
  for (int32_t gpio = 22; gpio <= 25; gpio++) {
    HardwareConfig config = good();
    config.target_gpio = gpio;
    TEST_ASSERT_EQUAL(ConfigRefusal::kGpioReserved, rt::validate(config));
  }
}

void test_an_input_only_pin_cannot_drive_the_targets() {
  HardwareConfig config = good();
  config.target_gpio = 46;
  TEST_ASSERT_EQUAL(ConfigRefusal::kGpioNotOutputCapable, rt::validate(config));
}

// The bounds themselves, which an off-by-one in the range check would let past.
void test_the_edges_of_the_usable_range_are_accepted() {
  HardwareConfig config = good();
  // 0 is not here: it is a strapping pin and the BOOT button, refused below.
  config.target_gpio = 21;
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config));

  config.target_gpio = 33;
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config));

  config.target_gpio = 1;
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config));
}

// The console is how a bad configuration is undone. A configuration that takes
// it away removes the way out of itself.
void test_the_usb_serial_pins_are_refused() {
  for (const int32_t gpio : {19, 20}) {
    HardwareConfig config = good();
    config.target_gpio = gpio;
    TEST_ASSERT_EQUAL(ConfigRefusal::kGpioUsbSerial, rt::validate(config));
  }
}

// Latched at reset: the symptom is a board that is simply dead afterwards,
// with nothing pointing at the configuration change that caused it.
void test_the_strapping_pins_are_refused() {
  for (const int32_t gpio : {0, 3, 45}) {
    HardwareConfig config = good();
    config.target_gpio = gpio;
    TEST_ASSERT_EQUAL(ConfigRefusal::kGpioStrapping, rt::validate(config));
  }
}

// Passes every per-pin check and still does not work: whichever peripheral is
// set up last takes the pad and the other silently stops.
void test_two_peripherals_on_one_pin_are_refused() {
  HardwareConfig config = good();
  config.led_gpio = config.target_gpio;
  TEST_ASSERT_EQUAL(ConfigRefusal::kPinCollision, rt::validate(config));

  config = good();
  config.i2s_ws_gpio = config.i2s_bck_gpio;
  TEST_ASSERT_EQUAL(ConfigRefusal::kPinCollision, rt::validate(config));

  config = good();
  config.i2s_dout_gpio = config.target_gpio;
  TEST_ASSERT_EQUAL(ConfigRefusal::kPinCollision, rt::validate(config));
}

// A build without the peripheral has no pin in use, so its value cannot
// collide and is not checked at all - an unused field must not refuse a save.
void test_pins_of_absent_peripherals_are_ignored() {
  HardwareConfig config = good();
  config.led_gpio = config.target_gpio;
  config.i2s_bck_gpio = config.target_gpio;

  rt::Peripherals none;
  none.audio = false;
  none.led = false;
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config, none));
}

void test_the_i2s_port_and_the_numeric_settings_are_bounded() {
  HardwareConfig config = good();
  config.i2s_port = 2;
  TEST_ASSERT_EQUAL(ConfigRefusal::kI2sPortOutOfRange, rt::validate(config));

  config = good();
  config.http_port = 0;
  TEST_ASSERT_EQUAL(ConfigRefusal::kHttpPortOutOfRange, rt::validate(config));
  config.http_port = 70000;
  TEST_ASSERT_EQUAL(ConfigRefusal::kHttpPortOutOfRange, rt::validate(config));

  config = good();
  config.wifi_max_retries = 0;
  TEST_ASSERT_EQUAL(ConfigRefusal::kWifiRetriesOutOfRange, rt::validate(config));
  config.wifi_max_retries = 61;
  TEST_ASSERT_EQUAL(ConfigRefusal::kWifiRetriesOutOfRange, rt::validate(config));
}

// --- the hostname ----------------------------------------------------------

void test_an_empty_hostname_is_refused() {
  HardwareConfig config = good();
  config.hostname = "";
  TEST_ASSERT_EQUAL(ConfigRefusal::kHostnameEmpty, rt::validate(config));
}

void test_a_hostname_longer_than_the_ssid_suffix_allows_is_refused() {
  HardwareConfig config = good();
  config.hostname = std::string(rt::kMaxHostnameLength, 'a');
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config));

  config.hostname = std::string(rt::kMaxHostnameLength + 1, 'a');
  TEST_ASSERT_EQUAL(ConfigRefusal::kHostnameTooLong, rt::validate(config));
}

// Upper case is the one that looks fine and is not: mDNS lower-cases, so the
// name the operator typed is not the name the device answers to.
void test_a_hostname_with_anything_but_lowercase_digits_and_hyphens_is_refused() {
  for (const char *bad :
       {"Rotation", "rotation target", "rotation_target", "rotation.target", "räv"}) {
    HardwareConfig config = good();
    config.hostname = bad;
    TEST_ASSERT_EQUAL(ConfigRefusal::kHostnameCharset, rt::validate(config));
  }
}

void test_a_hostname_cannot_start_or_end_with_a_hyphen() {
  HardwareConfig config = good();
  config.hostname = "-target";
  TEST_ASSERT_EQUAL(ConfigRefusal::kHostnameHyphen, rt::validate(config));

  config.hostname = "target-";
  TEST_ASSERT_EQUAL(ConfigRefusal::kHostnameHyphen, rt::validate(config));

  // A hyphen in the middle is the ordinary case and must stay legal.
  config.hostname = "rotation-target-2";
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config));
}

// --- the display name ------------------------------------------------------

// It is shown and nothing else, so it takes any characters - only a length.
void test_the_display_name_takes_anything_up_to_its_length() {
  HardwareConfig config = good();
  config.display_name = "Bana 1 - Malmö Skyttegille (övre)";
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config));

  config.display_name = std::string(rt::kMaxDisplayNameLength + 1, 'x');
  TEST_ASSERT_EQUAL(ConfigRefusal::kDisplayNameTooLong, rt::validate(config));
}

void test_an_empty_display_name_is_allowed() {
  HardwareConfig config = good();
  config.display_name = "";
  TEST_ASSERT_EQUAL(ConfigRefusal::kNone, rt::validate(config));
}

// --- ordering --------------------------------------------------------------

// The GPIO is reported first when several fields are wrong: it is the one
// whose recovery needs a cable, so it is the one to say out loud.
void test_the_gpio_is_reported_before_the_hostname() {
  HardwareConfig config = good();
  config.target_gpio = 27;
  config.hostname = "";
  TEST_ASSERT_EQUAL(ConfigRefusal::kGpioReserved, rt::validate(config));
}

// --- messages --------------------------------------------------------------

void test_every_refusal_has_something_to_say() {
  const ConfigRefusal all[] = {
      ConfigRefusal::kGpioOutOfRange,     ConfigRefusal::kGpioNotOutputCapable,
      ConfigRefusal::kGpioReserved,       ConfigRefusal::kHostnameEmpty,
      ConfigRefusal::kHostnameTooLong,    ConfigRefusal::kHostnameCharset,
      ConfigRefusal::kHostnameHyphen,     ConfigRefusal::kDisplayNameTooLong,
      ConfigRefusal::kI2sPortOutOfRange,  ConfigRefusal::kPinCollision,
      ConfigRefusal::kGpioUsbSerial,      ConfigRefusal::kGpioStrapping,
      ConfigRefusal::kHttpPortOutOfRange, ConfigRefusal::kWifiRetriesOutOfRange,
  };
  for (const ConfigRefusal refusal : all) {
    TEST_ASSERT_NOT_EQUAL(0, rt::refusal_message(refusal)[0]);
  }
  TEST_ASSERT_EQUAL(0, rt::refusal_message(ConfigRefusal::kNone)[0]);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_the_shipped_defaults_are_accepted);
  RUN_TEST(test_a_gpio_outside_the_chip_is_refused);
  RUN_TEST(test_the_flash_and_psram_pins_are_refused);
  RUN_TEST(test_pins_absent_from_this_chip_are_refused);
  RUN_TEST(test_an_input_only_pin_cannot_drive_the_targets);
  RUN_TEST(test_the_edges_of_the_usable_range_are_accepted);
  RUN_TEST(test_the_usb_serial_pins_are_refused);
  RUN_TEST(test_the_strapping_pins_are_refused);
  RUN_TEST(test_two_peripherals_on_one_pin_are_refused);
  RUN_TEST(test_pins_of_absent_peripherals_are_ignored);
  RUN_TEST(test_the_i2s_port_and_the_numeric_settings_are_bounded);
  RUN_TEST(test_an_empty_hostname_is_refused);
  RUN_TEST(test_a_hostname_longer_than_the_ssid_suffix_allows_is_refused);
  RUN_TEST(test_a_hostname_with_anything_but_lowercase_digits_and_hyphens_is_refused);
  RUN_TEST(test_a_hostname_cannot_start_or_end_with_a_hyphen);
  RUN_TEST(test_the_display_name_takes_anything_up_to_its_length);
  RUN_TEST(test_an_empty_display_name_is_allowed);
  RUN_TEST(test_the_gpio_is_reported_before_the_hostname);
  RUN_TEST(test_every_refusal_has_something_to_say);
  return UNITY_END();
}
