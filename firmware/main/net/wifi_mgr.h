#pragma once

#include <string>

namespace wifi_mgr {

// Joins the configured network, blocking until connected or the retry budget
// is exhausted. Returns false on failure.
bool connect();

// Dotted-quad address once connected, empty before that.
std::string ip_address();

}  // namespace wifi_mgr
