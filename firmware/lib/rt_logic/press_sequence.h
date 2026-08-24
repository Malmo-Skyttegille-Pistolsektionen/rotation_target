// ============================================================================
//  rt_logic/press_sequence.h
//  Recognising a deliberate rhythm of button presses.
//  Host-testable, no GPIO and no ESP-IDF.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>

namespace rt {

// Three presses inside ten seconds unlock the hardware configuration (#144).
//
// One press would not. A single press is something a person arrives at by
// accident - brushing the board while wiring it, or pressing to see what the
// button does - and the whole point of the window is that it cannot be opened
// by accident. A rhythm cannot be stumbled into, and it costs the operator
// about two seconds.
//
// Note what this is *not* proving. The setup portal (#208) also takes a press,
// and one is enough there, because it is proving something different: that
// somebody is physically present, which is unforgeable over the air however
// many times it is done. This is proving *intent*, which is a higher bar and
// needs repetition rather than presence.
constexpr size_t kUnlockPresses = 3;
constexpr int64_t kUnlockWindowMs = 10'000;

// Fed one press at a time; answers whether that press completed the sequence.
//
// A sliding window over the last `kUnlockPresses` timestamps rather than a
// counter that resets: somebody pressing steadily every four seconds should
// succeed on the third, and a counter with a timeout would keep throwing away
// their progress. What matters is that three presses happened close together,
// not that they started from a clean slate.
class PressSequence {
 public:
  explicit PressSequence(size_t presses = kUnlockPresses, int64_t window_ms = kUnlockWindowMs)
      : presses_(presses < kMaxPresses ? presses : kMaxPresses), window_ms_(window_ms) {}

  // True exactly once per completed sequence. The history is cleared on
  // success, so a fourth press does not immediately complete another one - it
  // starts the next rhythm, which is what somebody pressing repeatedly means.
  bool press(int64_t now_ms) {
    if (count_ < presses_) {
      times_[count_++] = now_ms;
    } else {
      for (size_t i = 1; i < presses_; i++) times_[i - 1] = times_[i];
      times_[presses_ - 1] = now_ms;
    }

    if (count_ < presses_) return false;
    if (now_ms - times_[0] > window_ms_) return false;

    count_ = 0;
    return true;
  }

  void reset() { count_ = 0; }

 private:
  // Bounded so the type carries no allocation; three is the shape in use and
  // anything beyond a handful stops being a gesture a person can perform.
  static constexpr size_t kMaxPresses = 8;

  size_t presses_;
  int64_t window_ms_;
  int64_t times_[kMaxPresses] = {};
  size_t count_ = 0;
};

}  // namespace rt
