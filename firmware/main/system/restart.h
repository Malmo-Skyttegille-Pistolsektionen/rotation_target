#pragma once

// Restarting the device on purpose. One path for every deliberate restart -
// the endpoint, an accepted OTA and the setup portal's save (D-42).
namespace device_restart {

// Restarts about 1.5 s from now, on its own task, and returns immediately, so
// the caller can answer before the chip goes down.
//
// False when the task could not be created: nothing will restart, and the
// caller must say so rather than report success. `why` is logged and must
// outlive the call.
bool schedule(const char *why);

}  // namespace device_restart
