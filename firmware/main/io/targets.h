#pragma once

// The target hardware: one GPIO driving a transistor on DB9 pin 2.
namespace targets {

void init();
// `shown` opens the connection, `hidden` closes it - see kTargetLevel* in
// main/config.h.
void set(bool shown);

}  // namespace targets
