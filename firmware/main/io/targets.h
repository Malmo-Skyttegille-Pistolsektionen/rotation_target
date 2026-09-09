#pragma once

#include <cstddef>

#include "target_bank.h"

// The target hardware: one GPIO per bank, each driving a transistor on its own
// output. A one-bank device - every device today - behaves exactly as before
// (#207, D-41).
namespace targets {

void init();

// `shown` opens the connection, `hidden` closes it. Which pad level that is
// comes from the bank's configured polarity (#144), latched at init().
// `bank_mask` is one bit per bank; `rt::kAllBanksMask` drives every one.
void set(rt::BankMask bank_mask, bool shown);

// How many banks this device was configured for. 1..rt::kMaxTargetBanks.
size_t count();

// The GPIO a bank is configured for, so a diagnostic can say which pin it is
// talking about.
int pin(size_t bank);

// The level actually on a bank's pad, read back through the input buffer.
// Diagnostic only: it answers "is the firmware driving what it thinks it is"
// without a multimeter, and a mismatch with set() means something external is
// holding the line.
int level(size_t bank);

// The pad level that means "shown" for a bank, so a caller comparing level()
// against it does not have to know the polarity. Was a compile-time constant
// before the polarity became configurable.
int level_shown(size_t bank);

}  // namespace targets
