// ============================================================================
//  config/factory_reset.h
//  Putting every stored setting back to as-built, from the device itself.
// ============================================================================
#pragma once

namespace factory_reset {

// Erase every stored setting and restart.
//
// **What goes:** everything in NVS - the WiFi credentials, the hardware
// configuration (#144), and any namespace added later, because the whole
// partition is erased rather than a list of keys somebody has to remember to
// extend.
//
// **What stays:** uploaded programs and audio clips. They are in the
// filesystem, they may be the only copy in existence, and nothing about "this
// device has the wrong settings" is answered by destroying them. A device
// handed to another club keeps whatever was uploaded to it, which is also what
// somebody would expect from a machine rather than from an account.
//
// The compiled-in WiFi seeds are suppressed as part of this, which is the
// point of the whole exercise - see wifi_store::forget().
//
// Restarts rather than returning: NVS has been erased underneath every module
// that read it at boot, so the running system is describing a device that no
// longer exists.
[[noreturn]] void perform(const char *reason);

}  // namespace factory_reset
