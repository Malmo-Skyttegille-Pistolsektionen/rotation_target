// ============================================================================
//  The three-part split `GET /api/v2/version` reports. It parses a string the
//  build put in the image, so it lives in rt_logic and is tested here rather
//  than inside an HTTP route handler where nothing could reach it.
// ============================================================================
#include "unity.h"
#include "version.h"

namespace {

rt::SemVer parsed(const char *describe) {
  rt::SemVer out;
  rt::parse_semver(describe, out);
  return out;
}

bool accepts(const char *describe) {
  rt::SemVer out;
  return rt::parse_semver(describe, out);
}

}  // namespace

void setUp() {}
void tearDown() {}

void test_a_release_tag_parses() {
  const rt::SemVer v = parsed("2.0.0");
  TEST_ASSERT_EQUAL_UINT32(2, v.major);
  TEST_ASSERT_EQUAL_UINT32(0, v.minor);
  TEST_ASSERT_EQUAL_UINT32(0, v.patch);
}

// What an ordinary development build reports: a tag, commits since, and the
// abbreviated hash. The three numbers in front are the version.
void test_a_describe_suffix_is_a_version() {
  TEST_ASSERT_TRUE(accepts("2.0.0-3-gab12cde"));
  const rt::SemVer v = parsed("10.20.30-3-gab12cde");
  TEST_ASSERT_EQUAL_UINT32(10, v.major);
  TEST_ASSERT_EQUAL_UINT32(20, v.minor);
  TEST_ASSERT_EQUAL_UINT32(30, v.patch);
}

void test_build_metadata_is_a_version() {
  TEST_ASSERT_TRUE(accepts("1.2.3+meta"));
}

void test_a_dirty_tag_parses() {
  TEST_ASSERT_TRUE(accepts("2.0.0-dirty"));
}

// The regression the strictness exists for: `git describe --always` falls back
// to a bare hash on an untagged build, and a looser parse read `9f7c98d` as
// major=9 - so the device reported 9.0.0, a version that never existed.
void test_a_bare_commit_hash_is_not_a_version() {
  TEST_ASSERT_FALSE(accepts("9f7c98d"));
  TEST_ASSERT_FALSE(accepts("ab12cde"));
  TEST_ASSERT_FALSE(accepts("1234567"));
}

void test_a_partial_version_is_refused() {
  TEST_ASSERT_FALSE(accepts("2"));
  TEST_ASSERT_FALSE(accepts("2.0"));
  TEST_ASSERT_FALSE(accepts("2.0."));
  TEST_ASSERT_FALSE(accepts(".2.0"));
  TEST_ASSERT_FALSE(accepts(""));
}

// Starts like a version and is not one.
void test_a_fourth_field_or_a_letter_is_refused() {
  TEST_ASSERT_FALSE(accepts("2.0.0.1"));
  TEST_ASSERT_FALSE(accepts("2.0.0rc1"));
  TEST_ASSERT_FALSE(accepts("v2.0.0"));
}

// The reason cert-err34-c objected to the sscanf this replaced: `%u` cannot
// report a conversion error, so a field of enough digits wrapped silently and
// the device reported whatever it wrapped to.
void test_a_field_too_large_for_the_type_is_refused_rather_than_wrapped() {
  TEST_ASSERT_FALSE(accepts("4294967296.0.0"));
  TEST_ASSERT_FALSE(accepts("0.99999999999999999999.0"));
  // The largest value that does fit still parses.
  const rt::SemVer v = parsed("4294967295.0.0");
  TEST_ASSERT_EQUAL_UINT32(4294967295U, v.major);
}

// A refused parse must leave the caller with 0.0.0 rather than half a version.
void test_a_refused_parse_zeroes_the_output() {
  rt::SemVer out;
  out.major = 9;
  out.minor = 9;
  out.patch = 9;
  TEST_ASSERT_FALSE(rt::parse_semver("2.0.oops", out));
  TEST_ASSERT_EQUAL_UINT32(0, out.major);
  TEST_ASSERT_EQUAL_UINT32(0, out.minor);
  TEST_ASSERT_EQUAL_UINT32(0, out.patch);
}

void test_leading_zeroes_are_read_as_decimal() {
  const rt::SemVer v = parsed("01.02.03");
  TEST_ASSERT_EQUAL_UINT32(1, v.major);
  TEST_ASSERT_EQUAL_UINT32(2, v.minor);
  TEST_ASSERT_EQUAL_UINT32(3, v.patch);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_a_release_tag_parses);
  RUN_TEST(test_a_describe_suffix_is_a_version);
  RUN_TEST(test_build_metadata_is_a_version);
  RUN_TEST(test_a_dirty_tag_parses);
  RUN_TEST(test_a_bare_commit_hash_is_not_a_version);
  RUN_TEST(test_a_partial_version_is_refused);
  RUN_TEST(test_a_fourth_field_or_a_letter_is_refused);
  RUN_TEST(test_a_field_too_large_for_the_type_is_refused_rather_than_wrapped);
  RUN_TEST(test_a_refused_parse_zeroes_the_output);
  RUN_TEST(test_leading_zeroes_are_read_as_decimal);
  return UNITY_END();
}
