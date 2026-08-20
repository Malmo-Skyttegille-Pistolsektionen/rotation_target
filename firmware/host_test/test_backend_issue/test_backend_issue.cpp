// ============================================================================
//  The `backend_issue` SSE payload.
//  Every value in it comes from the filesystem - a clip path, a program
//  filename - so the escaping is the part that matters: an unescaped quote or
//  newline in a path would break the SSE frame, not just the JSON.
// ============================================================================
#include <cstring>
#include <string>

#include "ArduinoJson.h"
#include "backend_issue.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

namespace {

// Parses `json`, failing the test if it is not a well-formed JSON object.
JsonDocument parsed(const std::string &json) {
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, json);
  TEST_ASSERT_EQUAL_STRING("Ok", err.c_str());
  TEST_ASSERT_TRUE(doc.is<JsonObject>());
  return doc;
}

}  // namespace

// --- shape -----------------------------------------------------------------

void test_code_and_message_only() {
  TEST_ASSERT_EQUAL_STRING(
      R"({"code":"program_invalid","message":"Bad file"})",
      rt::backend_issue_json(rt::issue_code::kProgramInvalid, "Bad file").c_str());
}

void test_context_is_omitted_when_empty() {
  const std::string json = rt::backend_issue_json("x", "y", {});
  TEST_ASSERT_NULL(strstr(json.c_str(), "context"));
}

void test_context_is_an_object() {
  TEST_ASSERT_EQUAL_STRING(
      R"({"code":"audio_playback_failed","message":"Nope","context":{"clip":"/storage/audio/3.wav"}})",
      rt::backend_issue_json(rt::issue_code::kAudioPlaybackFailed, "Nope",
                             {{"clip", "/storage/audio/3.wav"}})
          .c_str());
}

void test_context_keeps_the_given_order() {
  TEST_ASSERT_EQUAL_STRING(R"({"code":"c","message":"m","context":{"b":"1","a":"2"}})",
                           rt::backend_issue_json("c", "m", {{"b", "1"}, {"a", "2"}}).c_str());
}

void test_empty_strings_are_still_valid_json() {
  JsonDocument doc = parsed(rt::backend_issue_json("", "", {{"", ""}}));
  TEST_ASSERT_EQUAL_STRING("", doc["code"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("", doc["context"][""].as<const char *>());
}

// --- escaping --------------------------------------------------------------

void test_a_quote_in_a_path_is_escaped() {
  const std::string json =
      rt::backend_issue_json(rt::issue_code::kProgramInvalid, "Bad", {{"file", R"(/s/a"b.json)"}});
  TEST_ASSERT_EQUAL_STRING(
      R"({"code":"program_invalid","message":"Bad","context":{"file":"/s/a\"b.json"}})",
      json.c_str());
  JsonDocument doc = parsed(json);
  TEST_ASSERT_EQUAL_STRING(R"(/s/a"b.json)", doc["context"]["file"].as<const char *>());
}

void test_a_backslash_in_a_path_is_escaped() {
  const std::string json = rt::backend_issue_json("c", "m", {{"file", R"(a\b)"}});
  TEST_ASSERT_EQUAL_STRING(R"({"code":"c","message":"m","context":{"file":"a\\b"}})", json.c_str());
  JsonDocument doc = parsed(json);
  TEST_ASSERT_EQUAL_STRING(R"(a\b)", doc["context"]["file"].as<const char *>());
}

void test_a_newline_in_a_message_is_escaped() {
  // Load-bearing beyond JSON validity: a raw newline would terminate the SSE
  // `data:` line and split the frame in two.
  const std::string json = rt::backend_issue_json("c", "line1\nline2");
  TEST_ASSERT_EQUAL_STRING(R"({"code":"c","message":"line1\nline2"})", json.c_str());
  JsonDocument doc = parsed(json);
  TEST_ASSERT_EQUAL_STRING("line1\nline2", doc["message"].as<const char *>());
}

void test_a_control_character_uses_the_u_escape() {
  const std::string json = rt::backend_issue_json("c", std::string("a\x01") + "b");
  TEST_ASSERT_EQUAL_STRING("{\"code\":\"c\",\"message\":\"a\\u0001b\"}", json.c_str());
  JsonDocument doc = parsed(json);
  TEST_ASSERT_EQUAL_STRING(
      "a\x01"
      "b",
      doc["message"].as<const char *>());
}

void test_an_escaped_key_stays_a_valid_key() {
  const std::string json = rt::backend_issue_json("c", "m", {{R"(a"b)", "v"}});
  JsonDocument doc = parsed(json);
  TEST_ASSERT_EQUAL_STRING("v", doc["context"][R"(a"b)"].as<const char *>());
}

void test_utf8_passes_through_untouched() {
  // "Skärmen" / "ö.json" - program titles and uploaded filenames are Swedish
  // often enough that this is the normal case, not an edge case.
  const std::string json =
      rt::backend_issue_json("c", "Sk\xc3\xa4rmen", {{"file", "\xc3\xb6.json"}});
  TEST_ASSERT_EQUAL_STRING(
      "{\"code\":\"c\",\"message\":\"Sk\xc3\xa4rmen\",\"context\":{\"file\":\"\xc3\xb6.json\"}}",
      json.c_str());
}

// --- the codes the firmware actually emits ---------------------------------

void test_the_code_constants_match_the_contract() {
  // The `code` enum in contracts/asyncapi.yaml lists exactly these two.
  TEST_ASSERT_EQUAL_STRING("audio_playback_failed", rt::issue_code::kAudioPlaybackFailed);
  TEST_ASSERT_EQUAL_STRING("program_invalid", rt::issue_code::kProgramInvalid);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_code_and_message_only);
  RUN_TEST(test_context_is_omitted_when_empty);
  RUN_TEST(test_context_is_an_object);
  RUN_TEST(test_context_keeps_the_given_order);
  RUN_TEST(test_empty_strings_are_still_valid_json);

  RUN_TEST(test_a_quote_in_a_path_is_escaped);
  RUN_TEST(test_a_backslash_in_a_path_is_escaped);
  RUN_TEST(test_a_newline_in_a_message_is_escaped);
  RUN_TEST(test_a_control_character_uses_the_u_escape);
  RUN_TEST(test_an_escaped_key_stays_a_valid_key);
  RUN_TEST(test_utf8_passes_through_untouched);

  RUN_TEST(test_the_code_constants_match_the_contract);
  return UNITY_END();
}
