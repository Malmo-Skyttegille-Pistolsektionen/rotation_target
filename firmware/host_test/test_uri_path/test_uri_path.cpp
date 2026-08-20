// ============================================================================
//  URI path parsing - the security boundary for every {id} route, and the
//  classifier deciding which GET miss gets the webapp's index.html.
//  Could not be tested while this lived in an anonymous namespace in
//  main/net/web_server.cpp.
// ============================================================================
#include "unity.h"
#include "uri_path.h"

namespace {
constexpr const char *kPrefix = "/api/v2/programs/";
}

void setUp() {}
void tearDown() {}

// --- accepted --------------------------------------------------------------

void test_a_bare_id_parses() {
  int32_t id = 0;
  TEST_ASSERT_TRUE(rt::path_id("/api/v2/programs/12", kPrefix, "", id));
  TEST_ASSERT_EQUAL_INT32(12, id);
}

void test_an_id_with_a_suffix_parses() {
  int32_t id = 0;
  TEST_ASSERT_TRUE(rt::path_id("/api/v2/programs/7/load", kPrefix, "/load", id));
  TEST_ASSERT_EQUAL_INT32(7, id);
}

void test_a_query_string_is_stripped() {
  int32_t id = 0;
  TEST_ASSERT_TRUE(rt::path_id("/api/v2/programs/9?debug=1", kPrefix, "", id));
  TEST_ASSERT_EQUAL_INT32(9, id);
}

void test_a_query_string_before_the_suffix_check() {
  int32_t id = 0;
  TEST_ASSERT_TRUE(rt::path_id("/api/v2/programs/9/load?x=1", kPrefix, "/load", id));
  TEST_ASSERT_EQUAL_INT32(9, id);
}

void test_zero_is_a_valid_id() {
  int32_t id = -1;
  TEST_ASSERT_TRUE(rt::path_id("/api/v2/programs/0", kPrefix, "", id));
  TEST_ASSERT_EQUAL_INT32(0, id);
}

void test_int32_max_parses() {
  int32_t id = 0;
  TEST_ASSERT_TRUE(rt::path_id("/api/v2/programs/2147483647", kPrefix, "", id));
  TEST_ASSERT_EQUAL_INT32(2147483647, id);
}

// --- refused ---------------------------------------------------------------

void test_an_empty_id_is_refused() {
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/", kPrefix, "", id));
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs//load", kPrefix, "/load", id));
}

void test_a_non_numeric_id_is_refused() {
  // Must not read as 0 the way an atoi()-style parse would.
  int32_t id = -1;
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/abc", kPrefix, "", id));
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/12abc", kPrefix, "", id));
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/1 2", kPrefix, "", id));
}

void test_a_negative_id_is_refused() {
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/-1", kPrefix, "", id));
}

void test_an_id_past_int32_is_refused() {
  // Unbounded accumulation here would be signed overflow, i.e. UB.
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/2147483648", kPrefix, "", id));
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/99999999999999999999", kPrefix, "", id));
}

void test_a_traversal_attempt_is_refused() {
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/../../etc/passwd", kPrefix, "", id));
}

void test_a_wrong_prefix_is_refused() {
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/audios/12", kPrefix, "", id));
}

void test_a_missing_suffix_is_refused() {
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/12", kPrefix, "/load", id));
}

void test_a_wrong_suffix_is_refused() {
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/12/delete", kPrefix, "/load", id));
}

void test_the_prefix_alone_is_refused() {
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs", kPrefix, "", id));
}

void test_a_null_uri_is_refused() {
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::path_id(nullptr, kPrefix, "", id));
}

void test_a_fixed_run_control_path_is_refused_as_an_id() {
  // PUT /api/v2/programs/{id} is registered as a wildcard, so a client PUTting
  // /api/v2/programs/start reaches it. It must not read as an id.
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/start", kPrefix, "", id));
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/stop", kPrefix, "", id));
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/reset", kPrefix, "", id));
}

void test_a_nested_path_is_refused() {
  // /api/v2/programs/series/0/skip_to must not read as an id under the bare
  // programs prefix - the routes are distinguished by exactly this.
  int32_t id = 0;
  TEST_ASSERT_FALSE(rt::path_id("/api/v2/programs/series/0/skip_to", kPrefix, "", id));
}

// --- SPA fallback eligibility ----------------------------------------------

void test_a_client_side_route_is_eligible() {
  TEST_ASSERT_TRUE(rt::spa_fallback_eligible("/run"));
  TEST_ASSERT_TRUE(rt::spa_fallback_eligible("/settings"));
  TEST_ASSERT_TRUE(rt::spa_fallback_eligible("/legacy"));
  TEST_ASSERT_TRUE(rt::spa_fallback_eligible("/"));
}

void test_a_nested_route_and_a_trailing_slash_are_eligible() {
  TEST_ASSERT_TRUE(rt::spa_fallback_eligible("/programs/12/edit"));
  TEST_ASSERT_TRUE(rt::spa_fallback_eligible("/run/"));
}

void test_a_query_string_does_not_read_as_an_extension() {
  TEST_ASSERT_TRUE(rt::spa_fallback_eligible("/run?program=1.2"));
}

void test_the_api_keeps_its_own_404() {
  // A missing endpoint has to stay a JSON 404, or every client typo becomes
  // an HTML page the caller cannot parse.
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("/api"));
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("/api/v2/nope"));
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("/sse"));
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("/sse/v3"));
}

void test_a_prefix_only_matches_at_a_segment_boundary() {
  TEST_ASSERT_TRUE(rt::spa_fallback_eligible("/apiary"));
  TEST_ASSERT_TRUE(rt::spa_fallback_eligible("/sses"));
}

void test_a_missing_asset_stays_a_404() {
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("/assets/main-abc123.js"));
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("/favicon.ico"));
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("/legacy.html"));
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("/icons/play_24_regular.svg"));
}

void test_a_traversal_attempt_is_not_navigation() {
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("/../etc/passwd"));
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("/run/../../secret"));
}

void test_a_malformed_uri_is_refused() {
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible(nullptr));
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible(""));
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("run"));
  TEST_ASSERT_FALSE(rt::spa_fallback_eligible("?x=1"));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_a_bare_id_parses);
  RUN_TEST(test_an_id_with_a_suffix_parses);
  RUN_TEST(test_a_query_string_is_stripped);
  RUN_TEST(test_a_query_string_before_the_suffix_check);
  RUN_TEST(test_zero_is_a_valid_id);
  RUN_TEST(test_int32_max_parses);

  RUN_TEST(test_an_empty_id_is_refused);
  RUN_TEST(test_a_non_numeric_id_is_refused);
  RUN_TEST(test_a_negative_id_is_refused);
  RUN_TEST(test_an_id_past_int32_is_refused);
  RUN_TEST(test_a_traversal_attempt_is_refused);
  RUN_TEST(test_a_wrong_prefix_is_refused);
  RUN_TEST(test_a_missing_suffix_is_refused);
  RUN_TEST(test_a_wrong_suffix_is_refused);
  RUN_TEST(test_the_prefix_alone_is_refused);
  RUN_TEST(test_a_null_uri_is_refused);
  RUN_TEST(test_a_fixed_run_control_path_is_refused_as_an_id);
  RUN_TEST(test_a_nested_path_is_refused);

  RUN_TEST(test_a_client_side_route_is_eligible);
  RUN_TEST(test_a_nested_route_and_a_trailing_slash_are_eligible);
  RUN_TEST(test_a_query_string_does_not_read_as_an_extension);
  RUN_TEST(test_the_api_keeps_its_own_404);
  RUN_TEST(test_a_prefix_only_matches_at_a_segment_boundary);
  RUN_TEST(test_a_missing_asset_stays_a_404);
  RUN_TEST(test_a_traversal_attempt_is_not_navigation);
  RUN_TEST(test_a_malformed_uri_is_refused);
  return UNITY_END();
}
