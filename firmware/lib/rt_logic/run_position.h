// ============================================================================
//  rt_logic/run_position.h
//  Where a series is at a given elapsed time, and how long to sleep next.
//  Pure maths, no state - host-testable.
//
//  This is what lets `stop` pause rather than rewind: position is derived from
//  elapsed series time on every tick instead of being tracked per event, so a
//  paused run resumes at whatever event `ticker_ms` lands in.
// ============================================================================
#pragma once

#include <cstdint>

#include "program.h"

namespace rt {

// Upper bound on how long the run loop sleeps, so stop/reset take effect
// promptly even in the middle of a long event.
constexpr int32_t kMaxSleepMs = 200;

struct EventLocation {
  bool valid = false;     // false once elapsed is at or past the end of the series
  int32_t index = 0;      // index of the event `elapsed_ms` falls in
  int32_t offset_ms = 0;  // how far into that event
  int32_t end_ms = 0;     // series-relative time the event ends at
};

// Locate `elapsed_ms` within `series`. Invalid when elapsed is at or beyond
// the total duration - the caller treats that as "the series is done".
//
// Kept in lock-step with `webapp/src/lib/run-position.ts`, which mirrors this
// so the timeline agrees with the targets.
inline EventLocation locate_event(const Series &series, int32_t elapsed_ms) {
  int32_t cumulative_ms = 0;
  for (size_t i = 0; i < series.events.size(); i++) {
    const Event &e = series.events[i];
    if (elapsed_ms < cumulative_ms + e.duration_ms) {
      EventLocation loc;
      loc.valid = true;
      loc.index = static_cast<int32_t>(i);
      loc.offset_ms = elapsed_ms - cumulative_ms;
      loc.end_ms = cumulative_ms + e.duration_ms;
      return loc;
    }
    cumulative_ms += e.duration_ms;
  }
  return EventLocation{};
}

// How long the run loop should sleep from `elapsed_ms`. Wakes on whichever
// comes first - the next whole second (so the ticker stays accurate), the end
// of the current event, or the end of the series - capped at kMaxSleepMs and
// never less than 1 ms.
inline int32_t next_sleep_ms(int32_t elapsed_ms, int32_t event_end_ms, int32_t total_ms) {
  int32_t next_tick_ms = (elapsed_ms / 1000 + 1) * 1000;
  int32_t wake_at_ms = next_tick_ms;
  if (event_end_ms < wake_at_ms) wake_at_ms = event_end_ms;
  if (total_ms < wake_at_ms) wake_at_ms = total_ms;

  int32_t sleep = wake_at_ms - elapsed_ms;
  if (sleep > kMaxSleepMs) sleep = kMaxSleepMs;
  if (sleep < 1) sleep = 1;
  return sleep;
}

}  // namespace rt
