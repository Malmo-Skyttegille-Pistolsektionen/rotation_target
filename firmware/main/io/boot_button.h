// ============================================================================
//  io/boot_button.h
//  The one owner of the BOOT button (GPIO0).
// ============================================================================
#pragma once

#include <cstdint>

namespace boot_button {

// Several features want this pin, and each polling it separately would be the
// wrong shape: whichever sampled first would swallow the transition the other
// was waiting for. So one task owns the pin and classifies what it sees
// (`rt::ButtonGesture`), and features ask this module what happened.
//
//   - A short press, while the setup portal is up, authorises it to accept
//     WiFi credentials (#208).
//   - Three short presses within ten seconds open the configuration window
//     (see below).
//   - A ten-second hold is a factory reset (#222). The LED goes white after
//     three seconds to say it is counting; letting go before ten abandons it.
//     Acted on here rather than exposed as a question, unlike the two above:
//     there is nobody to ask, which is the situation the gesture exists for.
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
// Hardware configuration is guarded by a window that three button presses
// within ten seconds open, not by a password.
//
// The threat is an accident, not an adversary: somebody clicking into settings
// and editing a GPIO because it looked interesting. A deliberate rhythm at the
// device cannot be arrived at by accident, so the gesture *is* the proof - and
// unlike a password there is nothing to generate, store, hand over, lose or
// rotate.
//
// Three rather than one, unlike the setup portal (#208), because the two prove
// different things. The portal needs proof of *presence*, which one press gives
// and which is unforgeable over the air however often it is repeated. This needs
// proof of *intent*, and one press is something a person does by accident.
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
constexpr int64_t kConfigWindowMs = 5LL * 60 * 1000;

// A condition that holds the window shut regardless of the button. The app
// sets this to "a program is running": reconfiguring the machine and operating
// it are different activities, and these values only take effect at the next
// restart, so a mid-run change can only confuse whoever is on the line.
//
// Injected rather than called directly so this module keeps knowing nothing
// about the executor - and so there is exactly one definition of "the window is
// open" for the API, the change notification and the guard on the write to
// share. Two places computing it separately is how they come to disagree.
using BlockedFn = bool (*)();
void block_when(BlockedFn condition);

// Whether a write to the hardware configuration would be accepted right now:
// the press window is live and nothing is blocking it.
bool config_window_open();

// Called whenever the window's answer changes, so the change can be published
// without anybody polling for it. Set once at startup.
//
// The device has to *notice* the five minutes lapsing: nothing else is watching,
// and a window that closed silently would leave every open browser showing a tab
// that no longer works. The polling task is already awake, so it watches the
// boundary.
using WindowChangedFn = void (*)(bool open, int32_t remaining_s);
void on_window_changed(WindowChangedFn callback);

// Seconds left, or 0. For a countdown the operator can see, so a form does not
// simply stop working without explanation.
int32_t config_window_remaining_s();

}  // namespace boot_button
