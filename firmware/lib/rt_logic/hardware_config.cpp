#include "hardware_config.h"

namespace rt {

ConfigRefusal validate_hostname(const std::string &hostname) {
  if (hostname.empty()) return ConfigRefusal::kHostnameEmpty;
  if (hostname.size() > kMaxHostnameLength) return ConfigRefusal::kHostnameTooLong;

  // Leading or trailing hyphen checked before the charset walk, so the more
  // specific message wins for "-foo" rather than reporting a bad character.
  if (hostname.front() == '-' || hostname.back() == '-') return ConfigRefusal::kHostnameHyphen;

  for (const char c : hostname) {
    const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
    if (!ok) return ConfigRefusal::kHostnameCharset;
  }
  return ConfigRefusal::kNone;
}

namespace {

// One pin, checked the same way wherever it is used.
ConfigRefusal validate_pin(int32_t gpio) {
  if (gpio < 0 || gpio > kMaxGpio) return ConfigRefusal::kGpioOutOfRange;
  if (gpio_is_reserved(gpio)) return ConfigRefusal::kGpioReserved;
  // Before the output-capability check: 19/20 and the strapping pins can drive
  // an output perfectly well, which is what makes them dangerous rather than
  // merely useless.
  if (gpio_is_usb_serial(gpio)) return ConfigRefusal::kGpioUsbSerial;
  if (gpio_is_strapping(gpio)) return ConfigRefusal::kGpioStrapping;
  if (!gpio_is_output_capable(gpio)) return ConfigRefusal::kGpioNotOutputCapable;
  return ConfigRefusal::kNone;
}

}  // namespace

ConfigRefusal validate(const HardwareConfig &config, Peripherals present) {
  // The target pin first: it is the one whose recovery needs a cable.
  const ConfigRefusal target = validate_pin(config.target_gpio);
  if (target != ConfigRefusal::kNone) return target;

  // Pins belonging to a peripheral this build does not have are not checked.
  // They are carried so the value survives, but an unused field cannot make a
  // device unreachable and should not be able to refuse a save.
  int32_t in_use[4];
  size_t used = 0;
  in_use[used++] = config.target_gpio;

  if (present.led) {
    const ConfigRefusal led = validate_pin(config.led_gpio);
    if (led != ConfigRefusal::kNone) return led;
    in_use[used++] = config.led_gpio;
  }

  if (present.audio) {
    if (config.i2s_port < 0 || config.i2s_port > kMaxI2sPort)
      return ConfigRefusal::kI2sPortOutOfRange;
    for (const int32_t gpio : {config.i2s_bck_gpio, config.i2s_ws_gpio, config.i2s_dout_gpio}) {
      const ConfigRefusal pin = validate_pin(gpio);
      if (pin != ConfigRefusal::kNone) return pin;
    }
  }

  // Two peripherals on one pin is a configuration that passes every check above
  // and still does not work: whichever is initialised last wins the pad, and
  // the other silently does nothing.
  const int32_t i2s[3] = {config.i2s_bck_gpio, config.i2s_ws_gpio, config.i2s_dout_gpio};
  for (size_t i = 0; i < used; i++) {
    for (size_t j = i + 1; j < used; j++) {
      if (in_use[i] == in_use[j]) return ConfigRefusal::kPinCollision;
    }
    if (present.audio) {
      for (const int32_t pin : i2s) {
        if (in_use[i] == pin) return ConfigRefusal::kPinCollision;
      }
    }
  }
  if (present.audio) {
    if (i2s[0] == i2s[1] || i2s[0] == i2s[2] || i2s[1] == i2s[2])
      return ConfigRefusal::kPinCollision;
  }

  const ConfigRefusal hostname = validate_hostname(config.hostname);
  if (hostname != ConfigRefusal::kNone) return hostname;

  if (config.display_name.size() > kMaxDisplayNameLength) return ConfigRefusal::kDisplayNameTooLong;

  if (config.http_port < kMinHttpPort || config.http_port > kMaxHttpPort) {
    return ConfigRefusal::kHttpPortOutOfRange;
  }
  if (config.wifi_max_retries < kMinWifiRetries || config.wifi_max_retries > kMaxWifiRetries) {
    return ConfigRefusal::kWifiRetriesOutOfRange;
  }

  return ConfigRefusal::kNone;
}

const char *refusal_message(ConfigRefusal refusal) {
  switch (refusal) {
    case ConfigRefusal::kNone:
      return "";
    case ConfigRefusal::kGpioOutOfRange:
      return "The target GPIO must be between 0 and 48.";
    case ConfigRefusal::kGpioNotOutputCapable:
      return "That GPIO cannot drive an output on this chip.";
    case ConfigRefusal::kGpioReserved:
      return "That GPIO is wired to the module's flash or PSRAM, or does not exist on this chip. "
             "Driving it stops the device booting.";
    case ConfigRefusal::kHostnameEmpty:
      return "The hostname cannot be empty - it is how the device is reached.";
    case ConfigRefusal::kHostnameTooLong:
      return "The hostname is too long; 20 characters at most.";
    case ConfigRefusal::kHostnameCharset:
      return "The hostname may contain only lower-case letters, digits and hyphens.";
    case ConfigRefusal::kHostnameHyphen:
      return "The hostname cannot start or end with a hyphen.";
    case ConfigRefusal::kDisplayNameTooLong:
      return "The display name is too long; 40 characters at most.";
    case ConfigRefusal::kI2sPortOutOfRange:
      return "The I2S port must be 0 or 1 - this chip has two.";
    case ConfigRefusal::kGpioUsbSerial:
      return "GPIO 19 and 20 are the USB serial connection. Using one would remove the serial "
             "console, which is how this setting is put back if it turns out to be wrong.";
    case ConfigRefusal::kGpioStrapping:
      return "GPIO 0, 3 and 45 are read at reset to decide how the chip boots. Driving one can "
             "stop the device starting at all.";
    case ConfigRefusal::kHttpPortOutOfRange:
      return "The HTTP port must be between 1 and 65535.";
    case ConfigRefusal::kWifiRetriesOutOfRange:
      return "WiFi attempts must be between 1 and 60 - each takes about 2.4 seconds.";
    case ConfigRefusal::kPinCollision:
      return "Two of these are on the same GPIO. The target, the status LED and the three audio "
             "pins each need one of their own, or whichever is set up last takes the pad and the "
             "other silently stops working.";
  }
  return "";
}

}  // namespace rt
