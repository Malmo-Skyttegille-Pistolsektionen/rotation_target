// ============================================================================
//  rt_logic/hardware_config.h
//  What a device may be told about its own hardware, and what it must refuse.
//  Host-testable, no NVS and no ESP-IDF.
// ============================================================================
#pragma once

#include <cstdint>
#include <string>

namespace rt {

// The configuration a device can be given without rebuilding it (#144).
//
// Deliberately *not* everything in `main/config.h`. Two kinds of setting stay
// compile-time:
//
//   - The `*_ENABLED` flags. They are `#if` guards that compile whole
//     subsystems in or out, so making them runtime means always carrying the
//     code for hardware that may not exist. That is a bigger change than this
//     one and buys less.
//   - `RT_TARGETS_HIDE_AT_BOOT`. It exists so somebody standing downrange when
//     a board is powered is not hit by a target turning on its own (D-31). A
//     safety default a remote UI can switch off is not a safety default.
//
// What is left is the part another club actually has to change to use a stock
// release image: which pin drives their targets, which way round it is wired,
// and what the device calls itself on their network.
struct HardwareConfig {
  // The GPIO that drives the target circuit.
  int32_t target_gpio = 0;
  // Whether a low level shows the targets. The prototype drives a BC547B whose
  // low state opens the connection; a board that buffers or inverts the signal
  // wants the other value rather than a patched source file.
  bool target_active_low = true;
  // mDNS name and the setup AP's prefix: `<hostname>.local`. Two clubs on one
  // network need two names.
  std::string hostname;
  // Free text shown in the web app. Purely cosmetic, and the one field here
  // that cannot break anything - which is why it has no format rule beyond a
  // length.
  std::string display_name;
};

// Why a configuration was refused. `kNone` means it was accepted.
enum class ConfigRefusal {
  kNone,
  kGpioOutOfRange,
  kGpioNotOutputCapable,
  kGpioReserved,
  kHostnameEmpty,
  kHostnameTooLong,
  kHostnameCharset,
  kHostnameHyphen,
  kDisplayNameTooLong,
};

// A DNS label is 63 octets; mDNS is no more generous. The setup AP appends
// "-setup-XXXX" to this, and an SSID is capped at 32, so the shorter bound is
// what actually binds.
constexpr size_t kMaxHostnameLength = 20;
constexpr size_t kMaxDisplayNameLength = 40;

// ESP32-S3 has GPIO0..48 with 49 absent from the package.
constexpr int32_t kMaxGpio = 48;

// Pins that exist but must not be handed out.
//
// 26..32 are wired to the in-package SPI flash and PSRAM on every ESP32-S3
// module we ship on; driving one is not a misconfiguration that shows up as a
// target that does not move, it is a device that stops booting and needs a
// cable. 22..25 do not exist on the ESP32-S3 at all.
//
// Refused rather than warned about: the recovery from getting this wrong is a
// USB cable and a reflash, which is exactly what configurability was supposed
// to remove.
inline bool gpio_is_reserved(int32_t gpio) {
  return (gpio >= 22 && gpio <= 25) || (gpio >= 26 && gpio <= 32);
}

// Input-only pins cannot drive anything. On the ESP32-S3 there are none in the
// classic sense (unlike the original ESP32's 34..39), but 46 is strapping and
// input-only on many modules, so it is treated as not output-capable.
inline bool gpio_is_output_capable(int32_t gpio) {
  return gpio != 46;
}

// A hostname has to survive being a DNS label and an SSID prefix: lower-case
// letters, digits and hyphens, not starting or ending with a hyphen.
ConfigRefusal validate_hostname(const std::string &hostname);

// Everything, in the order a caller should report: the GPIO first, because a
// wrong pin is the failure that needs a cable to undo.
ConfigRefusal validate(const HardwareConfig &config);

// A sentence for the `detail` of an RFC 9457 problem document. Present tense,
// naming the value, because the operator has to decide what to type instead.
const char *refusal_message(ConfigRefusal refusal);

}  // namespace rt
