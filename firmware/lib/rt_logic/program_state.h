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

// `current_series_index`, `current_event_index` and `ticker_seconds` are
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

// The run state published to clients. `ticker_seconds` is whole seconds
// elapsed in the current series and doubles as the resume point: stop() keeps
// it, reset() clears it.
struct ProgramState {
  // Not owned. Null when nothing is loaded; points into the program
  // repository, which outlives the state.
  const Program *program = nullptr;
  bool running = false;
  Nullable current_series_index;
  Nullable current_event_index;
  Nullable ticker_seconds;
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
    ticker_seconds.clear();
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
    out += ",\"tickerSeconds\":";
    out += nullable_json(s.ticker_seconds);
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
