// ============================================================================
//  The stateUpdate payload - the only channel run state is published on.
//  Ported from tests/unit/repositories/test_program_state.py.
// ============================================================================
#include "program_state.h"
#include "unity.h"

namespace {
rt::Program g_program;
}

void setUp() {
  g_program = rt::Program{};
  g_program.id = 42;
}
void tearDown() {}

void test_nothing_loaded_serializes_as_nulls() {
  rt::ProgramState s;

  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":null,\"programState\":null,\"targetStatus\":\"hidden\"}",
      rt::state_update_json(s).c_str());
}

void test_a_loaded_program_serializes_its_position() {
  rt::ProgramState s;
  s.program = &g_program;
  s.running = true;
  s.current_series_index.set(0);
  s.current_event_index.set(2);
  s.ticker_seconds.set(7);
  s.target_status_shown = true;

  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":42,\"programState\":{\"running\":true,\"currentSeriesIndex\":0,"
      "\"currentEventIndex\":2,\"tickerSeconds\":7},\"targetStatus\":\"shown\"}",
      rt::state_update_json(s).c_str());
}

void test_an_unset_ticker_serializes_as_null() {
  rt::ProgramState s;
  s.program = &g_program;
  s.current_series_index.set(1);
  s.current_event_index.set(0);

  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":42,\"programState\":{\"running\":false,\"currentSeriesIndex\":1,"
      "\"currentEventIndex\":0,\"tickerSeconds\":null},\"targetStatus\":\"hidden\"}",
      rt::state_update_json(s).c_str());
}

void test_unload_clears_everything_but_the_target_status() {
  rt::ProgramState s;
  s.program = &g_program;
  s.running = true;
  s.ticker_seconds.set(3);
  // The targets do not move just because the program was unloaded, so the
  // published status must survive it.
  s.target_status_shown = true;

  s.unload();

  TEST_ASSERT_FALSE(s.is_loaded());
  TEST_ASSERT_FALSE(s.running);
  TEST_ASSERT_FALSE(s.ticker_seconds.has_value);
  TEST_ASSERT_TRUE(s.target_status_shown);
  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":null,\"programState\":null,\"targetStatus\":\"shown\"}",
      rt::state_update_json(s).c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_nothing_loaded_serializes_as_nulls);
  RUN_TEST(test_a_loaded_program_serializes_its_position);
  RUN_TEST(test_an_unset_ticker_serializes_as_null);
  RUN_TEST(test_unload_clears_everything_but_the_target_status);
  return UNITY_END();
}
