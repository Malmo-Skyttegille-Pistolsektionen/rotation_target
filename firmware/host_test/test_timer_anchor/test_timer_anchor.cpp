// ============================================================================
//  The run timer's anchor (#126). Several programs open with preamble - audio
//  announcing the series, the count, a loading period - and that time is not
//  shooting time. `timer_start_index` names the event where the clock reaches
//  zero; the published ticker counts down to it and up from it.
// ============================================================================
#include <cstring>
#include <string>

#include "program.h"
#include "program_state.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

namespace {

rt::Program militar_snabbmatch_shaped() {
  // The real shape of Militar Snabbmatch's first series: 5s announce, 60s
  // "Ladda!", then the shooting. The anchor is the loading event.
  rt::Program p;
  p.id = 1;
  rt::Series s;
  s.name = "Provserie 10s";
  s.timer_start_index = 1;
  s.events.push_back(rt::Event{5000, {}, {}});
  s.events.push_back(rt::Event{60000, {}, {}});
  s.events.push_back(rt::Event{7000, {}, {}});
  p.series.push_back(std::move(s));
  return p;
}

/** The tickerMs a client would receive at `elapsed_ms` into series 0. */
int32_t published_ticker(const rt::Program &program, int32_t elapsed_ms) {
  rt::ProgramState state;
  state.program = &program;
  state.current_series_index.set(0);
  state.current_event_index.set(0);
  state.ticker_ms.set(elapsed_ms);
  return rt::relative_ticker_ms(state).value;
}

}  // namespace

// --- the anchor itself -----------------------------------------------------

void test_no_anchor_is_the_start_of_the_series() {
  rt::Series s;
  s.events.push_back(rt::Event{5000, {}, {}});
  s.events.push_back(rt::Event{60000, {}, {}});
  TEST_ASSERT_EQUAL_INT32(0, s.timer_anchor_ms());
}

void test_anchor_sums_the_events_before_it() {
  const rt::Program p = militar_snabbmatch_shaped();
  // Anchor is event 1, so only event 0's 5s precedes it.
  TEST_ASSERT_EQUAL_INT32(5000, p.series[0].timer_anchor_ms());
}

void test_an_out_of_range_anchor_does_not_read_past_the_end() {
  // The parser refuses these, but a struct built by hand must not walk off the
  // vector - a bad value should be harmless, not a crash.
  rt::Series s;
  s.events.push_back(rt::Event{5000, {}, {}});
  s.timer_start_index = 99;
  TEST_ASSERT_EQUAL_INT32(5000, s.timer_anchor_ms());
}

// --- what a client is told -------------------------------------------------

void test_the_ticker_counts_down_through_the_preamble() {
  const rt::Program p = militar_snabbmatch_shaped();
  TEST_ASSERT_EQUAL_INT32(-5000, published_ticker(p, 0));
  TEST_ASSERT_EQUAL_INT32(-2000, published_ticker(p, 3000));
}

void test_the_ticker_is_zero_as_the_anchor_event_begins() {
  const rt::Program p = militar_snabbmatch_shaped();
  TEST_ASSERT_EQUAL_INT32(0, published_ticker(p, 5000));
}

void test_the_ticker_counts_up_after_the_anchor() {
  const rt::Program p = militar_snabbmatch_shaped();
  TEST_ASSERT_EQUAL_INT32(1000, published_ticker(p, 6000));
  TEST_ASSERT_EQUAL_INT32(60000, published_ticker(p, 65000));
}

void test_a_series_without_an_anchor_is_unchanged() {
  // The whole compatibility argument: index 0 makes the relative ticker
  // identical to elapsed-since-series-start, which is what tickerMs has always
  // meant. Every program that predates the field must be bit-for-bit the same.
  rt::Program p;
  rt::Series s;
  s.events.push_back(rt::Event{5000, {}, {}});
  s.events.push_back(rt::Event{60000, {}, {}});
  p.series.push_back(std::move(s));

  TEST_ASSERT_EQUAL_INT32(0, published_ticker(p, 0));
  TEST_ASSERT_EQUAL_INT32(3000, published_ticker(p, 3000));
  TEST_ASSERT_EQUAL_INT32(65000, published_ticker(p, 65000));
}

void test_a_null_ticker_stays_null() {
  const rt::Program p = militar_snabbmatch_shaped();
  rt::ProgramState state;
  state.program = &p;
  state.current_series_index.set(0);
  TEST_ASSERT_FALSE(rt::relative_ticker_ms(state).has_value);
}

void test_the_serialised_frame_carries_the_signed_value() {
  const rt::Program p = militar_snabbmatch_shaped();
  rt::ProgramState state;
  state.program = &p;
  state.running = true;
  state.current_series_index.set(0);
  state.current_event_index.set(0);
  state.ticker_ms.set(2000);

  const std::string json = rt::state_update_json(state);
  TEST_ASSERT_NOT_NULL(strstr(json.c_str(), "\"tickerMs\":-3000"));
}

// --- parsing ---------------------------------------------------------------

void test_the_field_is_read_from_the_document() {
  const char *doc =
      "{\"id\":1,\"title\":\"t\",\"series\":[{\"name\":\"s\",\"optional\":false,"
      "\"timer_start_index\":1,"
      "\"events\":[{\"duration\":5000},{\"duration\":60000}]}]}";
  rt::Program p;
  TEST_ASSERT_TRUE(rt::parse_program(doc, strlen(doc), false, p, nullptr));
  TEST_ASSERT_EQUAL_INT32(1, p.series[0].timer_start_index);
  TEST_ASSERT_EQUAL_INT32(5000, p.series[0].timer_anchor_ms());
}

void test_an_absent_field_is_zero() {
  const char *doc =
      "{\"id\":1,\"title\":\"t\",\"series\":[{\"name\":\"s\",\"optional\":false,"
      "\"events\":[{\"duration\":5000}]}]}";
  rt::Program p;
  TEST_ASSERT_TRUE(rt::parse_program(doc, strlen(doc), false, p, nullptr));
  TEST_ASSERT_EQUAL_INT32(0, p.series[0].timer_start_index);
}

void test_an_index_past_the_end_is_refused() {
  // Refused rather than clamped: it names an event that is not there, and
  // anchoring somewhere else would start the clock at a moment nobody chose.
  const char *doc =
      "{\"id\":1,\"title\":\"t\",\"series\":[{\"name\":\"s\",\"optional\":false,"
      "\"timer_start_index\":5,"
      "\"events\":[{\"duration\":5000},{\"duration\":60000}]}]}";
  rt::Program p;
  TEST_ASSERT_FALSE(rt::parse_program(doc, strlen(doc), false, p, nullptr));
}

void test_a_negative_index_is_refused() {
  const char *doc =
      "{\"id\":1,\"title\":\"t\",\"series\":[{\"name\":\"s\",\"optional\":false,"
      "\"timer_start_index\":-1,"
      "\"events\":[{\"duration\":5000}]}]}";
  rt::Program p;
  TEST_ASSERT_FALSE(rt::parse_program(doc, strlen(doc), false, p, nullptr));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_no_anchor_is_the_start_of_the_series);
  RUN_TEST(test_anchor_sums_the_events_before_it);
  RUN_TEST(test_an_out_of_range_anchor_does_not_read_past_the_end);
  RUN_TEST(test_the_ticker_counts_down_through_the_preamble);
  RUN_TEST(test_the_ticker_is_zero_as_the_anchor_event_begins);
  RUN_TEST(test_the_ticker_counts_up_after_the_anchor);
  RUN_TEST(test_a_series_without_an_anchor_is_unchanged);
  RUN_TEST(test_a_null_ticker_stays_null);
  RUN_TEST(test_the_serialised_frame_carries_the_signed_value);
  RUN_TEST(test_the_field_is_read_from_the_document);
  RUN_TEST(test_an_absent_field_is_zero);
  RUN_TEST(test_an_index_past_the_end_is_refused);
  RUN_TEST(test_a_negative_index_is_refused);
  return UNITY_END();
}
