// ============================================================================
//  The program JSON contract, both directions.
//  Ported from tests/unit/dataclasses/test_program.py and
//  tests/unit/repositories/test_programs.py.
// ============================================================================
#include <cstring>
#include <string>

#include "program.h"
#include "unity.h"

namespace {

const char *kDocument = R"({
  "id": 1,
  "title": "Militar Snabbmatch",
  "description": "Provserie 10s",
  "readonly": true,
  "series": [
    {
      "name": "Provserie 10s",
      "optional": false,
      "events": [
        {"duration": 5000, "audio_ids": [50, 1, 28], "command": "show"},
        {"duration": 7000, "command": "hide"},
        {"duration": 3000}
      ]
    },
    {"name": "Optional", "optional": true, "events": []}
  ]
})";

}  // namespace

void setUp() {}
void tearDown() {}

// --- parsing ---------------------------------------------------------------

void test_a_program_round_trips_its_fields() {
  rt::Program p;
  TEST_ASSERT_TRUE(rt::parse_program(kDocument, strlen(kDocument), false, p));

  TEST_ASSERT_EQUAL_INT32(1, p.id);
  TEST_ASSERT_EQUAL_STRING("Militar Snabbmatch", p.title.c_str());
  TEST_ASSERT_EQUAL_STRING("Provserie 10s", p.description.c_str());
  TEST_ASSERT_EQUAL_size_t(2, p.series.size());
  TEST_ASSERT_EQUAL_STRING("Provserie 10s", p.series[0].name.c_str());
  TEST_ASSERT_FALSE(p.series[0].optional);
  TEST_ASSERT_TRUE(p.series[1].optional);
  TEST_ASSERT_EQUAL_size_t(3, p.series[0].events.size());
  TEST_ASSERT_EQUAL_size_t(0, p.series[1].events.size());
}

void test_events_carry_duration_command_and_audio() {
  rt::Program p;
  rt::parse_program(kDocument, strlen(kDocument), false, p);
  const rt::Event &first = p.series[0].events[0];

  TEST_ASSERT_EQUAL_INT32(5000, first.duration_ms);
  TEST_ASSERT_EQUAL_STRING("show", first.command.c_str());
  TEST_ASSERT_EQUAL_size_t(3, first.audio_ids.size());
  TEST_ASSERT_EQUAL_INT32(50, first.audio_ids[0]);
  TEST_ASSERT_EQUAL_INT32(28, first.audio_ids[2]);
}

void test_absent_command_and_audio_default_to_empty() {
  rt::Program p;
  rt::parse_program(kDocument, strlen(kDocument), false, p);
  const rt::Event &third = p.series[0].events[2];

  TEST_ASSERT_EQUAL_INT32(3000, third.duration_ms);
  TEST_ASSERT_TRUE(third.command.empty());
  TEST_ASSERT_EQUAL_size_t(0, third.audio_ids.size());
}

void test_readonly_comes_from_the_caller_not_the_document() {
  // The document says readonly:true, but where the file came from is what
  // decides - an uploader must not be able to claim its program is shipped.
  rt::Program uploaded;
  rt::parse_program(kDocument, strlen(kDocument), false, uploaded);
  TEST_ASSERT_FALSE(uploaded.readonly);

  rt::Program shipped;
  rt::parse_program(kDocument, strlen(kDocument), true, shipped);
  TEST_ASSERT_TRUE(shipped.readonly);
}

void test_series_total_duration() {
  rt::Program p;
  rt::parse_program(kDocument, strlen(kDocument), false, p);

  TEST_ASSERT_EQUAL_INT32(15000, p.series[0].total_ms());
  TEST_ASSERT_EQUAL_INT32(0, p.series[1].total_ms());
}

void test_malformed_json_is_refused() {
  rt::Program p;
  const char *bad = "{\"id\": 1, ";
  TEST_ASSERT_FALSE(rt::parse_program(bad, strlen(bad), false, p));
}

void test_a_non_object_root_is_refused() {
  rt::Program p;
  const char *array = "[1, 2, 3]";
  TEST_ASSERT_FALSE(rt::parse_program(array, strlen(array), false, p));
}

void test_a_sparse_document_still_loads() {
  rt::Program p;
  const char *sparse = "{\"id\": 5}";
  TEST_ASSERT_TRUE(rt::parse_program(sparse, strlen(sparse), false, p));

  TEST_ASSERT_EQUAL_INT32(5, p.id);
  TEST_ASSERT_TRUE(p.title.empty());
  TEST_ASSERT_EQUAL_size_t(0, p.series.size());
}

// --- serialization ---------------------------------------------------------

void test_the_summary_form_omits_the_series() {
  rt::Program p;
  p.id = 3;
  p.title = "Title";
  p.description = "Desc";
  p.readonly = true;
  p.series.push_back(rt::Series{});

  TEST_ASSERT_EQUAL_STRING(
      "{\"id\":3,\"title\":\"Title\",\"description\":\"Desc\",\"readonly\":true}",
      rt::program_summary_json(p).c_str());
}

void test_the_full_form_carries_series_and_events() {
  rt::Program p;
  p.id = 3;
  p.title = "T";
  p.description = "D";
  rt::Series s;
  s.name = "S0";
  s.events.push_back(rt::Event{200, "show", {4}});
  p.series.push_back(s);

  TEST_ASSERT_EQUAL_STRING(
      "{\"id\":3,\"title\":\"T\",\"description\":\"D\",\"readonly\":false,\"series\":"
      "[{\"name\":\"S0\",\"optional\":false,\"events\":"
      "[{\"duration\":200,\"command\":\"show\",\"audio_ids\":[4]}]}]}",
      rt::program_json(p).c_str());
}

void test_an_event_omits_absent_command_and_audio() {
  TEST_ASSERT_EQUAL_STRING("{\"duration\":100}", rt::event_json(rt::Event{100, "", {}}).c_str());
}

void test_titles_are_escaped() {
  rt::Program p;
  p.id = 1;
  p.title = "He said \"go\"\\now";
  p.description = "line\nbreak";

  TEST_ASSERT_EQUAL_STRING(
      "{\"id\":1,\"title\":\"He said \\\"go\\\"\\\\now\",\"description\":\"line\\nbreak\","
      "\"readonly\":false}",
      rt::program_summary_json(p).c_str());
}

void test_a_parsed_program_serializes_back() {
  rt::Program p;
  rt::parse_program(kDocument, strlen(kDocument), true, p);

  const std::string json = rt::program_json(p);

  rt::Program again;
  TEST_ASSERT_TRUE(rt::parse_program(json, true, again));
  TEST_ASSERT_EQUAL_INT32(p.id, again.id);
  TEST_ASSERT_EQUAL_STRING(p.title.c_str(), again.title.c_str());
  TEST_ASSERT_EQUAL_size_t(p.series.size(), again.series.size());
  TEST_ASSERT_EQUAL_INT32(p.series[0].total_ms(), again.series[0].total_ms());
  TEST_ASSERT_EQUAL_STRING(json.c_str(), rt::program_json(again).c_str());
}

// --- filename ids ----------------------------------------------------------

void test_a_numeric_filename_parses() {
  int32_t id = 0;
  TEST_ASSERT_TRUE(rt::parse_program_filename("42.json", id));
  TEST_ASSERT_EQUAL_INT32(42, id);
}

void test_a_non_numeric_filename_is_refused() {
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::parse_program_filename("audios.json", id));
  TEST_ASSERT_FALSE(rt::parse_program_filename("1a.json", id));
  TEST_ASSERT_FALSE(rt::parse_program_filename(".json", id));
  TEST_ASSERT_FALSE(rt::parse_program_filename("42.txt", id));
  TEST_ASSERT_FALSE(rt::parse_program_filename("42", id));
  TEST_ASSERT_FALSE(rt::parse_program_filename(nullptr, id));
}

void test_a_filename_id_past_int32_is_refused() {
  // An unbounded accumulator here was signed overflow on a long enough name.
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::parse_program_filename("99999999999.json", id));
}

void test_a_document_reports_whether_it_declares_an_id() {
  // PUT /programs/{id} refuses a document that renames the program, so it has
  // to tell "no id offered" from "id 0 offered" - and a document without an id
  // parses to 0, which is itself a legal id.
  rt::Program p;
  bool id_present = true;

  const char *without_id = "{\"title\":\"No id\"}";
  TEST_ASSERT_TRUE(rt::parse_program(without_id, strlen(without_id), false, p, &id_present));
  TEST_ASSERT_FALSE(id_present);
  TEST_ASSERT_EQUAL_INT32(0, p.id);

  const char *zero_id = "{\"id\":0,\"title\":\"Zero\"}";
  TEST_ASSERT_TRUE(rt::parse_program(zero_id, strlen(zero_id), false, p, &id_present));
  TEST_ASSERT_TRUE(id_present);
  TEST_ASSERT_EQUAL_INT32(0, p.id);

  const char *some_id = "{\"id\":107,\"title\":\"Some\"}";
  TEST_ASSERT_TRUE(rt::parse_program(some_id, strlen(some_id), false, p, &id_present));
  TEST_ASSERT_TRUE(id_present);
  TEST_ASSERT_EQUAL_INT32(107, p.id);
}

void test_a_null_or_garbage_id_is_not_silently_accepted() {
  rt::Program p;
  bool id_present = true;

  // JSON null is indistinguishable from absent, and means "keep the path id".
  const char *null_id = "{\"id\":null}";
  TEST_ASSERT_TRUE(rt::parse_program(null_id, strlen(null_id), false, p, &id_present));
  TEST_ASSERT_FALSE(id_present);

  // A wrong type reads as 0 but still counts as declared, so an update against
  // any other id refuses it rather than quietly renumbering.
  const char *string_id = "{\"id\":\"107\"}";
  TEST_ASSERT_TRUE(rt::parse_program(string_id, strlen(string_id), false, p, &id_present));
  TEST_ASSERT_TRUE(id_present);
  TEST_ASSERT_EQUAL_INT32(0, p.id);
}

void test_the_id_out_parameter_is_optional() {
  // Every existing caller passes four arguments; the fifth defaults to null
  // and must not be dereferenced.
  rt::Program p;
  const char *doc = "{\"id\":5}";
  TEST_ASSERT_TRUE(rt::parse_program(doc, strlen(doc), false, p));
  TEST_ASSERT_EQUAL_INT32(5, p.id);
}

void test_a_hostile_duration_is_clamped() {
  // duration is attacker-controlled; total_ms() sums into an int32.
  rt::Program p;
  const char *doc =
      "{\"id\":1,\"series\":[{\"events\":[{\"duration\":9999999999},"
      "{\"duration\":-5000}]}]}";
  TEST_ASSERT_TRUE(rt::parse_program(doc, strlen(doc), false, p));

  TEST_ASSERT_EQUAL_INT32(rt::kMaxEventMs, p.series[0].events[0].duration_ms);
  // Floored at 1 ms, not 0: locate_event()'s half-open interval means a
  // zero-length event can never be entered, so its command and audio would be
  // silently skipped.
  TEST_ASSERT_EQUAL_INT32(rt::kMinEventMs, p.series[0].events[1].duration_ms);
  TEST_ASSERT_EQUAL_INT32(rt::kMaxEventMs + rt::kMinEventMs, p.series[0].total_ms());
}

// --- audio references ------------------------------------------------------

namespace {

// Two series, so the walk is exercised past the first one; the ids are spread
// over the first and last event of each.
const char *kAudioDocument = R"({
  "id": 9,
  "series": [
    {
      "name": "First",
      "events": [
        {"duration": 5000, "audio_ids": [50, 1]},
        {"duration": 7000},
        {"duration": 3000, "audio_ids": []}
      ]
    },
    {
      "name": "Second",
      "events": [
        {"duration": 1000, "audio_ids": [12]},
        {"duration": 2000, "audio_ids": [28, 99]}
      ]
    }
  ]
})";

rt::Program audio_program() {
  rt::Program p;
  TEST_ASSERT_TRUE(rt::parse_program(kAudioDocument, strlen(kAudioDocument), false, p));
  return p;
}

}  // namespace

void test_an_id_in_the_first_event_is_used() {
  const rt::Program p = audio_program();
  TEST_ASSERT_TRUE(rt::program_uses_audio(p, 50));
  TEST_ASSERT_TRUE(rt::program_uses_audio(p, 1));
}

void test_an_id_in_the_last_event_is_used() {
  const rt::Program p = audio_program();
  TEST_ASSERT_TRUE(rt::program_uses_audio(p, 28));
  TEST_ASSERT_TRUE(rt::program_uses_audio(p, 99));
}

void test_an_id_in_a_later_series_is_used() {
  // The walk must not stop at the first series.
  const rt::Program p = audio_program();
  TEST_ASSERT_TRUE(rt::program_uses_audio(p, 12));
}

void test_an_unreferenced_id_is_not_used() {
  const rt::Program p = audio_program();
  TEST_ASSERT_FALSE(rt::program_uses_audio(p, 7));
  // 0 is a legal id and must not match the absent-value default anywhere.
  TEST_ASSERT_FALSE(rt::program_uses_audio(p, 0));
  TEST_ASSERT_FALSE(rt::program_uses_audio(p, -1));
}

void test_events_without_audio_do_not_match() {
  // An event with no `audio_ids` field and one with an empty array both parse
  // to an empty vector - neither may be walked past its end.
  rt::Program p;
  const char *doc = R"({"id":3,"series":[{"events":[{"duration":100},
                       {"duration":200,"audio_ids":[]}]}]})";
  TEST_ASSERT_TRUE(rt::parse_program(doc, strlen(doc), false, p));
  TEST_ASSERT_FALSE(rt::program_uses_audio(p, 1));
}

void test_an_empty_program_uses_nothing() {
  // Both a program with no series at all and one whose series carry no events.
  const rt::Program empty;
  TEST_ASSERT_FALSE(rt::program_uses_audio(empty, 1));

  rt::Program p;
  const char *doc = R"({"id":4,"series":[{"name":"Optional","events":[]}]})";
  TEST_ASSERT_TRUE(rt::parse_program(doc, strlen(doc), false, p));
  TEST_ASSERT_FALSE(rt::program_uses_audio(p, 1));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_a_program_round_trips_its_fields);
  RUN_TEST(test_events_carry_duration_command_and_audio);
  RUN_TEST(test_absent_command_and_audio_default_to_empty);
  RUN_TEST(test_readonly_comes_from_the_caller_not_the_document);
  RUN_TEST(test_series_total_duration);
  RUN_TEST(test_malformed_json_is_refused);
  RUN_TEST(test_a_non_object_root_is_refused);
  RUN_TEST(test_a_sparse_document_still_loads);

  RUN_TEST(test_the_summary_form_omits_the_series);
  RUN_TEST(test_the_full_form_carries_series_and_events);
  RUN_TEST(test_an_event_omits_absent_command_and_audio);
  RUN_TEST(test_titles_are_escaped);
  RUN_TEST(test_a_parsed_program_serializes_back);

  RUN_TEST(test_a_numeric_filename_parses);
  RUN_TEST(test_a_non_numeric_filename_is_refused);
  RUN_TEST(test_a_filename_id_past_int32_is_refused);
  RUN_TEST(test_a_hostile_duration_is_clamped);

  RUN_TEST(test_a_document_reports_whether_it_declares_an_id);
  RUN_TEST(test_a_null_or_garbage_id_is_not_silently_accepted);
  RUN_TEST(test_the_id_out_parameter_is_optional);

  RUN_TEST(test_an_id_in_the_first_event_is_used);
  RUN_TEST(test_an_id_in_the_last_event_is_used);
  RUN_TEST(test_an_id_in_a_later_series_is_used);
  RUN_TEST(test_an_unreferenced_id_is_not_used);
  RUN_TEST(test_events_without_audio_do_not_match);
  RUN_TEST(test_an_empty_program_uses_nothing);
  return UNITY_END();
}
