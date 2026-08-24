// ============================================================================
//  rt_logic/button_gesture.h
//  Turning a stream of "is the button down?" samples into gestures.
//  Host-testable, no GPIO and no ESP-IDF.
// ============================================================================
#pragma once

#include <cstdint>

namespace rt {

// One physical button carries two meanings on this device, and they must not be
// confusable:
//
//   - A **short press** authorises the setup portal to accept WiFi credentials
//     (#208). It is proof that somebody is standing at the device.
//   - A **long hold** restarts into safe mode, ignoring the stored hardware
//     configuration (#209).
//
// Both are on GPIO0, the BOOT button. Note what is *not* here: a gesture at
// power-on. GPIO0 is a strapping pin - held low when reset is released the chip
// enters ROM download mode and our firmware never runs - so there is no
// power-on gesture to detect, and anything claiming to offer one is wrong.
enum class Gesture {
  kNone,
  kShortPress,
  kLongHold,
};

// The long hold has to be long enough that it cannot be mistaken for a press
// aimed at the portal, and short enough to be held deliberately without
// wondering whether it is working.
constexpr int64_t kDefaultLongHoldMs = 3000;

// Contact bounce on a tactile switch is well under this. It also sets the floor
// for what counts as a press at all, so a brush against the board does not
// authorise a credential submission.
constexpr int64_t kDefaultDebounceMs = 40;

// Fed one sample at a time; emits at most one gesture per call.
//
// `kLongHold` fires **while the button is still down**, at the moment the
// threshold is passed, rather than on release. That is deliberate: the operator
// gets confirmation the hold registered without having to let go and guess, and
// releasing afterwards emits nothing rather than also counting as a press.
class ButtonGesture {
 public:
  explicit ButtonGesture(int64_t long_hold_ms = kDefaultLongHoldMs,
                         int64_t debounce_ms = kDefaultDebounceMs)
      : long_hold_ms_(long_hold_ms), debounce_ms_(debounce_ms) {}

  Gesture update(bool pressed, int64_t now_ms) {
    if (pressed && !down_) {
      down_ = true;
      down_since_ms_ = now_ms;
      hold_fired_ = false;
      return Gesture::kNone;
    }

    if (pressed && down_) {
      if (!hold_fired_ && now_ms - down_since_ms_ >= long_hold_ms_) {
        hold_fired_ = true;
        return Gesture::kLongHold;
      }
      return Gesture::kNone;
    }

    if (!pressed && down_) {
      down_ = false;
      const int64_t held = now_ms - down_since_ms_;
      // A hold that already fired is finished. Reporting a press on release
      // as well would let one gesture authorise the portal *and* reboot.
      if (hold_fired_) return Gesture::kNone;
      if (held >= debounce_ms_) return Gesture::kShortPress;
      return Gesture::kNone;
    }

    return Gesture::kNone;
  }

 private:
  int64_t long_hold_ms_;
  int64_t debounce_ms_;
  bool down_ = false;
  bool hold_fired_ = false;
  int64_t down_since_ms_ = 0;
};

}  // namespace rt
