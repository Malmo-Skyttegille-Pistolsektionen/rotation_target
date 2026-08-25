#pragma once

#include <cstdint>

// The onboard WS2812 - the only status the device shows when nobody has a
// browser open. The states, in the order a healthy boot passes through them:
//
//   blinking red  trying to join a network
//   solid red     out of attempts; up with no network at all
//   yellow        on the network, not serving yet
//   green         serving
//   blue          serving the setup portal on its own access point
//
// Yellow is milliseconds wide on a healthy boot (WiFi comes up ~24 ms before
// the HTTP server), so it is not there to be watched go by - it is there so
// that a device *stuck* on yellow says the network is fine and the server is
// not, which is a different fault from red.
//
// Call the status_* functions, not the colours: the policy lives in one place
// so a reconnect after the server is already up goes back to green rather than
// to yellow. Colours match the MicroPython backend's RGBLed, which defined red,
// green and yellow but only ever set green. Kept dim: the device sits on a
// range in the dark.
namespace rgb_led {

void init();
void set(uint8_t r, uint8_t g, uint8_t b);
void off();

// Re-applies whichever status was last set. For anything that borrows the LED
// for a moment - the factory-reset hold (#222) - so that letting go of the
// button puts the device's own status back instead of leaving it showing the
// borrowed colour until the next state change, which on a serving device never
// comes.
void restore();

// Alternates red and off on each call. Join attempts are ~2.4 s apart, which
// makes the blink rate, so this needs no timer of its own.
void status_joining();
// Stopped trying. Solid, so it is distinguishable from still-trying at a
// glance - which at the range is the whole question.
void status_offline();
// On the network. Green if the server has already started (a reconnect),
// yellow if it has not (first boot).
void status_online();
// The server is up and answering. Latches: later reconnects go straight to
// green.
void status_serving();
// No usable network; the setup access point is up instead.
void status_portal();

// White, and not one of the statuses above: a held button is something being
// done *to* the device, not a state it is in. See boot_button.h - it means the
// factory reset is counting down and letting go now abandons it.
void hold_armed();

}  // namespace rgb_led
