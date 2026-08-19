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

// Two short series: S0 shows for 200 ms then hides for 200 ms, S1 shows for
// 200 ms. Same fixture the MicroPython suite used.
rt::Program fixture_program() {
  rt::Program p;
  p.id = 900;
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
         ",\"tickerSeconds\":" + ticker + "},\"targetStatus\":\"" + target + "\"}";
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
  TEST_ASSERT_FALSE(h->executor.start());
}

void test_start_enters_the_first_event() {
  h->executor.load(&g_program);
  h->effects.clear();

  TEST_ASSERT_TRUE(h->executor.start());

  TEST_ASSERT_TRUE(h->state.running);
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_event_index.value);
  TEST_ASSERT_EQUAL_INT32(0, h->state.ticker_seconds.value);
  TEST_ASSERT_TRUE(h->state.target_status_shown);
  TEST_ASSERT_EQUAL_size_t(1, h->effects.target_history.size());
  TEST_ASSERT_TRUE(h->effects.target_history[0]);
}

void test_start_while_running_does_not_restart() {
  h->executor.load(&g_program);
  h->executor.start();
  const int64_t anchor = h->state.series_start_ms;

  h->clock.advance(50);
  TEST_ASSERT_TRUE(h->executor.start());

  TEST_ASSERT_EQUAL_INT64(anchor, h->state.series_start_ms);
}

void test_events_advance_and_the_series_pauses_at_the_next_one() {
  h->executor.load(&g_program);
  h->executor.start();

  h->run_to_idle();

  TEST_ASSERT_FALSE(h->state.running);
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_event_index.value);
  TEST_ASSERT_FALSE(h->state.ticker_seconds.has_value);

  // show (event 0), hide (event 1), hide (series boundary)
  TEST_ASSERT_EQUAL_size_t(3, h->effects.target_history.size());
  TEST_ASSERT_TRUE(h->effects.target_history[0]);
  TEST_ASSERT_FALSE(h->effects.target_history[1]);
  TEST_ASSERT_FALSE(h->effects.target_history[2]);
}

void test_program_completion_leaves_the_last_series_selected() {
  h->executor.load(&g_program);
  h->executor.skip_to_series(1);
  h->executor.start();

  h->run_to_idle();

  TEST_ASSERT_FALSE(h->state.running);
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_FALSE(h->state.ticker_seconds.has_value);
}

void test_audio_is_played_when_an_event_is_entered() {
  rt::Program p;
  p.id = 901;
  rt::Series s;
  s.events.push_back(rt::Event{100, "", {1, 7}});
  p.series.push_back(s);

  h->executor.load(&p);
  h->executor.start();

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
  h->executor.start();
  h->run_for(250);

  TEST_ASSERT_TRUE(h->executor.stop());

  TEST_ASSERT_FALSE(h->state.running);
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_event_index.value);
  TEST_ASSERT_EQUAL_INT32(0, h->state.ticker_seconds.value);
  TEST_ASSERT_FALSE(h->state.has_series_start);
}

void test_start_resumes_from_the_paused_ticker() {
  h->executor.load(&g_program);
  h->state.ticker_seconds.set(1);

  h->executor.start();

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
  h->state.ticker_seconds.set(1);
  h->effects.clear();

  h->executor.start();

  TEST_ASSERT_EQUAL_size_t(0, h->effects.played.size());
}

// --- reset -----------------------------------------------------------------

void test_reset_without_a_program_is_refused() {
  TEST_ASSERT_FALSE(h->executor.reset());
}

void test_reset_rewinds_the_current_series() {
  h->executor.load(&g_program);
  h->executor.skip_to_series(1);
  h->state.current_event_index.set(3);
  h->state.ticker_seconds.set(7);

  TEST_ASSERT_TRUE(h->executor.reset());

  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_event_index.value);
  TEST_ASSERT_FALSE(h->state.ticker_seconds.has_value);
  TEST_ASSERT_FALSE(h->state.running);
}

// --- skip_to ---------------------------------------------------------------

void test_skip_to_a_valid_series() {
  h->executor.load(&g_program);
  h->effects.clear();

  TEST_ASSERT_TRUE(h->executor.skip_to_series(1));

  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_event_index.value);
  TEST_ASSERT_FALSE(h->state.ticker_seconds.has_value);
  TEST_ASSERT_EQUAL_STRING(state("false", "1", "0", "null", "hidden").c_str(),
                           h->effects.broadcasts.back().c_str());
}

void test_skip_out_of_bounds_leaves_the_state_alone() {
  h->executor.load(&g_program);

  TEST_ASSERT_FALSE(h->executor.skip_to_series(2));
  TEST_ASSERT_EQUAL_INT32(0, h->state.current_series_index.value);
}

void test_skip_without_a_program_is_refused() {
  TEST_ASSERT_FALSE(h->executor.skip_to_series(0));
}

void test_skip_stops_a_running_series() {
  h->executor.load(&g_program);
  h->executor.start();

  h->executor.skip_to_series(1);

  TEST_ASSERT_FALSE(h->state.running);
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_series_index.value);
  TEST_ASSERT_EQUAL_INT32(rt::Executor::kIdleSleepMs, h->executor.tick());
}

// --- the stateUpdate stream ------------------------------------------------

void test_a_series_streams_one_state_update_per_transition() {
  h->executor.load(&g_program);
  h->executor.start();
  h->run_to_idle();

  TEST_ASSERT_EQUAL_size_t(4, h->effects.broadcasts.size());
  TEST_ASSERT_EQUAL_STRING(state("false", "0", "0", "null", "hidden").c_str(),
                           h->effects.broadcasts[0].c_str());
  TEST_ASSERT_EQUAL_STRING(state("true", "0", "0", "0", "shown").c_str(),
                           h->effects.broadcasts[1].c_str());
  TEST_ASSERT_EQUAL_STRING(state("true", "0", "1", "0", "hidden").c_str(),
                           h->effects.broadcasts[2].c_str());
  TEST_ASSERT_EQUAL_STRING(state("false", "1", "0", "null", "hidden").c_str(),
                           h->effects.broadcasts[3].c_str());
}

void test_pause_and_resume_keeps_the_position() {
  h->executor.load(&g_program);
  h->executor.start();
  h->run_for(250);
  h->executor.stop();

  TEST_ASSERT_EQUAL_STRING(state("false", "0", "1", "0", "hidden").c_str(),
                           h->effects.broadcasts.back().c_str());

  h->executor.start();

  // tickerSeconds is whole seconds, so a pause 250 ms in resumes from 0 -
  // back at event 0, targets shown again. Sub-second rewind is inherent to
  // the contract's second-granularity resume point and matches the
  // MicroPython backend exactly; real programs have multi-second events, so
  // it is never visible in practice.
  TEST_ASSERT_TRUE(h->state.running);
  TEST_ASSERT_EQUAL_STRING(state("true", "0", "0", "0", "shown").c_str(),
                           h->effects.broadcasts.back().c_str());
}

void test_resume_after_a_multi_second_pause_keeps_the_event() {
  rt::Program p;
  p.id = 900;
  rt::Series s;
  s.events.push_back(rt::Event{1000, "show", {}});
  s.events.push_back(rt::Event{5000, "hide", {}});
  p.series.push_back(s);

  h->executor.load(&p);
  h->executor.start();
  h->run_for(2500);
  h->executor.stop();

  TEST_ASSERT_EQUAL_INT32(1, h->state.current_event_index.value);
  TEST_ASSERT_EQUAL_INT32(2, h->state.ticker_seconds.value);

  h->executor.start();

  // 2 s lands inside event 1, so the position survives the pause.
  TEST_ASSERT_EQUAL_INT32(1, h->state.current_event_index.value);
  TEST_ASSERT_EQUAL_INT32(2, h->state.ticker_seconds.value);
}

void test_reset_returns_to_the_start_of_the_series() {
  h->executor.load(&g_program);
  h->executor.start();
  h->run_for(250);

  h->executor.reset();

  TEST_ASSERT_EQUAL_STRING(state("false", "0", "0", "null", "hidden").c_str(),
                           h->effects.broadcasts.back().c_str());
}

void test_unloading_clears_the_published_state() {
  h->executor.load(&g_program);

  h->executor.unload();

  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":null,\"programState\":null,\"targetStatus\":\"hidden\"}",
      h->effects.broadcasts.back().c_str());
}

// --- targets ---------------------------------------------------------------

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

  RUN_TEST(test_a_series_streams_one_state_update_per_transition);
  RUN_TEST(test_pause_and_resume_keeps_the_position);
  RUN_TEST(test_resume_after_a_multi_second_pause_keeps_the_event);
  RUN_TEST(test_reset_returns_to_the_start_of_the_series);
  RUN_TEST(test_unloading_clears_the_published_state);

  RUN_TEST(test_toggle_targets_flips_the_published_flag_and_the_pin);

  return UNITY_END();
}
