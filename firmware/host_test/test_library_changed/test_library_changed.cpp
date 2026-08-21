// ============================================================================
//  The `libraryChanged` SSE payload.
//  Tiny by design - the event carries one field and no user data - so what is
//  worth pinning is the exact wire shape a client parses and the two `kind`
//  values the contract enumerates.
// ============================================================================
#include <cstring>
#include <string>

#include "library_changed.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

// --- shape -----------------------------------------------------------------

void test_program_kind() {
  TEST_ASSERT_EQUAL_STRING(R"({"kind":"program"})",
                           rt::library_changed_json(rt::library_kind::kProgram).c_str());
}

void test_audio_kind() {
  TEST_ASSERT_EQUAL_STRING(R"({"kind":"audio"})",
                           rt::library_changed_json(rt::library_kind::kAudio).c_str());
}

void test_the_payload_carries_nothing_else() {
  // No id and no operation: the event says a list is stale, and the client
  // answers with the GET it would have made anyway. A delta would be a
  // different contract.
  const std::string json = rt::library_changed_json(rt::library_kind::kProgram);
  TEST_ASSERT_NULL(strstr(json.c_str(), "id"));
  TEST_ASSERT_NULL(strstr(json.c_str(), "op"));
}

// --- escaping --------------------------------------------------------------

void test_the_kind_goes_through_json_quote() {
  // Nothing outside rt::library_kind reaches this today, but the serializer is
  // the only thing standing between a value and an SSE `data:` line - a raw
  // newline would split the frame in two.
  TEST_ASSERT_EQUAL_STRING(R"({"kind":"a\"b\nc"})", rt::library_changed_json("a\"b\nc").c_str());
}

// --- the kinds the firmware actually emits ---------------------------------

void test_the_kind_constants_match_the_contract() {
  // The `kind` enum in contracts/asyncapi.yaml lists exactly these two.
  TEST_ASSERT_EQUAL_STRING("audio", rt::library_kind::kAudio);
  TEST_ASSERT_EQUAL_STRING("program", rt::library_kind::kProgram);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_program_kind);
  RUN_TEST(test_audio_kind);
  RUN_TEST(test_the_payload_carries_nothing_else);
  RUN_TEST(test_the_kind_goes_through_json_quote);
  RUN_TEST(test_the_kind_constants_match_the_contract);
  return UNITY_END();
}
