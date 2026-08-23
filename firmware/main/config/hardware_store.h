#pragma once

#include "hardware_config.h"

// Hardware configuration in NVS, over the Kconfig defaults (#144).
//
// Every pin and polarity was already a `menuconfig` symbol, so `config.h` could
// honestly say nothing was hardcoded - but Kconfig is resolved at *build* time,
// so another club could only configure this device by installing ESP-IDF,
// editing sdkconfig and building firmware. From their side that is
// indistinguishable from hardcoded.
//
// So: NVS holds the configuration, Kconfig holds the defaults, per key. That
// keeps our builds reproducible and makes a stock release image usable by
// somebody who has never seen a toolchain. It is the pattern `wifi_store`
// already uses for credentials, generalised rather than reinvented.
//
// Bank count is fixed at one. Banks are a contract change (D-08, D-20), not a
// configuration key, and #144 says to genericise first so they have somewhere
// to be configured when they arrive.
namespace hardware_store {

// Which optional peripherals this firmware was built with. Compile-time facts,
// reported so a client can hide the pins for hardware that is not there.
rt::Peripherals peripherals();

// Read once at boot. Callers use this in place of the `config.h` constants,
// which is why it returns a reference to a value that never changes afterwards:
// re-reading NVS mid-run would let a pin move under a running program.
const rt::HardwareConfig &current();

// What NVS holds right now, re-read rather than cached. Equal to `current()`
// except between a save and the restart that adopts it - which is the gap the
// API reports as `restartRequired`.
rt::HardwareConfig saved();

// What the firmware was compiled with - what a reset restores. Shown beside
// `current()` so the UI can say which values have been overridden.
rt::HardwareConfig defaults();

// Whether the stored configuration differs from the compiled defaults - so a
// save made since boot counts, even though the device is still running what it
// booted on. False out of the box, and false again after a reset.
//
// Deliberately not "NVS holds a key": writing a value equal to the default
// would leave one behind, and a UI marking overridden values would then mark
// none while claiming some.
bool overridden();

// Validates, then persists. Refuses without writing anything on a bad value,
// so a rejected form leaves the device exactly as it was.
//
// Takes effect at the next boot. Nothing here re-drives a pin or renames mDNS
// in place: a target GPIO that moves while a program is loaded would leave the
// old pin latched in whatever state it was last driven to.
rt::ConfigRefusal save(const rt::HardwareConfig &config);

// The one setting `save()` cannot touch (D-31, #144). Which position is safe at
// rest is a property of the target system - another system may be the opposite
// of ours - so it has to be configurable; but it is also what protects somebody
// standing downrange when a board is powered, so it changes only from the
// serial console. Anyone at the USB port can already reflash the device, so
// requiring physical access costs nothing and rules out the remote mistake.
bool save_boot_targets(bool shown);

// Drop every override, so the next boot comes up on the compiled defaults.
// The escape hatch for a configuration that made the device unreachable -
// though reaching this over HTTP assumes it is still reachable, which is why
// #144 also wants it on the serial console.
bool reset();

// Load from NVS into the cache. Called once, early in `app_main`, before
// anything reads `current()`.
void init();

}  // namespace hardware_store
