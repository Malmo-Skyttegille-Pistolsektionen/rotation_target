// ============================================================================
//  io/boot_button.h
//  The one owner of the BOOT button (GPIO0).
// ============================================================================
#pragma once

#include <cstdint>

namespace boot_button {

// Two features want this pin, and each polling it separately would be the wrong
// shape: whichever sampled first would swallow the transition the other was
// waiting for. So one task owns the pin and classifies what it sees
// (`rt::ButtonGesture`), and features ask this module what happened.
//
//   - A short press, while the setup portal is up, authorises it to accept
//     WiFi credentials (#208).
//   - A short press during normal operation opens the configuration window
//     (see below), which is the same proof used for a different question.
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

// --- the configuration window ------------------------------------------------
//
// Hardware configuration is guarded by a window that a button press opens, not
// by a password.
//
// The threat is an accident, not an adversary: somebody clicking into settings
// and editing a GPIO because it looked interesting. An accidental change cannot
// involve walking to the device and pressing a button, so the gesture *is* the
// proof of deliberateness - and unlike a password there is nothing to generate,
// store, hand over, lose or rotate.
//
// It also improves on its own. Regular users can reach the device today, so the
// press proves little about *who*; put the board in an enclosure later and the
// button is behind the key, with no code change.
//
// Hostname is inside the window and not merely the pins. A wrong pin leaves the
// web app reachable to fix it from; a wrong hostname changes mDNS, so the device
// stops answering to the name everybody reaches it by. That is the worse
// failure of the two.

// Five minutes from the press. Long enough to type a pin number, short enough
// that a window nobody remembers opening is not still open.
constexpr int64_t kConfigWindowMs = 5 * 60 * 1000;

// Whether the window is open right now.
bool config_window_open();

// Seconds left, or 0. For a countdown the operator can see, so a form does not
// simply stop working without explanation.
int32_t config_window_remaining_s();

}  // namespace boot_button
