#pragma once

// Restarting the device on purpose.
//
// Configuration is latched at boot, so every write endpoint stores and nothing
// more; this is the one thing that adopts what they stored. Kept in its own
// translation unit because it is not a property of any one subject - hardware,
// WiFi and the setup portal all end here.
namespace device_restart {

// Restarts about 1.5 s from now, on its own task, and returns immediately.
//
// The delay is what lets the caller answer first: the HTTP response has to
// leave the socket before the chip goes down, and waiting for that on the httpd
// task would stall every other client on the device meanwhile.
//
// `why` is logged and must outlive the call - a string literal, in practice.
void schedule(const char *why);

}  // namespace device_restart
