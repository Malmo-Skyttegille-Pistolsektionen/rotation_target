// ============================================================================
//  net/wifi_scan.h
//  What the radio can hear, for the setup portal and for the serial console.
// ============================================================================
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "esp_wifi_types.h"

namespace wifi_scan {

// One network, as seen from wherever the device is standing.
struct AccessPoint {
  std::string ssid;  // empty for a network that does not broadcast its name
  int8_t rssi = 0;   // dBm; closer to zero is stronger
  uint8_t channel = 0;
  wifi_auth_mode_t auth = WIFI_AUTH_OPEN;
  uint8_t bssid[6] = {};  // the radio itself, which the SSID does not identify
};

// An active scan across every channel. Blocking, roughly two seconds, and
// requires the WiFi driver to be started.
//
// All channels rather than the fast scan: the deployment network is a hidden
// SSID, and a fast scan never finds it. The same reason applies to a survey -
// a channel the scan skipped is a channel whose interference you will not see.
//
// Every record the driver returns, strongest first: one per BSSID, duplicates
// and hidden networks included. Collapsing happens in `strongest_per_ssid()`
// for the callers that want a pick-list.
//
// Not collapsed here because the duplicates are information. Several radios on
// one SSID is a mesh or a multi-AP site, and that is worth seeing when you are
// working out why a device roams or will not settle - the same fact that, from
// a pick-list, would just be the same name six times.
std::vector<AccessPoint> scan();

// One entry per SSID, keeping the strongest sighting, with unnamed networks
// dropped. For a list somebody chooses from: a hidden network has nothing
// selectable to show, and six identical names say nothing about which radio
// you would actually associate with.
std::vector<AccessPoint> strongest_per_ssid(const std::vector<AccessPoint> &all);

// "24:4b:fe:71:01:b0"
std::string bssid_text(const uint8_t bssid[6]);

// The most recent scan, whoever ran it.
//
// The setup portal cannot scan once its own access point is up without
// hopping channels and dropping the phone that is talking to it. So the scan
// happens *before* the AP is raised, while the device is still in station mode
// having just failed to join, and the portal serves this.
const std::vector<AccessPoint> &cached();
void cache(std::vector<AccessPoint> results);

// "WPA2", "open", and so on - short enough for a table.
const char *auth_name(wifi_auth_mode_t auth);

// A rough bar count, 0-4, for a signal strength somebody has to act on.
// Rendering dBm alone asks the reader to know that -45 is excellent and -85 is
// hopeless.
int bars(int8_t rssi);

}  // namespace wifi_scan
