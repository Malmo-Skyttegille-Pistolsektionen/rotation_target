#pragma once

#include <cstdint>
#include <string>

#include "executor.h"

// The firmware side of rt::Executor: a run-loop task, the real clock, and the
// real side effects (target GPIO, I2S playback, SSE broadcast).
//
// Every function here takes the state lock, so they are safe to call from the
// httpd task while the run loop is mid-series. The run state machine itself
// lives in lib/rt_logic and is covered by host_test/test_executor.
namespace executor {

// Starts the run-loop task and drives the targets to the hidden position.
// `targets_shown` is the state the pin was already driven to by targets::init().
// The executor adopts it rather than picking its own, so no boot drives an edge
// onto the target line that is immediately corrected (#145).
void init(bool targets_shown);

// `program_id` is looked up in the program repository; false means no such
// program, which the caller turns into a 404.
bool load(int32_t program_id);

// What a start did, together with the program the device actually holds so the
// refusal can name it. `loaded_program_id` is `kNoProgram` when nothing is
// loaded. Returned as one value because the answer and the id have to be read
// inside the same locked section to agree with each other.
struct StartOutcome {
  static constexpr int32_t kNoProgram = -1;

  rt::StartResult result;
  int32_t loaded_program_id;
};

// Starts the loaded program, but only if it is `expected_program_id` (#95).
StartOutcome start(int32_t expected_program_id);

bool stop();
bool reset();

// What a skip_to did, together with the program the device actually holds -
// same shape as StartOutcome and for the same reason (#105).
struct SkipOutcome {
  static constexpr int32_t kNoProgram = -1;

  rt::SkipResult result;
  int32_t loaded_program_id;
};

// Selects `series_index`, but only if `expected_program_id` is loaded (#105).
SkipOutcome skip_to_series(int32_t series_index, int32_t expected_program_id);

void set_targets(bool shown);
// Returns the resulting state.
bool toggle_targets();

// Clears the selection on behalf of POST /programs/unload. Refused while a run
// is in progress; nothing loaded is a no-op that publishes nothing.
rt::UnloadResult unload();

// Drops the loaded program if it is `program_id` - used when a program is
// deleted out from under a run, which is refused for no run state. Returns
// whether anything was unloaded.
bool unload_if_loaded(int32_t program_id);

// Whether `program_id` is the program currently loaded. Lets a handler refuse
// a mutation that would replace a program the run loop holds a pointer into.
bool is_loaded(int32_t program_id);

// Whether a run is in progress. `stop()` is a pause, so this is false between
// runs of a program that is still loaded.
bool is_running();

// Whether the loaded program plays `audio_id` in any event of any series.
// False when nothing is loaded. The program pointer stays behind the lock -
// handing it out would let a caller read it after a delete unloaded it.
bool loaded_program_uses_audio(int32_t audio_id);

// The current stateUpdate payload.
std::string state_json();

}  // namespace executor
