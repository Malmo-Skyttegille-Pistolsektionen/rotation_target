// ============================================================================
//  Run state machine: control surface and the stateUpdate sequence a client
//  actually sees. Ported from tests/unit/executor/test_program_executor.py and
//  tests/integration/test_run_flow.py of the MicroPython backend.
// ============================================================================
#include <string>

#include "fake_runtime.h"
#include "unity.h"

using rt_test::Harness;

namespace {

// The fixture's program id. Every start names it, because a start for any
// other id is refused (#95).
constexpr int32_t kFixtureId = 900;

// Two short series: S0 shows for 200 ms then hides for 200 ms, S1 shows for
// 200 ms. Same fixture the MicroPython suite used.
rt::Program fixture_program() {
  rt::Program p;
  p.id = kFixtureId;
  p.title = "Fixture";
  p.description = "Two short series";

  rt::Series s0;
  s0.name = "S0";
  s0.events.push_back(rt::Event{200, "show", {}});
  s0.events.push_back(rt::Event{200, "hide", {}});

  rt::Series s1;
  s1.name = "S1";
  s1.events.push_back(rt::Event{200, "show", {}});

  p.series.push_back(s0);
  p.series.push_back(s1);
  return p;
}

// The stateUpdate payload for a loaded program 900. `ticker` and the indices
// take "null" as a string so the nullable cases read literally.
std::string state(const char *running, const char *series, const char *event, const char *ticker,
                  const char *target) {
  return std::string("{\"loadedProgramId\":900,\"programState\":{\"running\":") + running +
         ",\"currentSeriesIndex\":" + series + ",\"currentEventIndex\":" + event +
         ",\"tickerMs\":" + ticker + "},\"targetStatus\":\"" + target + "\"}";
}

rt::Program g_program;
Harness *h = nullptr;

}  // namespace

void setUp() {
  g_program = fixture_program();
  h = new Harness();
}

void tearDown() {
  delete h;
  h = nullptr;
}

// --- load ------------------------------------------------------------------

void test_load_sets_the_start_position() {
  TEST_ASSERT_TRUE(h->executor.load(&g_program));

  TEST_ASSERT_EQUAL_STRING(state("false", "0", "0", "null", "hidden").c_str(),
                           rt::state_update_json(h->state).c_str());
  TEST_ASSERT_EQUAL_size_t(1, h->effects.broadcasts.size());
}

void test_load_unknown_program_is_refused() {
  TEST_ASSERT_FALSE(h->executor.load(nullptr));

  TEST_ASSERT_FALSE(h->state.is_loaded());
  TEST_ASSERT_EQUAL_size_t(0, h->effects.broadcasts.size());
}

// --- start -----------------------------------------------------------------

void test_start_without_a_program_is_refused() {
  TEST_ASSERT_EQUAL(rt::StartResult::kNotLoaded, h->executor.start(kFixtureId));
}

void test_start_enters_the_first_event() {
  h->executor.load(&g_program);
  h->effects.clear();

  TEST_ASSERT_EQUAL(rt::StartResult::kStarted, h->executor.start(kFixtureId));

  TEST_ASSERT_TRUE(h->state.running);
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_event_index.value);
  TEST_ASSERT_EQUAL_INT32(0, h->state.ticker_ms.value);
  TEST_ASSERT_TRUE(h->state.target_status_shown);
  TEST_ASSERT_EQUAL_size_t(1, h->effects.target_history.size());
  TEST_ASSERT_TRUE(h->effects.target_history[0]);
}

void test_start_while_running_does_not_restart() {
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);
  const int64_t anchor = h->state.series_start_ms;

  h->clock.advance(50);
  TEST_ASSERT_EQUAL(rt::StartResult::kStarted, h->executor.start(kFixtureId));

  TEST_ASSERT_EQUAL_INT64(anchor, h->state.series_start_ms);
}

// --- #95: a start names the program it was decided for ---------------------

void test_start_for_another_program_is_refused() {
  h->executor.load(&g_program);
  h->effects.clear();

  TEST_ASSERT_EQUAL(rt::StartResult::kMismatch, h->executor.start(kFixtureId + 1));

  // Nothing moved: no run, no targets driven, and no stateUpdate that would
  // tell clients something had happened.
  TEST_ASSERT_FALSE(h->state.running);
  TEST_ASSERT_EQUAL_size_t(0, h->effects.broadcasts.size());
  TEST_ASSERT_EQUAL_size_t(0, h->effects.target_history.size());
}

void test_start_for_another_program_is_refused_while_one_is_running() {
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);
  const int64_t anchor = h->state.series_start_ms;
  h->effects.clear();

  // Ahead of the already-running short circuit: a start aimed at the wrong
  // program must not be answered "fine, it is running".
  TEST_ASSERT_EQUAL(rt::StartResult::kMismatch, h->executor.start(kFixtureId + 1));

  TEST_ASSERT_TRUE(h->state.running);
  TEST_ASSERT_EQUAL_INT64(anchor, h->state.series_start_ms);
  TEST_ASSERT_EQUAL_size_t(0, h->effects.broadcasts.size());
}

void test_a_refused_start_leaves_the_right_program_startable() {
  h->executor.load(&g_program);
  TEST_ASSERT_EQUAL(rt::StartResult::kMismatch, h->executor.start(kFixtureId + 1));

  TEST_ASSERT_EQUAL(rt::StartResult::kStarted, h->executor.start(kFixtureId));
  TEST_ASSERT_TRUE(h->state.running);
}

void test_nothing_loaded_outranks_the_id_check() {
  // The contract's `400 No program loaded` for this case predates #95 and
  // stays: "nothing is loaded" is the more precise diagnosis, and a client that
  // gets it knows to load rather than to re-read what is loaded.
  TEST_ASSERT_EQUAL(rt::StartResult::kNotLoaded, h->executor.start(kFixtureId));
  TEST_ASSERT_EQUAL(rt::StartResult::kNotLoaded, h->executor.start(kFixtureId + 1));
}

void test_events_advance_and_the_series_pauses_at_the_next_one() {
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);

  h->run_to_idle();

  TEST_ASSERT_FALSE(h->state.running);
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_event_index.value);
  TEST_ASSERT_FALSE(h->state.ticker_ms.has_value);

  // show (event 0), hide (event 1) - and nothing at the series boundary. The
  // boundary used to drive a third, redundant hide; completing a series now
  // leaves the targets exactly where the last event left them.
  TEST_ASSERT_EQUAL_size_t(2, h->effects.target_history.size());
  TEST_ASSERT_TRUE(h->effects.target_history[0]);
  TEST_ASSERT_FALSE(h->effects.target_history[1]);
}

void test_program_completion_leaves_the_last_series_selected() {
  h->executor.load(&g_program);
  h->executor.skip_to_series(1, kFixtureId);
  h->executor.start(kFixtureId);

  h->run_to_idle();

  TEST_ASSERT_FALSE(h->state.running);
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_FALSE(h->state.ticker_ms.has_value);
}

void test_audio_is_played_when_an_event_is_entered() {
  rt::Program p;
  p.id = 901;
  rt::Series s;
  s.events.push_back(rt::Event{100, "", {1, 7}});
  p.series.push_back(s);

  h->executor.load(&p);
  h->executor.start(p.id);

  TEST_ASSERT_EQUAL_size_t(1, h->effects.played.size());
  TEST_ASSERT_EQUAL_size_t(2, h->effects.played[0].size());
  TEST_ASSERT_EQUAL_INT32(1, h->effects.played[0][0]);
  TEST_ASSERT_EQUAL_INT32(7, h->effects.played[0][1]);
}

// --- stop ------------------------------------------------------------------

void test_stop_when_not_running_is_refused() {
  h->executor.load(&g_program);

  TEST_ASSERT_FALSE(h->executor.stop());
}

void test_stop_keeps_the_position() {
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);
  h->run_for(250);

  TEST_ASSERT_TRUE(h->executor.stop());

  TEST_ASSERT_FALSE(h->state.running);
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_event_index.value);
  // The last frame went out at the 200 ms event boundary, and the ticker
  // carries that exact millisecond - not the whole second it rounded to
  // before D-16.
  TEST_ASSERT_EQUAL_INT32(200, h->state.ticker_ms.value);
  TEST_ASSERT_FALSE(h->state.has_series_start);
}

void test_start_resumes_from_the_paused_ticker() {
  h->executor.load(&g_program);
  h->state.ticker_ms.set(1000);

  h->executor.start(kFixtureId);

  // 1000 ms into a 400 ms series is past the end, so the first tick completes
  // it and moves to the next series.
  h->run_to_idle();
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_FALSE(h->state.running);
}

void test_resuming_mid_event_does_not_replay_its_audio() {
  rt::Program p;
  p.id = 902;
  rt::Series s;
  // One long event with audio, so a 1 s resume lands inside it.
  s.events.push_back(rt::Event{5000, "show", {3}});
  p.series.push_back(s);

  h->executor.load(&p);
  h->state.ticker_ms.set(1000);
  h->effects.clear();

  h->executor.start(p.id);

  TEST_ASSERT_EQUAL_size_t(0, h->effects.played.size());
}

// --- reset -----------------------------------------------------------------

void test_reset_without_a_program_is_refused() {
  TEST_ASSERT_FALSE(h->executor.reset());
}

void test_reset_rewinds_the_current_series() {
  h->executor.load(&g_program);
  h->executor.skip_to_series(1, kFixtureId);
  h->state.current_event_index.set(3);
  h->state.ticker_ms.set(7000);

  TEST_ASSERT_TRUE(h->executor.reset());

  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_event_index.value);
  TEST_ASSERT_FALSE(h->state.ticker_ms.has_value);
  TEST_ASSERT_FALSE(h->state.running);
}

// --- skip_to ---------------------------------------------------------------

void test_skip_to_a_valid_series() {
  h->executor.load(&g_program);
  h->effects.clear();

  TEST_ASSERT_EQUAL(rt::SkipResult::kSkipped, h->executor.skip_to_series(1, kFixtureId));

  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_event_index.value);
  TEST_ASSERT_FALSE(h->state.ticker_ms.has_value);
  TEST_ASSERT_EQUAL_STRING(state("false", "1", "0", "null", "hidden").c_str(),
                           h->effects.broadcasts.back().c_str());
}

void test_skip_out_of_bounds_leaves_the_state_alone() {
  h->executor.load(&g_program);

  TEST_ASSERT_EQUAL(rt::SkipResult::kInvalid, h->executor.skip_to_series(2, kFixtureId));
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_series_index.value);
}

void test_skip_without_a_program_is_refused() {
  TEST_ASSERT_EQUAL(rt::SkipResult::kInvalid, h->executor.skip_to_series(0, kFixtureId));
}

void test_skip_stops_a_running_series() {
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);

  h->executor.skip_to_series(1, kFixtureId);

  TEST_ASSERT_FALSE(h->state.running);
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_EQUAL_INT32(rt::Executor::kIdleSleepMs, h->executor.tick());
}

// --- #105: a skip names the program the index is for ------------------------

void test_skip_for_another_program_is_refused() {
  h->executor.load(&g_program);
  h->effects.clear();

  TEST_ASSERT_EQUAL(rt::SkipResult::kMismatch, h->executor.skip_to_series(1, kFixtureId + 1));

  // Nothing moved: no selection change and no stateUpdate that would tell
  // clients something had happened.
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_series_index.value);
  TEST_ASSERT_EQUAL_size_t(0, h->effects.broadcasts.size());
}

void test_skip_for_another_program_is_refused_while_one_is_running() {
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);
  h->effects.clear();

  // Ahead of the bounds check: a skip aimed at the wrong program must not be
  // answered "index valid" against a program it was never decided for.
  TEST_ASSERT_EQUAL(rt::SkipResult::kMismatch, h->executor.skip_to_series(1, kFixtureId + 1));

  TEST_ASSERT_TRUE(h->state.running);
  TEST_ASSERT_EQUAL_size_t(0, h->effects.broadcasts.size());
}

void test_mismatch_outranks_an_out_of_bounds_index() {
  h->executor.load(&g_program);

  // Mirrors start's "nothing loaded outranks the id check" - here the id
  // check is what runs first, ahead of a bounds check that would otherwise be
  // evaluated against a program the caller never named.
  TEST_ASSERT_EQUAL(rt::SkipResult::kMismatch, h->executor.skip_to_series(99, kFixtureId + 1));
}

void test_a_refused_skip_leaves_the_right_program_skippable() {
  h->executor.load(&g_program);
  TEST_ASSERT_EQUAL(rt::SkipResult::kMismatch, h->executor.skip_to_series(1, kFixtureId + 1));

  TEST_ASSERT_EQUAL(rt::SkipResult::kSkipped, h->executor.skip_to_series(1, kFixtureId));
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
}

void test_nothing_loaded_outranks_the_skip_id_check() {
  // Same precedence as start's equivalent case: "nothing is loaded" is the
  // more precise diagnosis, and the contract keeps it a plain `400` regardless
  // of what id was sent.
  TEST_ASSERT_EQUAL(rt::SkipResult::kInvalid, h->executor.skip_to_series(0, kFixtureId));
  TEST_ASSERT_EQUAL(rt::SkipResult::kInvalid, h->executor.skip_to_series(0, kFixtureId + 1));
}

// --- the stateUpdate stream ------------------------------------------------

void test_a_series_streams_one_state_update_per_transition() {
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);
  h->run_to_idle();

  TEST_ASSERT_EQUAL_size_t(4, h->effects.broadcasts.size());
  TEST_ASSERT_EQUAL_STRING(state("false", "0", "0", "null", "hidden").c_str(),
                           h->effects.broadcasts[0].c_str());
  TEST_ASSERT_EQUAL_STRING(state("true", "0", "0", "0", "shown").c_str(),
                           h->effects.broadcasts[1].c_str());
  TEST_ASSERT_EQUAL_STRING(state("true", "0", "1", "200", "hidden").c_str(),
                           h->effects.broadcasts[2].c_str());
  TEST_ASSERT_EQUAL_STRING(state("false", "1", "0", "null", "hidden").c_str(),
                           h->effects.broadcasts[3].c_str());
}

void test_a_long_event_publishes_once_a_second_not_once_a_tick() {
  rt::Program p;
  p.id = kFixtureId;
  rt::Series s;
  s.events.push_back(rt::Event{5000, "show", {}});
  p.series.push_back(s);

  h->executor.load(&p);
  h->executor.start(kFixtureId);
  h->effects.clear();

  h->run_for(2500);

  // The load-bearing half of D-16: the ticker carries milliseconds, but the
  // frame rate did not change with it. Inside a long event the run loop wakes
  // every kMaxSleepMs (200 ms), thirteen times over these 2.5 s - and two
  // frames go out, one per whole second. Publishing on a changed millisecond
  // instead would put out all thirteen.
  TEST_ASSERT_EQUAL_size_t(2, h->effects.broadcasts.size());
  TEST_ASSERT_EQUAL_STRING(state("true", "0", "0", "1000", "shown").c_str(),
                           h->effects.broadcasts[0].c_str());
  TEST_ASSERT_EQUAL_STRING(state("true", "0", "0", "2000", "shown").c_str(),
                           h->effects.broadcasts[1].c_str());
}

void test_pause_and_resume_keeps_the_position() {
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);
  h->run_for(250);
  h->executor.stop();

  TEST_ASSERT_EQUAL_STRING(state("false", "0", "1", "200", "hidden").c_str(),
                           h->effects.broadcasts.back().c_str());

  h->executor.start(kFixtureId);

  // This is what D-16 bought. The whole-second ticker resumed a 250 ms pause
  // from 0 - back at event 0 with the targets shown again, a visible rewind
  // the MicroPython backend had too. The millisecond ticker resumes from the
  // last published position, 200 ms, which is still inside event 1.
  TEST_ASSERT_TRUE(h->state.running);
  TEST_ASSERT_EQUAL_STRING(state("true", "0", "1", "200", "hidden").c_str(),
                           h->effects.broadcasts.back().c_str());
}

void test_resume_after_a_multi_second_pause_keeps_the_event() {
  rt::Program p;
  p.id = kFixtureId;
  rt::Series s;
  s.events.push_back(rt::Event{1000, "show", {}});
  s.events.push_back(rt::Event{5000, "hide", {}});
  p.series.push_back(s);

  h->executor.load(&p);
  h->executor.start(kFixtureId);
  h->run_for(2500);
  h->executor.stop();

  TEST_ASSERT_EQUAL_INT32(1, h->state.current_event_index.value);
  TEST_ASSERT_EQUAL_INT32(2000, h->state.ticker_ms.value);

  h->executor.start(kFixtureId);

  // 2 s lands inside event 1, so the position survives the pause.
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_event_index.value);
  TEST_ASSERT_EQUAL_INT32(2000, h->state.ticker_ms.value);
}

void test_reset_returns_to_the_start_of_the_series() {
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);
  h->run_for(250);

  h->executor.reset();

  TEST_ASSERT_EQUAL_STRING(state("false", "0", "0", "null", "hidden").c_str(),
                           h->effects.broadcasts.back().c_str());
}

void test_reset_leaves_the_targets_where_they_are() {
  // Deliberate, and matching the MicroPython backend: reset() rewinds the
  // position but does not move the hardware. Only a series boundary hides the
  // targets. Asserted here because the published state must stay honest about
  // it - the existing reset test resets 250 ms in, which is already inside the
  // "hide" event, so the shown case was never covered.
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);  // event 0 is "show"

  TEST_ASSERT_TRUE(h->state.target_status_shown);

  h->executor.reset();

  TEST_ASSERT_TRUE(h->state.target_status_shown);
  TEST_ASSERT_EQUAL_STRING(state("false", "0", "0", "null", "shown").c_str(),
                           h->effects.broadcasts.back().c_str());
}

// --- unload ----------------------------------------------------------------

void test_unloading_clears_the_published_state() {
  h->executor.load(&g_program);

  TEST_ASSERT_EQUAL(rt::UnloadResult::kUnloaded, h->executor.unload());

  TEST_ASSERT_FALSE(h->state.is_loaded());
  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":null,\"programState\":null,\"targetStatus\":\"hidden\"}",
      h->effects.broadcasts.back().c_str());
}

void test_unload_while_running_is_refused() {
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);
  h->run_for(100);
  h->effects.clear();

  TEST_ASSERT_EQUAL(rt::UnloadResult::kRunning, h->executor.unload());

  // Not a partial refusal: the run keeps its program, its position and its
  // targets, and no client is told anything happened.
  TEST_ASSERT_TRUE(h->state.is_loaded());
  TEST_ASSERT_TRUE(h->state.running);
  TEST_ASSERT_TRUE(h->state.target_status_shown);
  TEST_ASSERT_EQUAL_size_t(0, h->effects.broadcasts.size());
}

void test_unload_after_a_stop_is_allowed() {
  // stop() is a pause, so the refusal has to lift with it - otherwise the
  // 409 has no escape and the endpoint solves nothing.
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);
  h->run_for(100);
  h->executor.stop();
  h->effects.clear();

  TEST_ASSERT_EQUAL(rt::UnloadResult::kUnloaded, h->executor.unload());

  TEST_ASSERT_FALSE(h->state.is_loaded());
  TEST_ASSERT_EQUAL_size_t(1, h->effects.broadcasts.size());
  // The targets stay where the run left them; unloading moves no hardware.
  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":null,\"programState\":null,\"targetStatus\":\"shown\"}",
      h->effects.broadcasts.back().c_str());
}

void test_unload_with_nothing_loaded_publishes_nothing() {
  // Idempotent: the second unload of a pair is this case, and repeating a
  // stateUpdate identical to the last one tells a client nothing.
  TEST_ASSERT_EQUAL(rt::UnloadResult::kNotLoaded, h->executor.unload());

  TEST_ASSERT_FALSE(h->state.is_loaded());
  TEST_ASSERT_EQUAL_size_t(0, h->effects.broadcasts.size());
}

void test_force_unload_drops_a_running_program() {
  // The delete path: the program is going away whatever the run state, because
  // the run loop's pointer into it would dangle.
  h->executor.load(&g_program);
  h->executor.start(kFixtureId);
  h->run_for(100);
  h->effects.clear();

  h->executor.force_unload();

  TEST_ASSERT_FALSE(h->state.is_loaded());
  TEST_ASSERT_FALSE(h->state.running);
  TEST_ASSERT_EQUAL_size_t(1, h->effects.broadcasts.size());
}

// --- targets ---------------------------------------------------------------

void test_completing_a_series_leaves_the_targets_where_the_last_event_left_them() {
  // The shared fixture's first series ends on "hide", so it cannot tell a
  // deliberate "leave them alone" apart from a hide-on-completion. This one
  // ends on "show" and there is a series after it - the exact case that used
  // to turn the targets edge-on while the range waited for the next start.
  rt::Program p;
  p.id = kFixtureId;
  p.title = "Ends shown";
  p.description = "First series finishes with the targets face-on";

  rt::Series s0;
  s0.name = "S0";
  s0.events.push_back(rt::Event{200, "show", {}});

  rt::Series s1;
  s1.name = "S1";
  s1.events.push_back(rt::Event{200, "show", {}});

  p.series.push_back(s0);
  p.series.push_back(s1);

  h->executor.load(&p);
  h->executor.start(kFixtureId);
  h->run_to_idle();

  // Waiting at the start of the next series, and still face-on.
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_event_index.value);
  TEST_ASSERT_FALSE(h->state.running);
  TEST_ASSERT_TRUE(h->state.target_status_shown);
  TEST_ASSERT_EQUAL_STRING(state("false", "1", "0", "null", "shown").c_str(),
                           h->effects.broadcasts.back().c_str());

  // And nothing drove the pin after the event that showed them: people walk
  // downrange between series, so the targets must not move on their own.
  TEST_ASSERT_EQUAL_size_t(1, h->effects.target_history.size());
  TEST_ASSERT_TRUE(h->effects.target_history[0]);
}

void test_toggle_targets_flips_the_published_flag_and_the_pin() {
  TEST_ASSERT_TRUE(h->executor.toggle_targets());
  TEST_ASSERT_TRUE(h->state.target_status_shown);

  TEST_ASSERT_FALSE(h->executor.toggle_targets());
  TEST_ASSERT_FALSE(h->state.target_status_shown);

  TEST_ASSERT_EQUAL_size_t(2, h->effects.target_history.size());
  TEST_ASSERT_TRUE(h->effects.target_history[0]);
  TEST_ASSERT_FALSE(h->effects.target_history[1]);
}

int main() {
  UNITY_BEGIN();

  RUN_TEST(test_load_sets_the_start_position);
  RUN_TEST(test_load_unknown_program_is_refused);

  RUN_TEST(test_start_without_a_program_is_refused);
  RUN_TEST(test_start_enters_the_first_event);
  RUN_TEST(test_start_while_running_does_not_restart);
  RUN_TEST(test_start_for_another_program_is_refused);
  RUN_TEST(test_start_for_another_program_is_refused_while_one_is_running);
  RUN_TEST(test_a_refused_start_leaves_the_right_program_startable);
  RUN_TEST(test_nothing_loaded_outranks_the_id_check);
  RUN_TEST(test_events_advance_and_the_series_pauses_at_the_next_one);
  RUN_TEST(test_program_completion_leaves_the_last_series_selected);
  RUN_TEST(test_audio_is_played_when_an_event_is_entered);

  RUN_TEST(test_stop_when_not_running_is_refused);
  RUN_TEST(test_stop_keeps_the_position);
  RUN_TEST(test_start_resumes_from_the_paused_ticker);
  RUN_TEST(test_resuming_mid_event_does_not_replay_its_audio);

  RUN_TEST(test_reset_without_a_program_is_refused);
  RUN_TEST(test_reset_rewinds_the_current_series);

  RUN_TEST(test_skip_to_a_valid_series);
  RUN_TEST(test_skip_out_of_bounds_leaves_the_state_alone);
  RUN_TEST(test_skip_without_a_program_is_refused);
  RUN_TEST(test_skip_stops_a_running_series);
  RUN_TEST(test_skip_for_another_program_is_refused);
  RUN_TEST(test_skip_for_another_program_is_refused_while_one_is_running);
  RUN_TEST(test_mismatch_outranks_an_out_of_bounds_index);
  RUN_TEST(test_a_refused_skip_leaves_the_right_program_skippable);
  RUN_TEST(test_nothing_loaded_outranks_the_skip_id_check);

  RUN_TEST(test_a_series_streams_one_state_update_per_transition);
  RUN_TEST(test_a_long_event_publishes_once_a_second_not_once_a_tick);
  RUN_TEST(test_pause_and_resume_keeps_the_position);
  RUN_TEST(test_resume_after_a_multi_second_pause_keeps_the_event);
  RUN_TEST(test_reset_returns_to_the_start_of_the_series);
  RUN_TEST(test_reset_leaves_the_targets_where_they_are);
  RUN_TEST(test_unloading_clears_the_published_state);
  RUN_TEST(test_unload_while_running_is_refused);
  RUN_TEST(test_unload_after_a_stop_is_allowed);
  RUN_TEST(test_unload_with_nothing_loaded_publishes_nothing);
  RUN_TEST(test_force_unload_drops_a_running_program);

  RUN_TEST(test_completing_a_series_leaves_the_targets_where_the_last_event_left_them);
  RUN_TEST(test_toggle_targets_flips_the_published_flag_and_the_pin);

  return UNITY_END();
}
