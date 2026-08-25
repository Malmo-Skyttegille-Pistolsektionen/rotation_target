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

// Every network worth trying, in the order to try them: the provisioned one
// first, then the Kconfig seeds. Duplicates and unset entries are dropped, so
// the result may be empty.
//
// The order is what makes a second site work. Provisioning at the range writes
// the range network to NVS, and the home network stays behind it as a seed, so
// the device joins whichever of the two it can currently see instead of
// forgetting one every time it moves.
std::vector<Credentials> load_all();

// Saving also lifts the suppression forget() sets, so a device provisioned
// after a factory reset gets its seeds back.
bool save(const std::string &ssid, const std::string &password);

// Forget every network this device would try: the provisioned one, and the
// compiled-in Kconfig seeds.
//
// Erasing the provisioned keys is not enough on its own, and that is the whole
// of #222. The seeds are the network the *image* was built for, and load_all()
// offers them whenever NVS is silent - so a device whose credentials had been
// erased joined the build's network again and never raised the portal. Forcing
// the portal needed a throwaway build carrying deliberately wrong credentials.
//
// So a marker records that somebody asked for the networks to be forgotten,
// and load_all() honours it. save() clears the marker, so provisioning through
// the portal restores the seeds as a fallback for the next site.
bool forget();

// Whether credentials have ever been saved. False on an out-of-box device.
bool provisioned();

}  // namespace wifi_store
