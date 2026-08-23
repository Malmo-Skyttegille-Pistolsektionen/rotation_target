#pragma once

// The target hardware: one GPIO driving a transistor on DB9 pin 2.
namespace targets {

void init();
// `shown` opens the connection, `hidden` closes it. Which pad level that is
// comes from the configured polarity (#144), latched at init().
void set(bool shown);

// The level actually on the pad, read back through the input buffer. Diagnostic
// only: it answers "is the firmware driving what it thinks it is" without a
// multimeter, and a mismatch with set() means something external is holding the
// line.
int level();

// The GPIO this is configured for, for the same reason.
int pin();

// The pad level that means "shown", so a caller comparing level() against it
// does not have to know the polarity. Was a compile-time constant before the
// polarity became configurable.
int level_shown();

}  // namespace targets
