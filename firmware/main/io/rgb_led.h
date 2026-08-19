#pragma once

#include <cstdint>

// The onboard WS2812, used as a boot/health indicator: red while the device is
// still trying to get on the network, green once the server is up.
namespace rgb_led {

void init();
void set(uint8_t r, uint8_t g, uint8_t b);
void off();
void red();
void green();
void yellow();

}  // namespace rgb_led
