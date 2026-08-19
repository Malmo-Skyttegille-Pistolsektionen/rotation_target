#pragma once

#include <string>

namespace wifi_mgr {

enum class Result {
  kConnected,    // joined the configured network
  kSetupPortal,  // no usable network; the setup AP is serving instead
};

// Joins the provisioned network (NVS, falling back to the Kconfig defaults).
// If the initial join fails, brings up the setup AP and captive portal and
// returns kSetupPortal - the caller should not start the normal server in that
// case; the device is waiting to be told which network to join.
//
// Once joined, reconnection is unbounded: the retry budget bounds the *initial*
// association only. A device that gave up mid-session would sit powered on and
// unreachable, which on a range is the worst of both outcomes.
Result connect();

// Dotted-quad address once connected, empty before that.
std::string ip_address();

}  // namespace wifi_mgr
