// ============================================================================
//  Which network the setup portal's form asked for: the dropdown, or the
//  free-text field beside it. Reachable from here because it is a decision,
//  not an effect - and because it replaced a mechanism that was broken in a
//  way no test existed to catch.
// ============================================================================
#include "ssid_choice.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

void test_the_dropdown_is_used_when_nothing_was_typed() {
  TEST_ASSERT_EQUAL_STRING("Klubbnat", rt::chosen_ssid("Klubbnat", "").c_str());
}

// Somebody who typed a name did so after seeing the list, so it is the later
// and more deliberate of the two.
void test_typing_wins_over_the_dropdown() {
  TEST_ASSERT_EQUAL_STRING("Hidden-AP", rt::chosen_ssid("Klubbnat", "Hidden-AP").c_str());
}

void test_typing_alone_is_enough() {
  TEST_ASSERT_EQUAL_STRING("Hidden-AP", rt::chosen_ssid("", "Hidden-AP").c_str());
}

// The placeholder option submits an empty value, and an empty form has to stay
// empty so the handler can refuse it rather than save a nameless network.
void test_nothing_chosen_and_nothing_typed_is_empty() {
  TEST_ASSERT_EQUAL_STRING("", rt::chosen_ssid("", "").c_str());
}

// A phone keyboard offers a trailing space after almost anything. Saved as
// part of the name it would fail the join with nothing on screen to explain it.
void test_a_typed_name_is_trimmed() {
  TEST_ASSERT_EQUAL_STRING("Hidden-AP", rt::chosen_ssid("", "  Hidden-AP  ").c_str());
  TEST_ASSERT_EQUAL_STRING("Hidden-AP", rt::chosen_ssid("", "Hidden-AP\r\n").c_str());
}

// Whitespace is not a network name, so it must fall through to the dropdown
// rather than override it with nothing.
void test_a_field_of_only_spaces_is_not_a_name() {
  TEST_ASSERT_EQUAL_STRING("Klubbnat", rt::chosen_ssid("Klubbnat", "   ").c_str());
  TEST_ASSERT_EQUAL_STRING("Klubbnat", rt::chosen_ssid("Klubbnat", "\t\r\n").c_str());
  TEST_ASSERT_EQUAL_STRING("", rt::chosen_ssid("", "  ").c_str());
}

// Trimming the ends must not touch the middle - "Bana E" is one of ours.
void test_spaces_inside_a_name_are_kept() {
  TEST_ASSERT_EQUAL_STRING("Bana E", rt::chosen_ssid("", "  Bana E  ").c_str());
  TEST_ASSERT_EQUAL_STRING("a  b", rt::chosen_ssid("", "a  b").c_str());
}

// The scan's bytes are not typed by anybody, and an SSID may legitimately
// begin or end with a space. Trimming that half would make such a network
// unjoinable from the list.
void test_the_dropdown_value_is_taken_verbatim() {
  TEST_ASSERT_EQUAL_STRING(" spaced ", rt::chosen_ssid(" spaced ", "").c_str());
}

// The old mechanism encoded "the user wants the text field" as a U+0001
// sentinel in an HTML attribute. There is no mode to signal any more, so a
// name that merely looks like the old sentinel is just a name.
void test_there_is_no_sentinel_value_any_more() {
  TEST_ASSERT_EQUAL_STRING("\x01other", rt::chosen_ssid("\x01other", "").c_str());
  TEST_ASSERT_EQUAL_STRING("Other", rt::chosen_ssid("Other", "").c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_the_dropdown_is_used_when_nothing_was_typed);
  RUN_TEST(test_typing_wins_over_the_dropdown);
  RUN_TEST(test_typing_alone_is_enough);
  RUN_TEST(test_nothing_chosen_and_nothing_typed_is_empty);
  RUN_TEST(test_a_typed_name_is_trimmed);
  RUN_TEST(test_a_field_of_only_spaces_is_not_a_name);
  RUN_TEST(test_spaces_inside_a_name_are_kept);
  RUN_TEST(test_the_dropdown_value_is_taken_verbatim);
  RUN_TEST(test_there_is_no_sentinel_value_any_more);
  return UNITY_END();
}
