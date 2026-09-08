// ============================================================================
//  Reading the `banks` list off a /targets/* body, and the prose that goes
//  back. Both live in rt_logic so they are testable without an HTTP server.
// ============================================================================
#include "target_bank.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

void test_letters_become_bits_in_position_order() {
  const rt::BankSelection sel = rt::parse_bank_selection({"A", "C"}, 4);

  TEST_ASSERT_TRUE(sel.ok);
  TEST_ASSERT_EQUAL_UINT32(rt::bank_bit(0) | rt::bank_bit(2), sel.mask);
}

// The device has A..C, so D exists as a letter but not as a bank here.
void test_a_letter_beyond_the_device_is_refused() {
  const rt::BankSelection sel = rt::parse_bank_selection({"A", "D"}, 3);

  TEST_ASSERT_FALSE(sel.ok);
  TEST_ASSERT_EQUAL_STRING("D", sel.offender.c_str());
  // Nothing moves on a refusal: the list is applied whole, so a typo in the
  // second entry cannot leave the first one already driven.
  TEST_ASSERT_EQUAL_UINT32(0u, sel.mask);
}

void test_letters_outside_a_to_h_are_refused() {
  TEST_ASSERT_FALSE(rt::parse_bank_selection({"I"}, 8).ok);
  TEST_ASSERT_FALSE(rt::parse_bank_selection({"Z"}, 8).ok);
  TEST_ASSERT_FALSE(rt::parse_bank_selection({"0"}, 8).ok);
}

// One spelling per bank, so the device never has to decide whether "a" and "A"
// are the same request.
void test_lower_case_is_not_a_bank() {
  const rt::BankSelection sel = rt::parse_bank_selection({"a"}, 4);

  TEST_ASSERT_FALSE(sel.ok);
  TEST_ASSERT_EQUAL_STRING("a", sel.offender.c_str());
}

void test_a_multi_character_entry_is_refused() {
  TEST_ASSERT_FALSE(rt::parse_bank_selection({"AB"}, 4).ok);
  TEST_ASSERT_FALSE(rt::parse_bank_selection({""}, 4).ok);
}

// Absent means every bank; an empty array asked for something else, and
// widening it would silently move targets the client did not name.
void test_an_empty_list_is_refused_rather_than_widened() {
  const rt::BankSelection sel = rt::parse_bank_selection({}, 4);

  TEST_ASSERT_FALSE(sel.ok);
  TEST_ASSERT_TRUE(sel.offender.empty());
}

void test_a_repeated_letter_is_accepted() {
  const rt::BankSelection sel = rt::parse_bank_selection({"B", "B"}, 4);

  TEST_ASSERT_TRUE(sel.ok);
  TEST_ASSERT_EQUAL_UINT32(rt::bank_bit(1), sel.mask);
}

void test_refusal_names_the_range_the_device_has() {
  const rt::BankSelection sel = rt::parse_bank_selection({"E"}, 3);

  TEST_ASSERT_EQUAL_STRING("'E' is not a bank on this device, which has banks A-C.",
                           rt::bank_refusal_message(sel, 3).c_str());
}

void test_refusal_on_one_bank_does_not_say_a_to_a() {
  const rt::BankSelection sel = rt::parse_bank_selection({"B"}, 1);

  TEST_ASSERT_EQUAL_STRING("'B' is not a bank on this device, which has only bank A.",
                           rt::bank_refusal_message(sel, 1).c_str());
}

void test_empty_list_refusal_points_at_the_bodyless_call() {
  const rt::BankSelection sel = rt::parse_bank_selection({}, 4);

  TEST_ASSERT_EQUAL_STRING("'banks' named no bank. Omit the body to move every bank.",
                           rt::bank_refusal_message(sel, 4).c_str());
}

void test_mask_for_count_covers_exactly_that_many() {
  TEST_ASSERT_EQUAL_UINT32(0x01u, rt::mask_for_count(1));
  TEST_ASSERT_EQUAL_UINT32(0x0Fu, rt::mask_for_count(4));
  TEST_ASSERT_EQUAL_UINT32(0xFFu, rt::mask_for_count(8));
}

// A one-bank device never sees a letter: the message is the one it sent before
// banks existed.
void test_every_bank_keeps_the_pre_bank_wording() {
  TEST_ASSERT_EQUAL_STRING("Targets shown", rt::targets_moved_message(0x1u, 0u, 1).c_str());
  TEST_ASSERT_EQUAL_STRING("Targets hidden", rt::targets_moved_message(0u, 0x1u, 1).c_str());
  TEST_ASSERT_EQUAL_STRING("Targets shown", rt::targets_moved_message(0xFu, 0u, 4).c_str());
}

void test_a_subset_is_named() {
  TEST_ASSERT_EQUAL_STRING("Bank B shown",
                           rt::targets_moved_message(rt::bank_bit(1), 0u, 4).c_str());
  TEST_ASSERT_EQUAL_STRING(
      "Banks B and C hidden",
      rt::targets_moved_message(0u, rt::bank_bit(1) | rt::bank_bit(2), 4).c_str());
  TEST_ASSERT_EQUAL_STRING(
      "Banks A, B and D shown",
      rt::targets_moved_message(rt::bank_bit(0) | rt::bank_bit(1) | rt::bank_bit(3), 0u, 5)
          .c_str());
}

// A toggle over a mixed strip splits: some banks came on, others went off.
void test_a_split_toggle_reports_both_directions() {
  TEST_ASSERT_EQUAL_STRING("Bank B shown, bank C hidden",
                           rt::targets_moved_message(rt::bank_bit(1), rt::bank_bit(2), 4).c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_letters_become_bits_in_position_order);
  RUN_TEST(test_a_letter_beyond_the_device_is_refused);
  RUN_TEST(test_letters_outside_a_to_h_are_refused);
  RUN_TEST(test_lower_case_is_not_a_bank);
  RUN_TEST(test_a_multi_character_entry_is_refused);
  RUN_TEST(test_an_empty_list_is_refused_rather_than_widened);
  RUN_TEST(test_a_repeated_letter_is_accepted);
  RUN_TEST(test_refusal_names_the_range_the_device_has);
  RUN_TEST(test_refusal_on_one_bank_does_not_say_a_to_a);
  RUN_TEST(test_empty_list_refusal_points_at_the_bodyless_call);
  RUN_TEST(test_mask_for_count_covers_exactly_that_many);
  RUN_TEST(test_every_bank_keeps_the_pre_bank_wording);
  RUN_TEST(test_a_subset_is_named);
  RUN_TEST(test_a_split_toggle_reports_both_directions);
  return UNITY_END();
}
