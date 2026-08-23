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

ConfigRefusal validate(const HardwareConfig &config) {
  if (config.target_gpio < 0 || config.target_gpio > kMaxGpio)
    return ConfigRefusal::kGpioOutOfRange;
  if (gpio_is_reserved(config.target_gpio)) return ConfigRefusal::kGpioReserved;
  if (!gpio_is_output_capable(config.target_gpio)) return ConfigRefusal::kGpioNotOutputCapable;

  const ConfigRefusal hostname = validate_hostname(config.hostname);
  if (hostname != ConfigRefusal::kNone) return hostname;

  if (config.display_name.size() > kMaxDisplayNameLength) return ConfigRefusal::kDisplayNameTooLong;

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
  }
  return "";
}

}  // namespace rt
