// ============================================================================
//  In-memory admin mode: enable/login/disable and what authorizes a request.
//  Ported from tests/unit/repositories/test_admin_mode.py.
// ============================================================================
#include "admin_mode.h"
#include "unity.h"

namespace {

// A counter, not real entropy: these tests assert token distinctness and
// lifecycle, and a deterministic sequence makes a failure reproducible. The
// firmware injects esp_fill_random() instead.
uint32_t g_counter = 0;

void counting_bytes(uint8_t *out, size_t len) {
  g_counter++;
  for (size_t i = 0; i < len; i++) out[i] = static_cast<uint8_t>(g_counter + i);
}

rt::AdminMode *admin = nullptr;

rt::AdminMode &mode() {
  return *admin;
}

}  // namespace

void setUp() {
  g_counter = 0;
  admin = new rt::AdminMode(counting_bytes);
}

void tearDown() {
  delete admin;
  admin = nullptr;
}

// --- enable ----------------------------------------------------------------

void test_starts_disabled() {
  TEST_ASSERT_FALSE(mode().enabled());
}

void test_enable_returns_a_token() {
  const std::string token = mode().enable("hunter2");

  TEST_ASSERT_TRUE(mode().enabled());
  TEST_ASSERT_FALSE(token.empty());
  // 16 random bytes, hex-encoded.
  TEST_ASSERT_EQUAL_size_t(32, token.size());
}

void test_enable_rejects_an_empty_password() {
  TEST_ASSERT_TRUE(mode().enable("").empty());
  TEST_ASSERT_FALSE(mode().enabled());
}

void test_enable_is_refused_while_enabled() {
  mode().enable("hunter2");

  TEST_ASSERT_TRUE(mode().enable("other").empty());
}

// --- login -----------------------------------------------------------------

void test_login_is_refused_while_disabled() {
  TEST_ASSERT_TRUE(mode().login("hunter2").empty());
}

void test_login_rejects_the_wrong_password() {
  mode().enable("hunter2");

  TEST_ASSERT_TRUE(mode().login("wrong").empty());
}

void test_login_issues_a_second_token_without_invalidating_the_first() {
  const std::string first = mode().enable("hunter2");
  const std::string second = mode().login("hunter2");

  TEST_ASSERT_FALSE(second.empty());
  TEST_ASSERT_FALSE(first == second);
  TEST_ASSERT_TRUE(mode().authorize("Bearer " + first, ""));
  TEST_ASSERT_TRUE(mode().authorize("Bearer " + second, ""));
}

// --- authorize -------------------------------------------------------------

void test_everything_is_allowed_while_disabled() {
  TEST_ASSERT_TRUE(mode().authorize("", ""));
}

void test_a_bearer_token_is_accepted() {
  const std::string token = mode().enable("hunter2");

  TEST_ASSERT_TRUE(mode().authorize("Bearer " + token, ""));
}

void test_the_cookie_is_accepted() {
  const std::string token = mode().enable("hunter2");

  TEST_ASSERT_TRUE(mode().authorize("", token));
}

void test_missing_credentials_are_rejected() {
  mode().enable("hunter2");

  TEST_ASSERT_FALSE(mode().authorize("", ""));
}

void test_an_unknown_token_is_rejected() {
  mode().enable("hunter2");

  TEST_ASSERT_FALSE(mode().authorize("Bearer nope", ""));
  TEST_ASSERT_FALSE(mode().authorize("", "nope"));
}

void test_a_bare_token_without_the_bearer_prefix_is_rejected() {
  const std::string token = mode().enable("hunter2");

  TEST_ASSERT_FALSE(mode().authorize(token, ""));
}

void test_disable_invalidates_issued_tokens() {
  const std::string token = mode().enable("hunter2");

  mode().disable();
  mode().enable("hunter2");

  TEST_ASSERT_FALSE(mode().authorize("Bearer " + token, ""));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_starts_disabled);
  RUN_TEST(test_enable_returns_a_token);
  RUN_TEST(test_enable_rejects_an_empty_password);
  RUN_TEST(test_enable_is_refused_while_enabled);

  RUN_TEST(test_login_is_refused_while_disabled);
  RUN_TEST(test_login_rejects_the_wrong_password);
  RUN_TEST(test_login_issues_a_second_token_without_invalidating_the_first);

  RUN_TEST(test_everything_is_allowed_while_disabled);
  RUN_TEST(test_a_bearer_token_is_accepted);
  RUN_TEST(test_the_cookie_is_accepted);
  RUN_TEST(test_missing_credentials_are_rejected);
  RUN_TEST(test_an_unknown_token_is_rejected);
  RUN_TEST(test_a_bare_token_without_the_bearer_prefix_is_rejected);
  RUN_TEST(test_disable_invalidates_issued_tokens);
  return UNITY_END();
}
