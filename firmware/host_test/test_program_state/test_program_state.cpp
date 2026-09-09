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
      "{\"loadedProgramId\":null,\"programState\":null,"
      "\"targetBanks\":{\"A\":\"hidden\"}}",
      rt::state_update_json(s).c_str());
}

void test_a_loaded_program_serializes_its_position() {
  rt::ProgramState s;
  s.program = &g_program;
  s.running = true;
  s.current_series_index.set(0);
  s.current_event_index.set(2);
  s.ticker_ms.set(7480);
  s.bank_shown = {true};

  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":42,\"programState\":{\"running\":true,\"currentSeriesIndex\":0,"
      "\"currentEventIndex\":2,\"tickerMs\":7480},"
      "\"targetBanks\":{\"A\":\"shown\"}}",
      rt::state_update_json(s).c_str());
}

void test_an_unset_ticker_serializes_as_null() {
  rt::ProgramState s;
  s.program = &g_program;
  s.current_series_index.set(1);
  s.current_event_index.set(0);

  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":42,\"programState\":{\"running\":false,\"currentSeriesIndex\":1,"
      "\"currentEventIndex\":0,\"tickerMs\":null},"
      "\"targetBanks\":{\"A\":\"hidden\"}}",
      rt::state_update_json(s).c_str());
}

void test_unload_clears_everything_but_where_the_banks_sit() {
  rt::ProgramState s;
  s.program = &g_program;
  s.running = true;
  s.ticker_ms.set(3000);
  // The targets do not move just because the program was unloaded, so the
  // published status must survive it.
  s.bank_shown = {true};

  s.unload();

  TEST_ASSERT_FALSE(s.is_loaded());
  TEST_ASSERT_FALSE(s.running);
  TEST_ASSERT_FALSE(s.ticker_ms.has_value);
  TEST_ASSERT_TRUE(s.bank_a_shown());
  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":null,\"programState\":null,"
      "\"targetBanks\":{\"A\":\"shown\"}}",
      rt::state_update_json(s).c_str());
}

// Each bank reports its own state; there is no device-wide summary of them.
void test_each_bank_reports_itself() {
  rt::ProgramState s;
  s.init_banks(4, false);
  s.bank_shown[2] = true;

  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":null,\"programState\":null,"
      "\"targetBanks\":{\"A\":\"hidden\",\"B\":\"hidden\",\"C\":\"shown\",\"D\":\"hidden\"}}",
      rt::state_update_json(s).c_str());

  s.bank_shown[0] = true;
  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":null,\"programState\":null,"
      "\"targetBanks\":{\"A\":\"shown\",\"B\":\"hidden\",\"C\":\"shown\",\"D\":\"hidden\"}}",
      rt::state_update_json(s).c_str());
}

// A one-bank device sends `targetBanks` too, with the single key `A` (D-41),
// so a client reads the bank count off the key count.
void test_one_bank_still_publishes_its_single_letter() {
  rt::ProgramState s;
  s.init_banks(1, true);

  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":null,\"programState\":null,"
      "\"targetBanks\":{\"A\":\"shown\"}}",
      rt::state_update_json(s).c_str());
}

void test_two_banks_publish_both_letters() {
  rt::ProgramState s;
  s.program = &g_program;
  s.running = true;
  s.current_series_index.set(0);
  s.current_event_index.set(1);
  s.ticker_ms.set(1500);
  s.init_banks(2, true);
  s.bank_shown[1] = false;

  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":42,\"programState\":{\"running\":true,\"currentSeriesIndex\":0,"
      "\"currentEventIndex\":1,\"tickerMs\":1500},"
      "\"targetBanks\":{\"A\":\"shown\",\"B\":\"hidden\"}}",
      rt::state_update_json(s).c_str());
}

// Eight is the firmware ceiling, so this is the widest frame that can be sent.
void test_eight_banks_run_a_through_h() {
  rt::ProgramState s;
  s.init_banks(8, false);
  s.bank_shown[7] = true;

  TEST_ASSERT_EQUAL_STRING(
      "{\"loadedProgramId\":null,\"programState\":null,"
      "\"targetBanks\":{\"A\":\"hidden\",\"B\":\"hidden\",\"C\":\"hidden\",\"D\":\"hidden\","
      "\"E\":\"hidden\",\"F\":\"hidden\",\"G\":\"hidden\",\"H\":\"shown\"}}",
      rt::state_update_json(s).c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_nothing_loaded_serializes_as_nulls);
  RUN_TEST(test_each_bank_reports_itself);
  RUN_TEST(test_one_bank_still_publishes_its_single_letter);
  RUN_TEST(test_two_banks_publish_both_letters);
  RUN_TEST(test_eight_banks_run_a_through_h);
  RUN_TEST(test_a_loaded_program_serializes_its_position);
  RUN_TEST(test_an_unset_ticker_serializes_as_null);
  RUN_TEST(test_unload_clears_everything_but_where_the_banks_sit);
  return UNITY_END();
}
