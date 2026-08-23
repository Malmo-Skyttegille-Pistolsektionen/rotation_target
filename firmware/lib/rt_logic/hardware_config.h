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
  // Where the targets rest at boot. Both values are legal - which one is safe
  // depends on the target system - so there is nothing for `validate` to say
  // about it. Serial-only; see the note above.
  bool targets_shown_at_boot = true;

  // The status LED's data pin. Meaningful only when the LED is compiled in;
  // carried regardless, so the value survives a firmware built without it.
  int32_t led_gpio = 0;

  // The I2S DAC. `i2s_port` is the peripheral instance rather than a pin, so it
  // has its own bounds; the three GPIOs are pins like any other.
  int32_t i2s_port = 0;
  int32_t i2s_bck_gpio = 0;
  int32_t i2s_ws_gpio = 0;
  int32_t i2s_dout_gpio = 0;

  // The port the web app and API are served on. Not a pin, but the same kind
  // of setting: wrong and the device is not where anybody looks for it. mDNS
  // advertises the host, not the port, so the serial console reports it.
  int32_t http_port = 80;

  // How many times to try the stored network before giving up and raising the
  // setup portal. A site with a slow access point wants more; one where a
  // failed join should surface quickly wants fewer.
  int32_t wifi_max_retries = 10;
};

// Which optional peripherals this firmware was built with. Compile-time facts,
// not configuration - they decide which of the pins above are *in use*, and so
// which have to be checked and kept distinct from one another.
struct Peripherals {
  bool audio = true;
  bool led = true;
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
  kI2sPortOutOfRange,
  kPinCollision,
  kGpioUsbSerial,
  kGpioStrapping,
  kHttpPortOutOfRange,
  kWifiRetriesOutOfRange,
};

// A DNS label is 63 octets; mDNS is no more generous. The setup AP appends
// "-setup-XXXX" to this, and an SSID is capped at 32, so the shorter bound is
// what actually binds.
constexpr size_t kMaxHostnameLength = 20;
constexpr size_t kMaxDisplayNameLength = 40;

// ESP32-S3 has GPIO0..48 with 49 absent from the package.
constexpr int32_t kMaxGpio = 48;

// The ESP32-S3 has two I2S peripherals.
constexpr int32_t kMaxI2sPort = 1;

// A TCP port, minus the privileged-port question - this device has no users to
// drop to, so 80 is normal here. 0 is not a port you can listen on usefully.
constexpr int32_t kMinHttpPort = 1;
constexpr int32_t kMaxHttpPort = 65535;

// At ~2.4 s per attempt, 1 is "give up immediately" and 60 is about two and a
// half minutes before the portal appears. Beyond that a device that cannot
// join looks like a device that is broken.
constexpr int32_t kMinWifiRetries = 1;
constexpr int32_t kMaxWifiRetries = 60;

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

// GPIO19 and GPIO20 are the USB Serial/JTAG D- and D+ lines on the ESP32-S3.
//
// Refused for a reason the others do not share: the serial console is the
// *recovery path*. `boot-targets` lives there, and so does reading back a
// device-generated password. A configuration that took the console away would
// remove the way out of itself, leaving only a reflash - which is exactly the
// outcome all of this validation exists to prevent.
inline bool gpio_is_usb_serial(int32_t gpio) {
  return gpio == 19 || gpio == 20;
}

// Strapping pins, latched at reset to decide boot mode, flash voltage and
// whether the ROM prints. GPIO0 is also the BOOT button. Driving one does not
// misbehave at run time - it stops the device coming up at all, and the
// symptom (a board that is simply dead after a restart) gives no hint that a
// configuration change caused it.
//
// GPIO46 is strapping too and is already refused as not output-capable; it is
// listed there rather than here so the message names the more useful reason.
inline bool gpio_is_strapping(int32_t gpio) {
  return gpio == 0 || gpio == 3 || gpio == 45;
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

// Everything, in the order a caller should report: the target GPIO first,
// because a wrong pin there is the failure that needs a cable to undo.
//
// `present` says which optional peripherals this build has. It decides which
// pins are checked at all, and which have to be distinct from each other - a
// firmware built without audio has no I2S pins in use, so an I2S value equal to
// the target pin is not a collision, just an unused field.
ConfigRefusal validate(const HardwareConfig &config, Peripherals present = {});

// A sentence for the `detail` of an RFC 9457 problem document. Present tense,
// naming the value, because the operator has to decide what to type instead.
const char *refusal_message(ConfigRefusal refusal);

}  // namespace rt
