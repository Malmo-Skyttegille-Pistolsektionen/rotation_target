// ============================================================================
//  Three presses inside ten seconds unlock the hardware configuration (#144).
//  The property that matters is that it cannot be reached by accident, so most
//  of these are about what must NOT complete the sequence.
// ============================================================================
#include "press_sequence.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

void test_three_presses_close_together_unlock() {
  rt::PressSequence seq;
  TEST_ASSERT_FALSE(seq.press(1000));
  TEST_ASSERT_FALSE(seq.press(1500));
  TEST_ASSERT_TRUE(seq.press(2000));
}

// The whole reason for three rather than one.
void test_one_press_does_not_unlock() {
  rt::PressSequence seq;
  TEST_ASSERT_FALSE(seq.press(1000));
}

void test_two_presses_do_not_unlock() {
  rt::PressSequence seq;
  TEST_ASSERT_FALSE(seq.press(1000));
  TEST_ASSERT_FALSE(seq.press(2000));
}

// Somebody who brushes the board once a minute never accumulates a sequence.
void test_three_presses_too_far_apart_do_not_unlock() {
  rt::PressSequence seq;
  TEST_ASSERT_FALSE(seq.press(0));
  TEST_ASSERT_FALSE(seq.press(60'000));
  TEST_ASSERT_FALSE(seq.press(120'000));
}

// A sliding window, not a counter that resets: pressing steadily every four
// seconds should succeed on the third rather than throwing away progress.
void test_a_sliding_window_lets_a_slow_rhythm_succeed() {
  rt::PressSequence seq;
  TEST_ASSERT_FALSE(seq.press(0));
  TEST_ASSERT_FALSE(seq.press(4000));
  TEST_ASSERT_TRUE(seq.press(8000));
}

// The first press ages out, so the next three are judged on their own.
void test_an_old_press_does_not_count_towards_a_later_sequence() {
  rt::PressSequence seq;
  TEST_ASSERT_FALSE(seq.press(0));
  TEST_ASSERT_FALSE(seq.press(30'000));
  // 0 has aged out; this is only the second press of the live rhythm.
  TEST_ASSERT_FALSE(seq.press(31'000));
  TEST_ASSERT_TRUE(seq.press(32'000));
}

// Exactly on the boundary is inside it.
void test_the_window_edge_is_inclusive() {
  rt::PressSequence seq;
  TEST_ASSERT_FALSE(seq.press(0));
  TEST_ASSERT_FALSE(seq.press(1));
  TEST_ASSERT_TRUE(seq.press(10'000));
}

void test_one_millisecond_past_the_window_does_not_unlock() {
  rt::PressSequence seq;
  TEST_ASSERT_FALSE(seq.press(0));
  TEST_ASSERT_FALSE(seq.press(1));
  TEST_ASSERT_FALSE(seq.press(10'001));
}

// A fourth press starts the next rhythm rather than completing another
// sequence off the back of the first - otherwise holding the button down and
// letting it bounce would unlock repeatedly.
void test_a_fourth_press_does_not_immediately_unlock_again() {
  rt::PressSequence seq;
  seq.press(0);
  seq.press(100);
  TEST_ASSERT_TRUE(seq.press(200));
  TEST_ASSERT_FALSE(seq.press(300));
  TEST_ASSERT_FALSE(seq.press(400));
  TEST_ASSERT_TRUE(seq.press(500));
}

void test_reset_forgets_the_rhythm_so_far() {
  rt::PressSequence seq;
  seq.press(0);
  seq.press(100);
  seq.reset();
  TEST_ASSERT_FALSE(seq.press(200));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_three_presses_close_together_unlock);
  RUN_TEST(test_one_press_does_not_unlock);
  RUN_TEST(test_two_presses_do_not_unlock);
  RUN_TEST(test_three_presses_too_far_apart_do_not_unlock);
  RUN_TEST(test_a_sliding_window_lets_a_slow_rhythm_succeed);
  RUN_TEST(test_an_old_press_does_not_count_towards_a_later_sequence);
  RUN_TEST(test_the_window_edge_is_inclusive);
  RUN_TEST(test_one_millisecond_past_the_window_does_not_unlock);
  RUN_TEST(test_a_fourth_press_does_not_immediately_unlock_again);
  RUN_TEST(test_reset_forgets_the_rhythm_so_far);
  return UNITY_END();
}
