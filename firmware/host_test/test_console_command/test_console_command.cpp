// ============================================================================
//  The serial console's line parser. Outside bytes turning into meaning, so it
//  lives in rt_logic and is tested here rather than behind a UART in main/.
// ============================================================================
#include "console_command.h"
#include "unity.h"

using rt::console::Command;
using rt::console::first_word;
using rt::console::parse_command;

void setUp() {}
void tearDown() {}

// --- what we answer to -----------------------------------------------------

void test_status_is_recognised() {
  TEST_ASSERT_EQUAL(Command::kStatus, parse_command("status"));
}

void test_help_is_recognised() {
  TEST_ASSERT_EQUAL(Command::kHelp, parse_command("help"));
  TEST_ASSERT_EQUAL(Command::kHelp, parse_command("?"));
}

// --- what a serial terminal actually sends ---------------------------------

void test_surrounding_whitespace_is_ignored() {
  // A terminal sends what was typed, and people type spaces.
  TEST_ASSERT_EQUAL(Command::kStatus, parse_command("  status  "));
  TEST_ASSERT_EQUAL(Command::kStatus, parse_command("\tstatus"));
}

void test_capitalisation_is_ignored() {
  // Nobody standing at a range should be corrected on capitalisation.
  TEST_ASSERT_EQUAL(Command::kStatus, parse_command("STATUS"));
  TEST_ASSERT_EQUAL(Command::kStatus, parse_command("Status"));
}

void test_trailing_arguments_do_not_prevent_a_match() {
  // `status` takes none, but a stray word must not turn it into "unknown".
  TEST_ASSERT_EQUAL(Command::kStatus, parse_command("status now"));
}

// --- what is not a command -------------------------------------------------

void test_a_blank_line_is_not_an_error() {
  // Pressing enter at a prompt is how people check the device is alive; it
  // must not answer with a complaint.
  TEST_ASSERT_EQUAL(Command::kNone, parse_command(""));
  TEST_ASSERT_EQUAL(Command::kNone, parse_command("   "));
  TEST_ASSERT_EQUAL(Command::kNone, parse_command("\r\n"));
}

void test_an_unknown_word_is_reported_as_unknown() {
  TEST_ASSERT_EQUAL(Command::kUnknown, parse_command("statuses"));
  TEST_ASSERT_EQUAL(Command::kUnknown, parse_command("reboot"));
}

void test_a_prefix_is_not_a_match() {
  // Line noise on a serial line is not a command.
  TEST_ASSERT_EQUAL(Command::kUnknown, parse_command("stat"));
  TEST_ASSERT_EQUAL(Command::kUnknown, parse_command("s"));
}

void test_the_word_comes_back_for_echoing() {
  TEST_ASSERT_EQUAL_STRING("reboot", first_word("  reboot now  ").c_str());
  TEST_ASSERT_EQUAL_STRING("", first_word("   ").c_str());
}

void test_a_very_long_word_does_not_match_anything() {
  const std::string noise(500, 'x');
  TEST_ASSERT_EQUAL(Command::kUnknown, parse_command(noise));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_status_is_recognised);
  RUN_TEST(test_help_is_recognised);
  RUN_TEST(test_surrounding_whitespace_is_ignored);
  RUN_TEST(test_capitalisation_is_ignored);
  RUN_TEST(test_trailing_arguments_do_not_prevent_a_match);
  RUN_TEST(test_a_blank_line_is_not_an_error);
  RUN_TEST(test_an_unknown_word_is_reported_as_unknown);
  RUN_TEST(test_a_prefix_is_not_a_match);
  RUN_TEST(test_the_word_comes_back_for_echoing);
  RUN_TEST(test_a_very_long_word_does_not_match_anything);
  return UNITY_END();
}
