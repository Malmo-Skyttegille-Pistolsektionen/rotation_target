// ============================================================================
//  rt_logic/program_state.h
//  Execution state and the `stateUpdate` SSE payload - host-testable.
//  Ported from src/backend/repositories/program_state.py.
// ============================================================================
#pragma once

#include <cstdint>
#include <string>

#include "program.h"

namespace rt {

// `current_series_index`, `current_event_index` and `ticker_ms` are
// nullable on the wire, so each carries an explicit "unset" alongside its
// value rather than overloading -1.
struct Nullable {
  bool has_value = false;
  int32_t value = 0;

  void clear() {
    has_value = false;
    value = 0;
  }
  void set(int32_t v) {
    has_value = true;
    value = v;
  }
  int32_t value_or(int32_t fallback) const { return has_value ? value : fallback; }

  bool operator==(const Nullable &o) const {
    return has_value == o.has_value && (!has_value || value == o.value);
  }
  bool operator!=(const Nullable &o) const { return !(*this == o); }
};

// The run state published to clients. `ticker_ms` is milliseconds elapsed in
// the current series and doubles as the resume point: stop() keeps it, reset()
// clears it.
//
// Milliseconds, not seconds, since D-16: the webapp's playhead is positioned
// from this value, and whole seconds put it up to a whole event away from the
// targets. Precision only - the broadcast cadence is unchanged (see
// Executor::tick).
struct ProgramState {
  // Not owned. Null when nothing is loaded; points into the program
  // repository, which outlives the state.
  const Program *program = nullptr;
  bool running = false;
  Nullable current_series_index;
  Nullable current_event_index;
  Nullable ticker_ms;
  bool target_status_shown = false;

  // Monotonic ms anchor the current series is measured from while running.
  // Not published - it is the executor's own bookkeeping.
  bool has_series_start = false;
  int64_t series_start_ms = 0;

  bool is_loaded() const { return program != nullptr; }

  void unload() {
    program = nullptr;
    running = false;
    current_series_index.clear();
    current_event_index.clear();
    ticker_ms.clear();
    has_series_start = false;
    series_start_ms = 0;
  }
};

inline std::string nullable_json(const Nullable &n) {
  return n.has_value ? std::to_string(n.value) : "null";
}

// The one payload run state is published on. There is no /status endpoint: a
// client connects to /sse/v2, gets this immediately, and gets it again after
// every mutation.
// `ticker_ms` measured from the current series' anchor event rather than from
// the series start. Zero-anchored series - which is every series without a
// `timer_start_index` - come back unchanged, so this is a no-op for programs
// that predate the field.
inline Nullable relative_ticker_ms(const ProgramState &s) {
  if (!s.ticker_ms.has_value || s.program == nullptr || !s.current_series_index.has_value) {
    return s.ticker_ms;
  }
  const size_t index = static_cast<size_t>(s.current_series_index.value);
  if (s.current_series_index.value < 0 || index >= s.program->series.size()) return s.ticker_ms;

  Nullable out;
  out.set(s.ticker_ms.value - s.program->series[index].timer_anchor_ms());
  return out;
}

inline std::string state_update_json(const ProgramState &s) {
  std::string out = "{\"loadedProgramId\":";
  out += s.program ? std::to_string(s.program->id) : "null";
  out += ",\"programState\":";
  if (s.program) {
    out += "{\"running\":";
    out += s.running ? "true" : "false";
    out += ",\"currentSeriesIndex\":";
    out += nullable_json(s.current_series_index);
    out += ",\"currentEventIndex\":";
    out += nullable_json(s.current_event_index);
    // Published relative to the current series' timer anchor, so a client sees
    // a countdown through the preamble and a count-up once shooting starts
    // (#126). `ticker_ms` stays absolute elapsed internally - it is also the
    // resume point, and `start` reads it back - so the conversion happens here
    // and nowhere else.
    out += ",\"tickerMs\":";
    out += nullable_json(relative_ticker_ms(s));
    out += '}';
  } else {
    out += "null";
  }
  out += ",\"targetStatus\":";
  out += s.target_status_shown ? "\"shown\"" : "\"hidden\"";
  out += '}';
  return out;
}

}  // namespace rt
