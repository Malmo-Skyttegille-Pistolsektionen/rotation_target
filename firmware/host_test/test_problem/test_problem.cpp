// ============================================================================
//  RFC 9457 problem details (D-19): the one shape every REST failure takes.
//  Two things matter here - that the document is well-formed however hostile
//  the `detail` (it can carry an uploaded title or filename), and that the
//  vocabulary itself holds: unique slugs, one status per type, and the slug a
//  `backend_issue` already uses for the same meaning.
// ============================================================================
#include <cstring>
#include <set>
#include <string>

#include "ArduinoJson.h"
#include "backend_issue.h"
#include "problem.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

namespace {

JsonDocument parsed(const std::string &json) {
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, json);
  TEST_ASSERT_EQUAL_STRING("Ok", err.c_str());
  TEST_ASSERT_TRUE(doc.is<JsonObject>());
  return doc;
}

}  // namespace

// --- shape -----------------------------------------------------------------

void test_the_four_members_in_order() {
  TEST_ASSERT_EQUAL_STRING(
      R"({"type":"/problems/program_not_found","title":"Program not found","status":404,)"
      R"("detail":"Program not found"})",
      rt::problem_json(rt::problem::kProgramNotFound, "Program not found").c_str());
}

void test_instance_is_never_emitted() {
  // D-19: `instance` identifies one occurrence, and the device has no request
  // ids to identify it by.
  const std::string json = rt::problem_json(rt::problem::kProgramInvalid, "whatever");
  TEST_ASSERT_NULL(strstr(json.c_str(), "instance"));
}

void test_type_is_the_slug_under_the_prefix() {
  JsonDocument doc = parsed(rt::problem_json(rt::problem::kAudioPlaying, "d"));
  TEST_ASSERT_EQUAL_STRING("/problems/audio_playing", doc["type"].as<const char *>());
}

void test_status_is_a_number_not_a_string() {
  // A client comparing `problem.status` to a number must not get "409".
  JsonDocument doc = parsed(rt::problem_json(rt::problem::kProgramRunning, "d"));
  TEST_ASSERT_TRUE(doc["status"].is<int>());
  TEST_ASSERT_EQUAL_INT(409, doc["status"].as<int>());
}

void test_title_comes_from_the_type_not_the_detail() {
  // Two occurrences of one type carry the same title and differ only in
  // `detail` - the read-only refusal a PUT gives and the one a DELETE gives.
  JsonDocument update = parsed(rt::problem_json(rt::problem::kProgramReadonly,
                                                "Program is read-only and cannot be "
                                                "updated"));
  JsonDocument remove = parsed(rt::problem_json(rt::problem::kProgramReadonly,
                                                "Program is read-only and cannot be "
                                                "deleted"));
  TEST_ASSERT_EQUAL_STRING("Program is read-only", update["title"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("Program is read-only", remove["title"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING(update["type"].as<const char *>(), remove["type"].as<const char *>());
  TEST_ASSERT_TRUE(
      strcmp(update["detail"].as<const char *>(), remove["detail"].as<const char *>()) != 0);
}

void test_an_empty_detail_is_still_valid_json() {
  JsonDocument doc = parsed(rt::problem_json(rt::problem::kUploadMissingTitle, ""));
  TEST_ASSERT_EQUAL_STRING("", doc["detail"].as<const char *>());
}

void test_the_media_type_is_the_rfc_one() {
  TEST_ASSERT_EQUAL_STRING("application/problem+json", rt::kProblemContentType);
}

// --- escaping --------------------------------------------------------------
//
// `detail` is the only free-form member, and it reaches these handlers holding
// an uploaded clip title or a program filename.

void test_a_quote_in_the_detail_is_escaped() {
  const std::string json =
      rt::problem_json(rt::problem::kAudioFormatUnsupported, R"(clip "a" is not PCM)");
  TEST_ASSERT_NOT_NULL(strstr(json.c_str(), R"(clip \"a\" is not PCM)"));
  JsonDocument doc = parsed(json);
  TEST_ASSERT_EQUAL_STRING(R"(clip "a" is not PCM)", doc["detail"].as<const char *>());
}

void test_a_backslash_in_the_detail_is_escaped() {
  const std::string json = rt::problem_json(rt::problem::kProgramInvalid, R"(a\b)");
  JsonDocument doc = parsed(json);
  TEST_ASSERT_EQUAL_STRING(R"(a\b)", doc["detail"].as<const char *>());
}

void test_a_newline_in_the_detail_is_escaped() {
  const std::string json = rt::problem_json(rt::problem::kProgramInvalid, "line1\nline2");
  TEST_ASSERT_NOT_NULL(strstr(json.c_str(), R"(line1\nline2)"));
  JsonDocument doc = parsed(json);
  TEST_ASSERT_EQUAL_STRING("line1\nline2", doc["detail"].as<const char *>());
}

void test_a_control_character_uses_the_u_escape() {
  const std::string json =
      rt::problem_json(rt::problem::kProgramInvalid, std::string("a\x01") + "b");
  TEST_ASSERT_NOT_NULL(strstr(json.c_str(), "\\u0001"));
  JsonDocument doc = parsed(json);
  TEST_ASSERT_EQUAL_STRING(
      "a\x01"
      "b",
      doc["detail"].as<const char *>());
}

void test_utf8_in_the_detail_passes_through_untouched() {
  // A Swedish clip title is the normal case here, not an edge case.
  const std::string json = rt::problem_json(rt::problem::kAudioNotFound, "Sk\xc3\xa4rmen");
  TEST_ASSERT_NOT_NULL(strstr(json.c_str(), "Sk\xc3\xa4rmen"));
  parsed(json);
}

// --- the vocabulary --------------------------------------------------------

void test_every_slug_is_unique() {
  std::set<std::string> seen;
  for (const rt::ProblemType *type : rt::kProblemTypes) {
    TEST_ASSERT_TRUE_MESSAGE(seen.insert(type->slug).second, type->slug);
  }
}

void test_every_type_has_a_title_and_a_plausible_status() {
  for (const rt::ProblemType *type : rt::kProblemTypes) {
    TEST_ASSERT_TRUE_MESSAGE(type->slug[0] != '\0', "empty slug");
    TEST_ASSERT_TRUE_MESSAGE(type->title[0] != '\0', type->slug);
    TEST_ASSERT_TRUE_MESSAGE(type->status >= 400 && type->status <= 599, type->slug);
  }
}

void test_slugs_are_lowercase_snake_case() {
  // They go into a URI and into a generated TypeScript union; anything else
  // would have to be quoted or escaped at one end or the other.
  for (const rt::ProblemType *type : rt::kProblemTypes) {
    for (const char *c = type->slug; *c != '\0'; ++c) {
      TEST_ASSERT_TRUE_MESSAGE((*c >= 'a' && *c <= 'z') || *c == '_', type->slug);
    }
  }
}

void test_the_program_invalid_slug_is_the_backend_issue_code() {
  // The point of D-19's shared vocabulary: a program that will not parse is
  // the same failure whether REST refuses it or SSE reports it, so it is the
  // same word on both channels. If one of these is ever renamed, rename both.
  TEST_ASSERT_EQUAL_STRING(rt::issue_code::kProgramInvalid, rt::problem::kProgramInvalid.slug);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_the_four_members_in_order);
  RUN_TEST(test_instance_is_never_emitted);
  RUN_TEST(test_type_is_the_slug_under_the_prefix);
  RUN_TEST(test_status_is_a_number_not_a_string);
  RUN_TEST(test_title_comes_from_the_type_not_the_detail);
  RUN_TEST(test_an_empty_detail_is_still_valid_json);
  RUN_TEST(test_the_media_type_is_the_rfc_one);

  RUN_TEST(test_a_quote_in_the_detail_is_escaped);
  RUN_TEST(test_a_backslash_in_the_detail_is_escaped);
  RUN_TEST(test_a_newline_in_the_detail_is_escaped);
  RUN_TEST(test_a_control_character_uses_the_u_escape);
  RUN_TEST(test_utf8_in_the_detail_passes_through_untouched);

  RUN_TEST(test_every_slug_is_unique);
  RUN_TEST(test_every_type_has_a_title_and_a_plausible_status);
  RUN_TEST(test_slugs_are_lowercase_snake_case);
  RUN_TEST(test_the_program_invalid_slug_is_the_backend_issue_code);
  return UNITY_END();
}
