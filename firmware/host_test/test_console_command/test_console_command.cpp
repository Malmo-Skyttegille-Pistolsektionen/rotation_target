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

// --- boot-targets (#144) ---------------------------------------------------
//
// The one setting that changes only from here, because it decides what the
// targets do while somebody may be standing downrange (D-31). Its parsing is
// worth pinning: a mistyped argument that silently read as "hidden" would be
// the exact failure the serial-only rule exists to prevent.

void test_boot_targets_is_recognised() {
  TEST_ASSERT_EQUAL(Command::kBootTargets, parse_command("boot-targets"));
  TEST_ASSERT_EQUAL(Command::kBootTargets, parse_command("  BOOT-TARGETS shown "));
}

void test_no_argument_means_report_rather_than_change() {
  TEST_ASSERT_EQUAL(rt::console::BootTargets::kMissing,
                    rt::console::parse_boot_targets("boot-targets"));
  TEST_ASSERT_EQUAL(rt::console::BootTargets::kMissing,
                    rt::console::parse_boot_targets("  boot-targets   "));
}

void test_both_positions_parse_whatever_the_case() {
  TEST_ASSERT_EQUAL(rt::console::BootTargets::kShown,
                    rt::console::parse_boot_targets("boot-targets shown"));
  TEST_ASSERT_EQUAL(rt::console::BootTargets::kShown,
                    rt::console::parse_boot_targets("boot-targets SHOWN"));
  TEST_ASSERT_EQUAL(rt::console::BootTargets::kHidden,
                    rt::console::parse_boot_targets("boot-targets hidden"));
  TEST_ASSERT_EQUAL(rt::console::BootTargets::kHidden,
                    rt::console::parse_boot_targets("  boot-targets   Hidden  "));
}

// Anything that is not one of the two words is invalid, not a default. A
// typo must not resolve to a position.
void test_anything_else_is_invalid_rather_than_a_default() {
  for (const char *line : {"boot-targets show", "boot-targets hide", "boot-targets yes",
                           "boot-targets 1", "boot-targets shown hidden"}) {
    TEST_ASSERT_EQUAL(rt::console::BootTargets::kInvalid, rt::console::parse_boot_targets(line));
  }
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
  RUN_TEST(test_boot_targets_is_recognised);
  RUN_TEST(test_no_argument_means_report_rather_than_change);
  RUN_TEST(test_both_positions_parse_whatever_the_case);
  RUN_TEST(test_anything_else_is_invalid_rather_than_a_default);
  return UNITY_END();
}
