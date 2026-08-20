#pragma once

#include <string>

// WiFi credentials in NVS.
//
// Compile-time-only credentials (the Kconfig values) meant that changing the
// range's WiFi password required a toolchain, a checkout with submodules, a
// rebuild and a USB cable - per device. These persist across a firmware flash
// (`idf.py flash` leaves the nvs partition alone), so the club can move the
// device to a new network without rebuilding it.
namespace wifi_store {

struct Credentials {
  std::string ssid;
  std::string password;
};

// NVS if a network has been provisioned, otherwise the Kconfig defaults.
Credentials load();

bool save(const std::string &ssid, const std::string &password);

// Forget the provisioned network, so the next boot falls back to the Kconfig
// defaults and then to the setup portal.
bool clear();

// Whether credentials have ever been saved. False on an out-of-box device.
bool provisioned();

}  // namespace wifi_store
