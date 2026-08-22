#pragma once

#include <string>
#include <vector>

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

// Every network worth trying, in the order to try them: the provisioned one
// first, then the Kconfig seeds. Duplicates and unset entries are dropped, so
// the result may be empty.
//
// The order is what makes a second site work. Provisioning at the range writes
// the range network to NVS, and the home network stays behind it as a seed, so
// the device joins whichever of the two it can currently see instead of
// forgetting one every time it moves.
std::vector<Credentials> load_all();

bool save(const std::string &ssid, const std::string &password);

// Forget the provisioned network, so the next boot falls back to the Kconfig
// defaults and then to the setup portal.
bool clear();

// Whether credentials have ever been saved. False on an out-of-box device.
bool provisioned();

}  // namespace wifi_store
