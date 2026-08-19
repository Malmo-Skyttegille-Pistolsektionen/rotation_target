#pragma once

// The target hardware: one GPIO driving a transistor on DB9 pin 2.
namespace targets {

void init();
// `shown` opens the connection, `hidden` closes it - see kTargetLevel* in
// main/config.h.
void set(bool shown);

// The level actually on the pad, read back through the input buffer. Diagnostic
// only: it answers "is the firmware driving what it thinks it is" without a
// multimeter, and a mismatch with set() means something external is holding the
// line.
int level();

// The GPIO this is configured for, for the same reason.
int pin();

}  // namespace targets
