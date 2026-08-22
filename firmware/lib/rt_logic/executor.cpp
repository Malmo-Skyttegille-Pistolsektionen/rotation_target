#include "executor.h"

#include "run_position.h"

namespace rt {

const Series *Executor::series_at(const Nullable &index) const {
  if (state_.program == nullptr || !index.has_value) return nullptr;
  if (index.value < 0 || static_cast<size_t>(index.value) >= state_.program->series.size()) {
    return nullptr;
  }
  return &state_.program->series[static_cast<size_t>(index.value)];
}

void Executor::clear_run_anchor() {
  state_.has_series_start = false;
  state_.series_start_ms = 0;
}

void Executor::set_targets(bool shown) {
  state_.target_status_shown = shown;
  effects_.set_targets(shown);
}

bool Executor::toggle_targets() {
  set_targets(!state_.target_status_shown);
  return state_.target_status_shown;
}

bool Executor::load(const Program *program) {
  if (program == nullptr) return false;

  state_.running = false;
  state_.program = program;
  state_.current_series_index.set(0);
  state_.current_event_index.set(0);
  state_.ticker_ms.clear();
  clear_run_anchor();

  effects_.state_changed();
  return true;
}

StartResult Executor::start(int32_t expected_program_id) {
  if (!state_.is_loaded()) return StartResult::kNotLoaded;

  // #95: the request names the program it was decided for, and the device is
  // the only place that check can be airtight - between a client's last
  // stateUpdate and its start arriving, any other client can load something
  // else. Ahead of the already-running short circuit, so a start aimed at the
  // wrong program is never answered "fine, it is running".
  if (state_.program->id != expected_program_id) return StartResult::kMismatch;

  // Already running is success, not an error - a second start is a no-op the
  // caller does not need to distinguish.
  if (state_.running) return StartResult::kStarted;

  const Series *series = series_at(state_.current_series_index);
  if (series == nullptr) return StartResult::kNotLoaded;

  // Exact, since D-16: the ticker is milliseconds, so a pause half a second
  // into a series resumes half a second in rather than rewinding to the top of
  // the second.
  const int32_t resume_from_ms = state_.ticker_ms.value_or(0);
  state_.running = true;
  state_.series_start_ms = clock_.now_ms() - resume_from_ms;
  state_.has_series_start = true;
  state_.ticker_ms.set(resume_from_ms);

  const EventLocation loc = locate_event(*series, resume_from_ms);
  if (loc.valid) {
    // Replaying the audio of an event we resume into the middle of would
    // double it up, so it only plays when we land exactly on the boundary.
    enter_event(loc.index, series->events[static_cast<size_t>(loc.index)], loc.offset_ms == 0);
  }

  effects_.state_changed();
  return StartResult::kStarted;
}

bool Executor::stop() {
  if (!state_.running) return false;

  state_.running = false;
  clear_run_anchor();

  effects_.state_changed();
  return true;
}

bool Executor::reset() {
  if (!state_.is_loaded()) return false;

  state_.running = false;
  state_.current_event_index.set(0);
  state_.ticker_ms.clear();
  clear_run_anchor();

  effects_.state_changed();
  return true;
}

bool Executor::skip_to_series(int32_t series_index) {
  if (!state_.is_loaded()) return false;
  if (series_index < 0 || static_cast<size_t>(series_index) >= state_.program->series.size()) {
    return false;
  }

  state_.running = false;
  state_.current_series_index.set(series_index);
  state_.current_event_index.set(0);
  state_.ticker_ms.clear();
  clear_run_anchor();

  effects_.state_changed();
  return true;
}

UnloadResult Executor::unload() {
  // A run in progress outranks "nothing loaded" only in theory - running
  // implies loaded - but checking it first is what makes the refusal the
  // answer whenever there is a run to protect.
  if (state_.running) return UnloadResult::kRunning;
  if (!state_.is_loaded()) return UnloadResult::kNotLoaded;

  force_unload();
  return UnloadResult::kUnloaded;
}

void Executor::force_unload() {
  state_.unload();
  effects_.state_changed();
}

void Executor::enter_event(int32_t index, const Event &event, bool play_audio) {
  state_.current_event_index.set(index);

  if (event.command == "show") {
    set_targets(true);
  } else if (event.command == "hide") {
    set_targets(false);
  }

  if (play_audio && !event.audio_ids.empty()) effects_.play_audios(event.audio_ids);
}

void Executor::complete_series(int32_t series_index) {
  state_.running = false;
  state_.ticker_ms.clear();
  clear_run_anchor();

  const int32_t next_index = series_index + 1;
  if (state_.program != nullptr &&
      static_cast<size_t>(next_index) < state_.program->series.size()) {
    // Another series follows: select it and wait, leaving the targets exactly
    // as the last event left them. Only a show or hide event turns them.
    //
    // This used to hide here, "ready for the shooter to be called forward".
    // That is wrong on this range: between series people walk downrange to
    // patch faces, and a target that turns while somebody is standing at it
    // can injure them. Face-on is also the resting position for the club's
    // other disciplines, which shoot these targets static.
    state_.current_series_index.set(next_index);
    state_.current_event_index.set(0);
  }
  // Both branches now leave the targets alone: the last series finishing keeps
  // the final state of the program on display, and so does every series before
  // it.

  effects_.state_changed();
}

int32_t Executor::tick() {
  if (!state_.running || !state_.has_series_start) return kIdleSleepMs;

  const Series *series = series_at(state_.current_series_index);
  if (series == nullptr) {
    state_.running = false;
    clear_run_anchor();
    effects_.state_changed();
    return kIdleSleepMs;
  }

  const int32_t total_ms = series->total_ms();
  const int64_t elapsed64 = clock_.now_ms() - state_.series_start_ms;
  // Anything at or past the end completes the series, so clamping the top end
  // loses nothing and keeps the maths in int32.
  const int32_t elapsed_ms =
      elapsed64 < 0 ? 0 : (elapsed64 > total_ms ? total_ms : static_cast<int32_t>(elapsed64));

  if (elapsed_ms >= total_ms) {
    complete_series(state_.current_series_index.value);
    return kIdleSleepMs;
  }

  const EventLocation loc = locate_event(*series, elapsed_ms);
  if (!loc.valid) {
    // Unreachable while elapsed < total, but a malformed series (an event with
    // a negative duration) could get here; stopping beats spinning.
    state_.running = false;
    clear_run_anchor();
    effects_.state_changed();
    return kIdleSleepMs;
  }

  bool changed = false;

  if (!state_.current_event_index.has_value || loc.index != state_.current_event_index.value) {
    enter_event(loc.index, series->events[static_cast<size_t>(loc.index)], true);
    changed = true;
  }

  // Millisecond precision, one-second cadence. The comparison is on whole
  // seconds on purpose: publishing whenever the millisecond changed would put
  // out a frame per run-loop wake - up to five a second - to move a playhead
  // no eye can follow that finely. What a frame carries is the exact elapsed
  // time, so the playhead lands where the run is instead of up to a second
  // behind it.
  const int32_t ticker_seconds = elapsed_ms / 1000;
  if (!state_.ticker_ms.has_value || state_.ticker_ms.value / 1000 != ticker_seconds) {
    changed = true;
  }

  // Set here rather than above so an event-boundary frame - which goes out
  // mid-second - carries the current time too, instead of the second's.
  if (changed) {
    state_.ticker_ms.set(elapsed_ms);
    effects_.state_changed();
  }

  return next_sleep_ms(elapsed_ms, loc.end_ms, total_ms);
}

}  // namespace rt
