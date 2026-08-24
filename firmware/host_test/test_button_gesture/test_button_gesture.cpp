// ============================================================================
//  Classifying BOOT-button gestures: a short press authorises the setup portal
//  (#208), a long hold restarts into safe mode (#209). They share one pin, so
//  the thing that matters is that they can never be confused for each other.
// ============================================================================
#include "button_gesture.h"
#include "unity.h"

namespace {

// Time is advanced by hand so a three-second hold is asserted without sleeping
// for three seconds.
int64_t g_now_ms = 0;

// Samples the button the way the polling task does: one reading per tick.
rt::Gesture hold_for(rt::ButtonGesture &gesture, int64_t ms, int64_t step_ms = 20) {
  rt::Gesture seen = rt::Gesture::kNone;
  for (int64_t elapsed = 0; elapsed < ms; elapsed += step_ms) {
    g_now_ms += step_ms;
    const rt::Gesture g = gesture.update(true, g_now_ms);
    if (g != rt::Gesture::kNone) seen = g;
  }
  return seen;
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
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone), static_cast<int>(hold_for(gesture, 200)));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kShortPress), static_cast<int>(release(gesture)));
}

// A brush against the board, or contact bounce, must not authorise anything.
void test_a_press_shorter_than_the_debounce_is_ignored() {
  rt::ButtonGesture gesture;
  g_now_ms += 5;
  gesture.update(true, g_now_ms);
  g_now_ms += 10;
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone),
                    static_cast<int>(gesture.update(false, g_now_ms)));
}

// Fires while the button is still down, so the operator knows it registered
// without having to let go and guess.
void test_a_long_hold_fires_before_release() {
  rt::ButtonGesture gesture;
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kLongHold),
                    static_cast<int>(hold_for(gesture, 3200)));
}

// The whole point of one pin carrying two meanings: a hold must not also
// authorise the portal on the way up.
void test_a_long_hold_does_not_also_report_a_press_on_release() {
  rt::ButtonGesture gesture;
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kLongHold),
                    static_cast<int>(hold_for(gesture, 3200)));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone), static_cast<int>(release(gesture)));
}

void test_a_long_hold_fires_only_once_however_long_it_is_held() {
  rt::ButtonGesture gesture;
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kLongHold),
                    static_cast<int>(hold_for(gesture, 3200)));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone),
                    static_cast<int>(hold_for(gesture, 5000)));
}

// Just short of the threshold is a press, not a hold - so somebody aiming for
// the portal and holding a beat too long still gets what they wanted.
void test_just_under_the_threshold_is_still_a_press() {
  rt::ButtonGesture gesture(3000);
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone),
                    static_cast<int>(hold_for(gesture, 2900)));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kShortPress), static_cast<int>(release(gesture)));
}

void test_presses_are_reported_one_per_press() {
  rt::ButtonGesture gesture;
  for (int i = 0; i < 3; i++) {
    hold_for(gesture, 200);
    TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kShortPress),
                      static_cast<int>(release(gesture)));
  }
}

// The task polls whether or not anybody is touching the board.
void test_an_idle_button_reports_nothing() {
  rt::ButtonGesture gesture;
  for (int i = 0; i < 100; i++) {
    g_now_ms += 20;
    TEST_ASSERT_EQUAL(static_cast<int>(rt::Gesture::kNone),
                      static_cast<int>(gesture.update(false, g_now_ms)));
  }
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_a_normal_press_is_a_short_press);
  RUN_TEST(test_a_press_shorter_than_the_debounce_is_ignored);
  RUN_TEST(test_a_long_hold_fires_before_release);
  RUN_TEST(test_a_long_hold_does_not_also_report_a_press_on_release);
  RUN_TEST(test_a_long_hold_fires_only_once_however_long_it_is_held);
  RUN_TEST(test_just_under_the_threshold_is_still_a_press);
  RUN_TEST(test_presses_are_reported_one_per_press);
  RUN_TEST(test_an_idle_button_reports_nothing);
  return UNITY_END();
}
