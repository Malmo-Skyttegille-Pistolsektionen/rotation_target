// ============================================================================
//  The shipped/upload id split (#129): shipped ids sat inside the range
//  add_uploaded() assigns from, so a promoted program's uploaded leftover
//  silently shadowed the shipped copy that replaced it.
// ============================================================================
#include <set>

#include "id_range.h"
#include "unity.h"

void setUp() {}
void tearDown() {}

// --- is_shipped_id ----------------------------------------------------------

void test_below_first_upload_id_is_shipped() {
  TEST_ASSERT_TRUE(rt::is_shipped_id(0, 100));
  TEST_ASSERT_TRUE(rt::is_shipped_id(99, 100));
}

void test_at_or_past_first_upload_id_is_not_shipped() {
  TEST_ASSERT_FALSE(rt::is_shipped_id(100, 100));
  TEST_ASSERT_FALSE(rt::is_shipped_id(101, 100));
}

// --- next_free_id ------------------------------------------------------------

void test_first_upload_takes_the_first_id() {
  const int32_t id = rt::next_free_id(100, [](int32_t) { return false; });
  TEST_ASSERT_EQUAL_INT32(100, id);
}

void test_skips_ids_already_in_use() {
  const std::set<int32_t> used = {100, 101, 102};
  const int32_t id = rt::next_free_id(100, [&](int32_t candidate) { return used.count(candidate) > 0; });
  TEST_ASSERT_EQUAL_INT32(103, id);
}

void test_never_looks_below_first() {
  // A shipped id below `first` being in use must not influence the search -
  // the two ranges are disjoint by construction.
  const int32_t id = rt::next_free_id(100, [](int32_t candidate) { return candidate == 50; });
  TEST_ASSERT_EQUAL_INT32(100, id);
}

// --- would_shadow_shipped ----------------------------------------------------

void test_an_upload_over_a_shipped_entry_shadows_it() {
  TEST_ASSERT_TRUE(rt::would_shadow_shipped(/*existing_readonly=*/true, /*incoming_readonly=*/false));
}

void test_a_shipped_entry_loaded_first_is_not_a_shadow() {
  // Nothing loaded yet at this id: there is no existing entry to shadow.
  // (Modeled by the caller never invoking this for an empty slot; included
  // here as the two cases that are not a collision.)
  TEST_ASSERT_FALSE(rt::would_shadow_shipped(/*existing_readonly=*/false, /*incoming_readonly=*/false));
  TEST_ASSERT_FALSE(rt::would_shadow_shipped(/*existing_readonly=*/false, /*incoming_readonly=*/true));
}

void test_two_shipped_entries_are_not_a_shadow() {
  // Cannot happen through the real loaders (one shipped dir), but the
  // predicate itself only fires on read-only-then-writable.
  TEST_ASSERT_FALSE(rt::would_shadow_shipped(/*existing_readonly=*/true, /*incoming_readonly=*/true));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_below_first_upload_id_is_shipped);
  RUN_TEST(test_at_or_past_first_upload_id_is_not_shipped);

  RUN_TEST(test_first_upload_takes_the_first_id);
  RUN_TEST(test_skips_ids_already_in_use);
  RUN_TEST(test_never_looks_below_first);

  RUN_TEST(test_an_upload_over_a_shipped_entry_shadows_it);
  RUN_TEST(test_a_shipped_entry_loaded_first_is_not_a_shadow);
  RUN_TEST(test_two_shipped_entries_are_not_a_shadow);
  return UNITY_END();
}
