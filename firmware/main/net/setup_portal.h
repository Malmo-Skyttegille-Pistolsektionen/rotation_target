#pragma once

// The out-of-box / lost-network path: a SoftAP with a captive portal that
// takes WiFi credentials, writes them to NVS and reboots.
//
// Without this, changing the range's WiFi password means reflashing every
// device over USB from a machine with the full ESP-IDF toolchain.
namespace setup_portal {

// Starts the AP, the DNS redirector and the setup page, then blocks forever -
// the device has nothing else useful to do until it has a network. Reboots
// itself once credentials are saved.
[[noreturn]] void run();

}  // namespace setup_portal
