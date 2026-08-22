#pragma once

// A serial command interface for diagnostics over USB.
//
// The device that prompted this was on a subnet the laptop could not reach, so
// HTTP was unavailable and the only way to learn its address was to reset the
// board and read the boot log as it scrolled past - on a device where resetting
// used to move the targets. `status` answers that without a reboot.
namespace console {

// Starts the REPL on the USB serial/JTAG port. A failure here is logged and
// otherwise ignored: the console is a convenience, and a device that will not
// give you a prompt must still run programs.
void init();

}  // namespace console
