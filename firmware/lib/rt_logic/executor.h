// ============================================================================
//  rt_logic/executor.h
//  Runs one series at a time and keeps ProgramState in step with it.
//  Ported from src/backend/executor/program_executor.py.
//
//  Pure logic: the clock and every side effect (target GPIO, audio playback,
//  SSE broadcast) are injected, so the whole run state machine is exercised on
//  the host with a fake clock and no sleeps. The firmware supplies the real
//  implementations in main/executor/program_executor.cpp.
// ============================================================================
#pragma once

#include <cstdint>
#include <vector>

#include "program.h"
#include "program_state.h"

namespace rt {

class Clock {
 public:
  virtual ~Clock() = default;
  // Monotonic milliseconds. Only differences are ever taken, so the epoch is
  // irrelevant as long as it does not go backwards.
  virtual int64_t now_ms() const = 0;
};

class Effects {
 public:
  virtual ~Effects() = default;
  // Drive the target hardware. The state flag is the executor's business;
  // this is only the pin.
  virtual void set_targets(bool shown) = 0;
  // Schedule playback; must not block the run loop for the length of the clip.
  virtual void play_audios(const std::vector<int32_t> &audio_ids) = 0;
  // Publish the current state to SSE clients.
  virtual void state_changed() = 0;
};

class Executor {
 public:
  // Returned by tick() when there is nothing to run. The caller waits this
  // long *or* until a control call wakes it, whichever comes first.
  static constexpr int32_t kIdleSleepMs = 1000;

  Executor(ProgramState &state, Clock &clock, Effects &effects)
      : state_(state), clock_(clock), effects_(effects) {}

  // --- Control surface (one call per REST endpoint) ---

  // Select `program`, series 0, event 0, ticker unset. Null is refused, which
  // is how "program not found" reaches the caller.
  bool load(const Program *program);
  // Resume from ticker_ms, or run the current series from zero.
  bool start();
  // Pause, keeping the position so start() can resume from it.
  bool stop();
  // Rewind to the start of the current series.
  bool reset();
  // Select a series, paused at its first event.
  bool skip_to_series(int32_t series_index);

  // Drop the loaded program - used when it is deleted out from under a run.
  void unload();

  // Target control for the /targets/* endpoints. Keeps the published flag and
  // the pin in step; the caller broadcasts.
  void set_targets(bool shown);
  // Returns the resulting state.
  bool toggle_targets();

  // --- Run loop ---

  // One iteration of the run loop. Returns how many milliseconds until the
  // next call is due; kIdleSleepMs when not running.
  int32_t tick();

 private:
  const Series *series_at(const Nullable &index) const;
  void enter_event(int32_t index, const Event &event, bool play_audio);
  void complete_series(int32_t series_index);
  void clear_run_anchor();

  ProgramState &state_;
  Clock &clock_;
  Effects &effects_;
};

}  // namespace rt
