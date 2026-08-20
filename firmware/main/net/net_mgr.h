#pragma once

#include <string>

// The network the HTTP server is served over. Two implementations, chosen at
// build time by CONFIG_RT_NET_OPENETH and selected in main/CMakeLists.txt:
//
//   wifi_mgr.cpp  esp_wifi station + the setup portal fallback (the board)
//   eth_mgr.cpp   OpenCores Ethernet + DHCP           (CONFIG_RT_NET_OPENETH)
//
// The OpenCores MAC exists only in QEMU, which does not emulate WiFi - see
// docs/QEMU.md.
namespace net_mgr {

enum class Result {
  kConnected,    // the device holds an address and can be served
  kSetupPortal,  // no usable network; run_setup_portal() is the next step
};

// Brings the interface up and blocks until it has an address, or until the
// implementation gives up.
//
// On WiFi: joins the provisioned network (NVS, falling back to the Kconfig
// defaults). If the initial join fails, returns kSetupPortal - the caller must
// not start the normal server in that case; the device is waiting to be told
// which network to join. Once joined, reconnection is unbounded: the retry
// budget bounds the *initial* association only. A device that gave up
// mid-session would sit powered on and unreachable, which on a range is the
// worst of both outcomes.
Result connect();

// The out-of-box / lost-network path, valid only after connect() returned
// kSetupPortal. Never returns: on WiFi it serves the SoftAP captive portal
// until credentials are saved and then reboots.
[[noreturn]] void run_setup_portal();

// Dotted-quad address once connected, empty before that. Feeds the CORS
// allowlist and GET /api/v2/diagnostics/info, and is read from the httpd task.
std::string ip_address();

}  // namespace net_mgr
