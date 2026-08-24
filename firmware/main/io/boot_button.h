// ============================================================================
//  io/boot_button.h
//  The one owner of the BOOT button (GPIO0).
// ============================================================================
#pragma once

namespace boot_button {

// Two features want this pin, and each polling it separately would be the wrong
// shape: whichever sampled first would swallow the transition the other was
// waiting for. So one task owns the pin and classifies what it sees
// (`rt::ButtonGesture`), and features ask this module what happened.
//
//   - A short press authorises the setup portal to accept WiFi credentials
//     (#208), because it proves somebody is standing at the device.
//   - A long hold restarts into safe mode (#209 - not yet implemented; the
//     gesture is already detected and logged).
//
// Nothing here is a power-on gesture. GPIO0 is a strapping pin: held low when
// reset is released, the chip enters ROM download mode and this firmware never
// runs. There is no boot-time press to detect.
void init();

// Whether a short press happened recently, consuming it if so.
//
// Recency matters. Without it a press made for some other reason - somebody
// checking the button works, a knock in a cupboard - would authorise a
// credential submission arriving much later, from anyone in radio range. The
// press is proof that somebody was at the device *now*, so it expires.
bool consume_press();

// Whether the button is available at all. False on a build where the pin was
// never configured, so a caller can say "press the button" only when there is
// a button to press.
bool available();

}  // namespace boot_button
