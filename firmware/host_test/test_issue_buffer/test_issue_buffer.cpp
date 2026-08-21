// ============================================================================
//  The bounded store behind `startupIssues` in GET /api/v2/diagnostics/info.
//  What matters is the bound - a directory full of unparsable files must not
//  grow the heap at boot - and that a full store keeps the *latest* issues, so
//  it reflects where the scan finished rather than where it started.
// ============================================================================
#include <string>
#include <vector>

#include "backend_issue.h"
#include "issue_buffer.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

namespace {

std::string issue(int n) {
  return rt::backend_issue_json(rt::issue_code::kProgramInvalid, "Bad",
                                {{"file", "/s/" + std::to_string(n) + ".json"}});
}

}  // namespace

// --- the bound -------------------------------------------------------------

void test_empty_until_something_is_pushed() {
  rt::IssueBuffer buffer(8);
  TEST_ASSERT_EQUAL_UINT(0, buffer.entries().size());
  TEST_ASSERT_EQUAL_STRING("[]", rt::issue_array_json(buffer.entries()).c_str());
}

void test_keeps_everything_below_the_bound() {
  rt::IssueBuffer buffer(8);
  for (int i = 0; i < 8; i++) buffer.push(issue(i));
  TEST_ASSERT_EQUAL_UINT(8, buffer.entries().size());
  TEST_ASSERT_EQUAL_STRING(issue(0).c_str(), buffer.entries().front().c_str());
  TEST_ASSERT_EQUAL_STRING(issue(7).c_str(), buffer.entries().back().c_str());
}

void test_the_oldest_is_dropped_past_the_bound() {
  rt::IssueBuffer buffer(3);
  for (int i = 0; i < 10; i++) buffer.push(issue(i));
  TEST_ASSERT_EQUAL_UINT(3, buffer.entries().size());
  TEST_ASSERT_EQUAL_STRING(issue(7).c_str(), buffer.entries()[0].c_str());
  TEST_ASSERT_EQUAL_STRING(issue(8).c_str(), buffer.entries()[1].c_str());
  TEST_ASSERT_EQUAL_STRING(issue(9).c_str(), buffer.entries()[2].c_str());
}

void test_a_capacity_of_zero_keeps_nothing() {
  // Not reachable from kMaxStartupIssues, but a bound of zero must not be an
  // out-of-range erase.
  rt::IssueBuffer buffer(0);
  buffer.push(issue(1));
  TEST_ASSERT_EQUAL_UINT(0, buffer.entries().size());
}

void test_order_is_the_order_pushed() {
  rt::IssueBuffer buffer(8);
  buffer.push("a");
  buffer.push("b");
  buffer.push("c");
  TEST_ASSERT_EQUAL_STRING(R"([a,b,c])", rt::issue_array_json(buffer.entries()).c_str());
}

// --- the array ------------------------------------------------------------

void test_the_payloads_are_embedded_verbatim() {
  // They are already JSON objects from backend_issue_json, escaping included.
  // Re-quoting them here would send the client strings instead of objects.
  const std::string one = issue(20);
  TEST_ASSERT_EQUAL_STRING(("[" + one + "]").c_str(), rt::issue_array_json({one}).c_str());
}

void test_a_single_entry_has_no_separator() {
  TEST_ASSERT_EQUAL_STRING(R"([{"x":1}])", rt::issue_array_json({R"({"x":1})"}).c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_empty_until_something_is_pushed);
  RUN_TEST(test_keeps_everything_below_the_bound);
  RUN_TEST(test_the_oldest_is_dropped_past_the_bound);
  RUN_TEST(test_a_capacity_of_zero_keeps_nothing);
  RUN_TEST(test_order_is_the_order_pushed);

  RUN_TEST(test_the_payloads_are_embedded_verbatim);
  RUN_TEST(test_a_single_entry_has_no_separator);
  return UNITY_END();
}
