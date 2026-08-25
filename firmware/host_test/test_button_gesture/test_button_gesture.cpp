// ============================================================================
//  Classifying BOOT-button gestures: a short press authorises the setup portal
//  (#208), a hold is the factory reset (#222) and reports itself in two
//  stages. They share one pin, so the thing that matters is that they can
//  never be confused for each other - and that the destructive one cannot be
//  reached without passing through the stage that announces it.
// ============================================================================
#include "button_gesture.h"
#include "unity.h"

namespace {

// Time is advanced by hand so a ten-second hold is asserted without sleeping
// for ten seconds.
int64_t g_now_ms = 0;

// Samples the button the way the polling task does: one reading per tick.
// Returns the last non-kNone gesture seen, so a hold that passes two
// thresholds reports the later one.
rt::Gesture hold_for(rt::ButtonGesture &gesture, int64_t ms, int64_t step_ms = 20) {
  rt::Gesture seen = rt::Gesture::kNone;
  for (int64_t elapsed = 0; elapsed < ms; elapsed += step_ms) {
    g_now_ms += step_ms;
    const rt::Gesture g = gesture.update(true, g_now_ms);
    if (g != rt::Gesture::kNone) seen = g;
  }
  return seen;
}

// One sample of an untouched pin. The polling task always sees this long
// before anybody touches the board, and a classifier that has never seen the
// button up refuses to act (see the stuck-pin tests at the bottom) - so every
// test that models a real *press* starts here.
void idle(rt::ButtonGesture &gesture) {
  g_now_ms += 20;
  gesture.update(false, g_now_ms);
}

rt::Gesture release(rt::ButtonGesture &gesture) {
  g_now_ms += 20;
  return gesture.update(false, g_now_ms);
}

}  // namespace

void setUp() {
  g_now_ms = 1'000'000;
}

void tearDown() {}

void test_a_normal_press_is_a_short_press() {
  rt::ButtonGesture gesture;
  idle(gesture);
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone), static_cast<int>(hold_for(gesture, 200)));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kShortPress), static_cast<int>(release(gesture)));
}

// A brush against the board, or contact bounce, must not authorise anything.
void test_a_press_shorter_than_the_debounce_is_ignored() {
  rt::ButtonGesture gesture;
  idle(gesture);
  g_now_ms += 5;
  gesture.update(true, g_now_ms);
  g_now_ms += 10;
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone),
                    static_cast<int>(gesture.update(false, g_now_ms)));
}

// Fires while the button is still down, so the operator knows it registered
// without having to let go and guess.
void test_arming_fires_before_release() {
  rt::ButtonGesture gesture;
  idle(gesture);
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kHoldArmed),
                    static_cast<int>(hold_for(gesture, 3200)));
  TEST_ASSERT_TRUE(gesture.armed());
}

// The whole point of one pin carrying several meanings: a hold must not also
// authorise the portal on the way up.
void test_a_hold_does_not_also_report_a_press_on_release() {
  rt::ButtonGesture gesture;
  idle(gesture);
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kHoldArmed),
                    static_cast<int>(hold_for(gesture, 3200)));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone), static_cast<int>(release(gesture)));
}

void test_arming_fires_only_once() {
  rt::ButtonGesture gesture;
  idle(gesture);
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kHoldArmed),
                    static_cast<int>(hold_for(gesture, 3200)));
  // Still short of the commit threshold, so nothing more should be reported.
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone),
                    static_cast<int>(hold_for(gesture, 5000)));
}

// The destructive one. Ten seconds, and it commits while the button is still
// down rather than on release.
void test_a_ten_second_hold_is_a_factory_reset() {
  rt::ButtonGesture gesture;
  idle(gesture);
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kFactoryReset),
                    static_cast<int>(hold_for(gesture, 10'200)));
}

void test_the_factory_reset_fires_only_once_however_long_it_is_held() {
  rt::ButtonGesture gesture;
  idle(gesture);
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kFactoryReset),
                    static_cast<int>(hold_for(gesture, 10'200)));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone),
                    static_cast<int>(hold_for(gesture, 30'000)));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone), static_cast<int>(release(gesture)));
}

// Letting go between the two thresholds is how somebody backs out, so it must
// destroy nothing - and armed() must say so, because that is the only signal
// the caller gets that the hold ended.
void test_releasing_between_the_thresholds_abandons_the_reset() {
  rt::ButtonGesture gesture;
  idle(gesture);
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kHoldArmed),
                    static_cast<int>(hold_for(gesture, 5000)));
  TEST_ASSERT_TRUE(gesture.armed());
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone), static_cast<int>(release(gesture)));
  TEST_ASSERT_FALSE(gesture.armed());
}

// A starved poll must not be able to skip the commit: if the task is late
// enough that one sample straddles both thresholds, the reset still happens
// rather than the gesture reporting only that it was armed and then going
// quiet forever.
void test_one_late_sample_past_both_thresholds_still_commits() {
  rt::ButtonGesture gesture;
  idle(gesture);
  gesture.update(true, g_now_ms);
  g_now_ms += 12'000;
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kFactoryReset),
                    static_cast<int>(gesture.update(true, g_now_ms)));
}

// Just short of the arming threshold is a press, not a hold - so somebody
// aiming for the portal and holding a beat too long still gets what they
// wanted.
void test_just_under_the_threshold_is_still_a_press() {
  rt::ButtonGesture gesture(3000);
  idle(gesture);
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone),
                    static_cast<int>(hold_for(gesture, 2900)));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kShortPress), static_cast<int>(release(gesture)));
}

void test_presses_are_reported_one_per_press() {
  rt::ButtonGesture gesture;
  idle(gesture);
  for (int i = 0; i < 3; i++) {
    hold_for(gesture, 200);
    TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kShortPress),
                      static_cast<int>(release(gesture)));
  }
}

// Three presses open the configuration window (#144), and each of them is a
// short press in its own right. A rhythm of them must never accumulate into a
// hold.
void test_repeated_presses_never_become_a_hold() {
  rt::ButtonGesture gesture;
  idle(gesture);
  for (int i = 0; i < 6; i++) {
    hold_for(gesture, 200);
    TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kShortPress),
                      static_cast<int>(release(gesture)));
    g_now_ms += 300;
    gesture.update(false, g_now_ms);
  }
  TEST_ASSERT_FALSE(gesture.armed());
}

// The task polls whether or not anybody is touching the board.
void test_an_idle_button_reports_nothing() {
  rt::ButtonGesture gesture;
  idle(gesture);
  for (int i = 0; i < 100; i++) {
    g_now_ms += 20;
    TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone),
                      static_cast<int>(gesture.update(false, g_now_ms)));
  }
  TEST_ASSERT_FALSE(gesture.armed());
}

// --- a pin that is simply broken -------------------------------------------
//
// Found by CI, not by review: under QEMU the internal pull-up is not emulated,
// GPIO0 reads low forever, and the emulated device factory-reset and rebooted
// every ten seconds - seventeen boots in one E2E run. A shorted or jammed BOOT
// button does the same thing to a real board, and wiping the configuration in
// a loop is about the worst possible response to a hardware fault.

void test_a_pin_low_since_boot_never_commits_a_factory_reset() {
  rt::ButtonGesture gesture;
  // Held from the very first sample, for a minute.
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone),
                    static_cast<int>(hold_for(gesture, 60'000)));
  TEST_ASSERT_TRUE(gesture.stuck_pressed());
  TEST_ASSERT_FALSE(gesture.armed());
}

void test_a_pin_low_since_boot_does_not_report_a_press_either() {
  rt::ButtonGesture gesture;
  hold_for(gesture, 500);
  // Even the release is not a press: the "press" began before the device was
  // watching, so there is nothing to say it was deliberate.
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone), static_cast<int>(release(gesture)));
}

// ...and once it *is* released, everything works normally. The guard is about
// the first sample, not a permanent lockout of a board that happened to boot
// with the button down.
void test_the_button_works_normally_once_it_has_been_released() {
  rt::ButtonGesture gesture;
  hold_for(gesture, 30'000);
  release(gesture);
  TEST_ASSERT_FALSE(gesture.stuck_pressed());

  hold_for(gesture, 200);
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kShortPress), static_cast<int>(release(gesture)));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kFactoryReset),
                    static_cast<int>(hold_for(gesture, 10'200)));
}

// An idle board has been released since the first sample by definition, so the
// guard must not make the ordinary case wait for anything.
void test_an_idle_board_is_not_considered_stuck() {
  rt::ButtonGesture gesture;
  g_now_ms += 20;
  gesture.update(false, g_now_ms);
  TEST_ASSERT_FALSE(gesture.stuck_pressed());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_a_normal_press_is_a_short_press);
  RUN_TEST(test_a_press_shorter_than_the_debounce_is_ignored);
  RUN_TEST(test_arming_fires_before_release);
  RUN_TEST(test_a_hold_does_not_also_report_a_press_on_release);
  RUN_TEST(test_arming_fires_only_once);
  RUN_TEST(test_a_ten_second_hold_is_a_factory_reset);
  RUN_TEST(test_the_factory_reset_fires_only_once_however_long_it_is_held);
  RUN_TEST(test_releasing_between_the_thresholds_abandons_the_reset);
  RUN_TEST(test_one_late_sample_past_both_thresholds_still_commits);
  RUN_TEST(test_just_under_the_threshold_is_still_a_press);
  RUN_TEST(test_presses_are_reported_one_per_press);
  RUN_TEST(test_repeated_presses_never_become_a_hold);
  RUN_TEST(test_an_idle_button_reports_nothing);
  RUN_TEST(test_a_pin_low_since_boot_never_commits_a_factory_reset);
  RUN_TEST(test_a_pin_low_since_boot_does_not_report_a_press_either);
  RUN_TEST(test_the_button_works_normally_once_it_has_been_released);
  RUN_TEST(test_an_idle_board_is_not_considered_stuck);
  return UNITY_END();
}
