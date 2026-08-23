// ============================================================================
//  Whether a firmware image may be accepted (#127). Two of the three refusals
//  are safety rules, not plumbing - and a safety rule that only exists inside
//  an HTTP handler is one nobody can test.
// ============================================================================
#include "ota_policy.h"
#include "unity.h"

using rt::ota::Refusal;

void setUp() {}
void tearDown() {}

// --- starting an upload ----------------------------------------------------

void test_an_idle_device_accepts_an_upload() {
  TEST_ASSERT_EQUAL(Refusal::kNone, rt::ota::check_start(false));
}

void test_a_running_program_refuses_the_upload() {
  // Not "stop it for them". The targets are mid-sequence and somebody may be
  // downrange acting on what the sequence is doing; rebooting into a new image
  // underneath that is not the device's decision to make.
  TEST_ASSERT_EQUAL(Refusal::kProgramRunning, rt::ota::check_start(true));
}

// --- the image itself ------------------------------------------------------

void test_a_matching_project_is_accepted() {
  TEST_ASSERT_EQUAL(Refusal::kNone, rt::ota::check_image("rotation_target_backend",
                                                         "rotation_target_backend", 900000));
}

void test_a_foreign_image_is_refused() {
  // Secure boot is off, so this is the only thing between an admin session and
  // arbitrary firmware.
  TEST_ASSERT_EQUAL(Refusal::kProjectMismatch,
                    rt::ota::check_image("AutoLee", "rotation_target_backend", 900000));
}

void test_a_truncated_project_name_does_not_match_by_prefix() {
  // strncmp over the header's fixed width, not strcmp: a name that merely
  // starts the same is a different project.
  TEST_ASSERT_EQUAL(Refusal::kProjectMismatch,
                    rt::ota::check_image("rotation_target", "rotation_target_backend", 900000));
}

void test_an_unterminated_name_is_read_within_the_header_width() {
  // esp_app_desc_t::project_name is a fixed char[32] and need not be
  // terminated. Reading it as a C string would run off the end.
  char image[32];
  char running[32];
  for (int i = 0; i < 32; i++) {
    image[i] = 'a';
    running[i] = 'a';
  }
  TEST_ASSERT_EQUAL(Refusal::kNone, rt::ota::check_image(image, running, 900000));
}

void test_an_empty_upload_is_refused() {
  TEST_ASSERT_EQUAL(Refusal::kEmptyImage,
                    rt::ota::check_image("rotation_target_backend", "rotation_target_backend", 0));
}

void test_something_smaller_than_a_header_is_refused() {
  // An esp_app_desc_t alone is 256 bytes; anything at or under that cannot be
  // an image, whatever its header claims.
  TEST_ASSERT_EQUAL(Refusal::kEmptyImage, rt::ota::check_image("rotation_target_backend",
                                                               "rotation_target_backend", 256));
}

void test_a_null_description_is_refused_rather_than_dereferenced() {
  TEST_ASSERT_EQUAL(Refusal::kProjectMismatch,
                    rt::ota::check_image(nullptr, "rotation_target_backend", 900000));
}

// --- what the client is told ----------------------------------------------

void test_every_refusal_has_a_sentence() {
  TEST_ASSERT_EQUAL_STRING("", rt::ota::message(Refusal::kNone));
  TEST_ASSERT_TRUE(rt::ota::message(Refusal::kProgramRunning)[0] != '\0');
  TEST_ASSERT_TRUE(rt::ota::message(Refusal::kProjectMismatch)[0] != '\0');
  TEST_ASSERT_TRUE(rt::ota::message(Refusal::kEmptyImage)[0] != '\0');
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_an_idle_device_accepts_an_upload);
  RUN_TEST(test_a_running_program_refuses_the_upload);
  RUN_TEST(test_a_matching_project_is_accepted);
  RUN_TEST(test_a_foreign_image_is_refused);
  RUN_TEST(test_a_truncated_project_name_does_not_match_by_prefix);
  RUN_TEST(test_an_unterminated_name_is_read_within_the_header_width);
  RUN_TEST(test_an_empty_upload_is_refused);
  RUN_TEST(test_something_smaller_than_a_header_is_refused);
  RUN_TEST(test_a_null_description_is_refused_rather_than_dereferenced);
  RUN_TEST(test_every_refusal_has_a_sentence);
  return UNITY_END();
}
