#pragma once

#include <cstdint>
#include <string>

// The firmware side of rt::Executor: a run-loop task, the real clock, and the
// real side effects (target GPIO, I2S playback, SSE broadcast).
//
// Every function here takes the state lock, so they are safe to call from the
// httpd task while the run loop is mid-series. The run state machine itself
// lives in lib/rt_logic and is covered by host_test/test_executor.
namespace executor {

// Starts the run-loop task and drives the targets to the hidden position.
void init();

// `program_id` is looked up in the program repository; false means no such
// program, which the caller turns into a 404.
bool load(int32_t program_id);
bool start();
bool stop();
bool reset();
bool skip_to_series(int32_t series_index);

void set_targets(bool shown);
// Returns the resulting state.
bool toggle_targets();

// Drops the loaded program if it is `program_id` - used when a program is
// deleted out from under a run. Returns whether anything was unloaded.
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
