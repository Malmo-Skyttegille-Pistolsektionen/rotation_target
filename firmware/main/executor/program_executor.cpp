#include "program_executor.h"

#include "audio.h"
#include "audios.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "executor.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "program_state.h"
#include "programs.h"
#include "sse_hub.h"
#include "targets.h"

namespace executor {
namespace {

const char *TAG = "executor";

class EspClock : public rt::Clock {
 public:
  int64_t now_ms() const override { return esp_timer_get_time() / 1000; }
};

class DeviceEffects : public rt::Effects {
 public:
  void set_targets(bool shown) override { targets::set(shown); }

  void play_audios(const std::vector<int32_t> &audio_ids) override {
    // Resolved here rather than in the run loop's caller so a missing id is a
    // skipped clip, not a failed event.
    audio::play(audios::paths_for(audio_ids));
  }

  void state_changed() override { pending_broadcast = true; }

  // The broadcast is deferred to the end of the locked section rather than
  // sent from here: PsychicEventSource fans out to every connected client, and
  // holding the run-state lock across that would let one slow socket stall the
  // run loop.
  bool pending_broadcast = false;
};

rt::ProgramState s_state;
EspClock s_clock;
DeviceEffects s_effects;
rt::Executor s_executor(s_state, s_clock, s_effects);

SemaphoreHandle_t s_lock = nullptr;
TaskHandle_t s_run_task = nullptr;

struct Lock {
  Lock() { xSemaphoreTakeRecursive(s_lock, portMAX_DELAY); }
  ~Lock() { xSemaphoreGiveRecursive(s_lock); }
};

// Publishes the state if anything changed while the lock was held, then wakes
// the run loop so a control call takes effect immediately instead of after the
// current sleep.
void flush(bool wake_run_loop) {
  {
    Lock lock;
    if (s_effects.pending_broadcast) {
      s_effects.pending_broadcast = false;
      // Serialized AND handed to the SSE hub under the same lock. The hub only
      // enqueues onto the httpd work queue - it does not touch a socket - so
      // this cannot block. Doing both under one lock is what keeps snapshot
      // order and send order identical: releasing between them let two tasks
      // snapshot A then B and send B then A, leaving every client holding a
      // stale final state that nothing would ever correct.
      sse_hub::broadcast_state(rt::state_update_json(s_state));
    }
  }

  // Outside the `pending_broadcast` check on purpose. A control call whose
  // broadcast was already consumed by the run loop's own flush still has to
  // wake the loop, or start() can lose up to kIdleSleepMs of series time.
  if (wake_run_loop && s_run_task != nullptr) xTaskNotifyGive(s_run_task);
}

void run_task(void *) {
  while (true) {
    int32_t sleep_ms = rt::Executor::kIdleSleepMs;
    {
      Lock lock;
      sleep_ms = s_executor.tick();
    }
    flush(false);

    // Woken early by any control call; otherwise this is the tick cadence the
    // executor asked for.
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(sleep_ms));
  }
}

}  // namespace

void init() {
  // Recursive: set_targets() is reached both directly and from inside the
  // executor's own locked section.
  s_lock = xSemaphoreCreateRecursiveMutex();
  configASSERT(s_lock != nullptr);

  // The pin powers up low, which is the *shown* position. Drive it to match
  // the hidden state a client is told about on connect - without this the
  // hardware and the first stateUpdate disagree until something moves.
  {
    Lock lock;
    s_executor.set_targets(false);
    s_effects.pending_broadcast = false;
  }

  if (xTaskCreate(run_task, "run_loop", 4096, nullptr, 4, &s_run_task) != pdPASS) {
    ESP_LOGE(TAG, "Failed to start the run loop");
  }
}

bool load(int32_t program_id) {
  bool ok = false;
  {
    Lock lock;
    ok = s_executor.load(programs::get(program_id));
  }
  flush(true);
  return ok;
}

bool start() {
  bool ok = false;
  {
    Lock lock;
    ok = s_executor.start();
  }
  flush(true);
  return ok;
}

bool stop() {
  bool ok = false;
  {
    Lock lock;
    ok = s_executor.stop();
  }
  flush(true);
  return ok;
}

bool reset() {
  bool ok = false;
  {
    Lock lock;
    ok = s_executor.reset();
  }
  flush(true);
  return ok;
}

bool skip_to_series(int32_t series_index) {
  bool ok = false;
  {
    Lock lock;
    ok = s_executor.skip_to_series(series_index);
  }
  flush(true);
  return ok;
}

void set_targets(bool shown) {
  {
    Lock lock;
    s_executor.set_targets(shown);
    s_effects.pending_broadcast = true;
  }
  flush(false);
}

bool toggle_targets() {
  bool shown = false;
  {
    Lock lock;
    shown = s_executor.toggle_targets();
    s_effects.pending_broadcast = true;
  }
  flush(false);
  return shown;
}

bool unload_if_loaded(int32_t program_id) {
  bool unloaded = false;
  {
    Lock lock;
    if (s_state.program != nullptr && s_state.program->id == program_id) {
      s_executor.unload();
      unloaded = true;
    }
  }
  flush(true);
  return unloaded;
}

bool is_loaded(int32_t program_id) {
  Lock lock;
  return s_state.program != nullptr && s_state.program->id == program_id;
}

bool is_running() {
  Lock lock;
  return s_state.running;
}

bool loaded_program_uses_audio(int32_t audio_id) {
  Lock lock;
  return s_state.program != nullptr && rt::program_uses_audio(*s_state.program, audio_id);
}

std::string state_json() {
  Lock lock;
  return rt::state_update_json(s_state);
}

}  // namespace executor
