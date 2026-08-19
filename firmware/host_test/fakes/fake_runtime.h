// ============================================================================
//  host_test/fakes/fake_runtime.h
//  Test doubles for the executor's injected clock and side effects.
//
//  The MicroPython suite these tests are ported from drove the executor with
//  real asyncio sleeps, which made the timing assertions coarse (a 200 ms event
//  asserted with a 250 ms sleep). Here the clock is advanced by hand, so the
//  same behaviour is asserted exactly and the suite runs instantly.
// ============================================================================
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "executor.h"
#include "program_state.h"

namespace rt_test {

class FakeClock : public rt::Clock {
 public:
  int64_t now_ms() const override { return now_; }
  void advance(int64_t ms) { now_ += ms; }
  void set(int64_t ms) { now_ = ms; }

 private:
  // Deliberately not zero: a real device's clock has been running since boot,
  // and starting at zero would hide a bug that treats "no anchor" as time 0.
  int64_t now_ = 1'000'000;
};

// Records everything the executor asked the outside world to do, in order.
class RecordingEffects : public rt::Effects {
 public:
  void set_targets(bool shown) override { target_history.push_back(shown); }

  void play_audios(const std::vector<int32_t> &audio_ids) override { played.push_back(audio_ids); }

  void state_changed() override {
    if (state != nullptr) broadcasts.push_back(rt::state_update_json(*state));
  }

  // Set by the fixture so state_changed() can snapshot the payload clients
  // would actually have received.
  const rt::ProgramState *state = nullptr;

  std::vector<bool> target_history;
  std::vector<std::vector<int32_t>> played;
  std::vector<std::string> broadcasts;

  void clear() {
    target_history.clear();
    played.clear();
    broadcasts.clear();
  }
};

// Bundles the state, clock, effects and executor a test needs, wired together.
struct Harness {
  rt::ProgramState state;
  FakeClock clock;
  RecordingEffects effects;
  rt::Executor executor{state, clock, effects};

  Harness() { effects.state = &state; }

  // Run the loop until it goes idle or `max_iterations` is hit, advancing the
  // clock by exactly what tick() asked to sleep. Returns the iteration count,
  // so a test can assert the loop terminated rather than hit the guard.
  int run_to_idle(int max_iterations = 10000) {
    for (int i = 0; i < max_iterations; i++) {
      if (!state.running) return i;
      clock.advance(executor.tick());
    }
    return max_iterations;
  }

  // Advance by `ms` in the increments the run loop itself would use.
  void run_for(int64_t ms) {
    int64_t remaining = ms;
    while (remaining > 0 && state.running) {
      int32_t sleep = executor.tick();
      if (sleep > remaining) sleep = static_cast<int32_t>(remaining);
      clock.advance(sleep);
      remaining -= sleep;
    }
  }
};

}  // namespace rt_test
