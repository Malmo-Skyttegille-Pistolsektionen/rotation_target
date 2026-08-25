// ============================================================================
//  rt_logic/button_gesture.h
//  Turning a stream of "is the button down?" samples into gestures.
//  Host-testable, no GPIO and no ESP-IDF.
// ============================================================================
#pragma once

#include <cstdint>

namespace rt {

// One physical button carries several meanings on this device, and they must
// not be confusable:
//
//   - A **short press** authorises the setup portal to accept WiFi credentials
//     (#208). It is proof that somebody is standing at the device.
//   - A **hold** is the factory reset (#222), in two stages: `kHoldArmed` says
//     the hold has been noticed, `kFactoryReset` says it has been held long
//     enough to commit. Releasing in between abandons it.
//
// Both are on GPIO0, the BOOT button. Note what is *not* here: a gesture at
// power-on. GPIO0 is a strapping pin - held low when reset is released the chip
// enters ROM download mode and our firmware never runs - so there is no
// power-on gesture to detect, and anything claiming to offer one is wrong.
enum class Gesture {
  kNone,
  kShortPress,
  // Held past the arming threshold. Nothing is destroyed yet: this exists so
  // the device can *say* it is counting, because a ten-second hold with no
  // feedback is indistinguishable from a button that does not work.
  kHoldArmed,
  // Held past the commit threshold. Destructive.
  kFactoryReset,
};

// Long enough that it cannot be mistaken for a press aimed at the portal, and
// short enough that the feedback arrives while the operator is still wondering
// whether the hold registered.
constexpr int64_t kDefaultArmHoldMs = 3000;

// Ten seconds, the same order as the reset button on a domestic router, and for
// the same reason: it is the one duration people already expect a destructive
// hold to take, and nobody arrives there by leaning on the board.
constexpr int64_t kDefaultFactoryResetMs = 10'000;

// Contact bounce on a tactile switch is well under this. It also sets the floor
// for what counts as a press at all, so a brush against the board does not
// authorise a credential submission.
constexpr int64_t kDefaultDebounceMs = 40;

// Fed one sample at a time; emits at most one gesture per call.
//
// Both hold stages fire **while the button is still down**, at the moment each
// threshold is passed, rather than on release. That is deliberate: the operator
// gets confirmation the hold registered without having to let go and guess,
// and - for the factory reset specifically - it means the commit happens at a
// moment the operator chose by continuing to hold, rather than at the moment
// they let go, which is when people stop paying attention.
//
// Releasing after either stage emits nothing, so one gesture can never both
// authorise the portal and do something else on the way up.
class ButtonGesture {
 public:
  explicit ButtonGesture(int64_t arm_hold_ms = kDefaultArmHoldMs,
                         int64_t factory_reset_ms = kDefaultFactoryResetMs,
                         int64_t debounce_ms = kDefaultDebounceMs)
      : arm_hold_ms_(arm_hold_ms), factory_reset_ms_(factory_reset_ms), debounce_ms_(debounce_ms) {}

  Gesture update(bool pressed, int64_t now_ms) {
    if (pressed && !down_) {
      down_ = true;
      down_since_ms_ = now_ms;
      armed_ = false;
      reset_fired_ = false;
      return Gesture::kNone;
    }

    if (pressed && down_) {
      const int64_t held_ms = now_ms - down_since_ms_;
      // Commit is checked first so a poll that straddles both thresholds - a
      // task starved for eight seconds - still reaches the reset rather than
      // reporting only that it was armed and then never firing again.
      if (!reset_fired_ && held_ms >= factory_reset_ms_) {
        reset_fired_ = true;
        armed_ = true;
        return Gesture::kFactoryReset;
      }
      if (!armed_ && held_ms >= arm_hold_ms_) {
        armed_ = true;
        return Gesture::kHoldArmed;
      }
      return Gesture::kNone;
    }

    if (!pressed && down_) {
      down_ = false;
      const int64_t held_ms = now_ms - down_since_ms_;
      // A hold that has already been reported is finished. Reporting a press
      // on release as well would let one gesture authorise the portal *and*
      // arm a factory reset.
      if (armed_) return Gesture::kNone;
      if (held_ms >= debounce_ms_) return Gesture::kShortPress;
      return Gesture::kNone;
    }

    return Gesture::kNone;
  }

  // Whether a hold is currently past the arming threshold and still held. The
  // caller needs this to notice the *abandonment*: releasing early emits no
  // gesture, and something has to put the borrowed status LED back.
  bool armed() const { return down_ && armed_; }

 private:
  int64_t arm_hold_ms_;
  int64_t factory_reset_ms_;
  int64_t debounce_ms_;
  bool down_ = false;
  bool armed_ = false;
  bool reset_fired_ = false;
  int64_t down_since_ms_ = 0;
};

}  // namespace rt
