// ============================================================================
//  The timing maths the run loop is built on: where elapsed time lands in a
//  series, and how long to sleep before looking again.
// ============================================================================
#include "run_position.h"
#include "unity.h"

namespace {

rt::Series three_events() {
  rt::Series s;
  s.events.push_back(rt::Event{1000, "show", {}});
  s.events.push_back(rt::Event{2000, "hide", {}});
  s.events.push_back(rt::Event{500, "show", {}});
  return s;
}

}  // namespace

void setUp() {}
void tearDown() {}

void test_total_ms_sums_the_events() {
  TEST_ASSERT_EQUAL_INT32(3500, three_events().total_ms());
}

void test_start_of_the_series_is_the_first_event() {
  const rt::EventLocation loc = rt::locate_event(three_events(), 0);

  TEST_ASSERT_TRUE(loc.valid);
  TEST_ASSERT_EQUAL_INT32(0, loc.index);
  TEST_ASSERT_EQUAL_INT32(0, loc.offset_ms);
  TEST_ASSERT_EQUAL_INT32(1000, loc.end_ms);
}

void test_an_event_boundary_belongs_to_the_next_event() {
  // Exactly 1000 ms in, event 0 is over - the half-open interval is what makes
  // a resume at a boundary re-enter cleanly rather than replay.
  const rt::EventLocation loc = rt::locate_event(three_events(), 1000);

  TEST_ASSERT_TRUE(loc.valid);
  TEST_ASSERT_EQUAL_INT32(1, loc.index);
  TEST_ASSERT_EQUAL_INT32(0, loc.offset_ms);
  TEST_ASSERT_EQUAL_INT32(3000, loc.end_ms);
}

void test_mid_event_reports_the_offset() {
  const rt::EventLocation loc = rt::locate_event(three_events(), 2500);

  TEST_ASSERT_TRUE(loc.valid);
  TEST_ASSERT_EQUAL_INT32(1, loc.index);
  TEST_ASSERT_EQUAL_INT32(1500, loc.offset_ms);
}

void test_the_end_of_the_series_is_not_a_location() {
  TEST_ASSERT_FALSE(rt::locate_event(three_events(), 3500).valid);
  TEST_ASSERT_FALSE(rt::locate_event(three_events(), 9999).valid);
}

void test_an_empty_series_has_no_location() {
  TEST_ASSERT_FALSE(rt::locate_event(rt::Series{}, 0).valid);
}

void test_sleep_is_capped_below_the_next_second() {
  // 100 ms in, the next second is 900 ms away, so the cap applies first. Named
  // for what it actually asserts - it was previously called
  // "stops_at_the_next_whole_second", which it never exercised.
  TEST_ASSERT_EQUAL_INT32(rt::kMaxSleepMs, rt::next_sleep_ms(100, 60000, 60000));
}

void test_sleep_stops_at_the_next_whole_second() {
  // The next-second bound winning on its own: 950 ms in, with the event and
  // the series both ending far away, the 1000 ms tick is the nearest wake-up.
  TEST_ASSERT_EQUAL_INT32(50, rt::next_sleep_ms(950, 5000, 60000));
}

void test_sleep_stops_at_the_end_of_the_event() {
  // 950 ms in with the event ending at 1000: 50 ms, ahead of both the cap and
  // the next-second boundary (which is also 1000).
  TEST_ASSERT_EQUAL_INT32(50, rt::next_sleep_ms(950, 1000, 60000));
}

void test_sleep_stops_at_the_end_of_the_series() {
  TEST_ASSERT_EQUAL_INT32(20, rt::next_sleep_ms(980, 5000, 1000));
}

void test_sleep_is_capped() {
  TEST_ASSERT_EQUAL_INT32(rt::kMaxSleepMs, rt::next_sleep_ms(0, 60000, 60000));
}

void test_sleep_is_never_zero() {
  // Already at the boundary: still yield, or the loop spins.
  TEST_ASSERT_EQUAL_INT32(1, rt::next_sleep_ms(1000, 1000, 1000));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_total_ms_sums_the_events);
  RUN_TEST(test_start_of_the_series_is_the_first_event);
  RUN_TEST(test_an_event_boundary_belongs_to_the_next_event);
  RUN_TEST(test_mid_event_reports_the_offset);
  RUN_TEST(test_the_end_of_the_series_is_not_a_location);
  RUN_TEST(test_an_empty_series_has_no_location);
  RUN_TEST(test_sleep_is_capped_below_the_next_second);
  RUN_TEST(test_sleep_stops_at_the_next_whole_second);
  RUN_TEST(test_sleep_stops_at_the_end_of_the_event);
  RUN_TEST(test_sleep_stops_at_the_end_of_the_series);
  RUN_TEST(test_sleep_is_capped);
  RUN_TEST(test_sleep_is_never_zero);
  return UNITY_END();
}
