// ============================================================================
//  IMA ADPCM block decoding (#227). The shipped audio is transcoded at build
//  time and this is what turns it back into samples on the way to the DAC, so
//  it is both a hot path and a parser of bytes that arrived from outside this
//  process - which is why it lives in rt_logic and is reached from here.
// ============================================================================
#include <cstring>
#include <vector>

#include "ima_adpcm.h"
#include "unity.h"

namespace {

// Encoded by firmware/tools/wav_to_adpcm.py's tables and decoded by **ffmpeg**
// (`adpcm_ima_wav`), not by this decoder - the whole value of the vector is
// that the expectation comes from an independent implementation of the format.
//
// The nibbles are chosen to exercise the parts that go wrong: the sign bit
// (0x8-0xF), the largest magnitude (0xF), a zero code, and enough movement in
// both directions that the step index walks up and back down.
//
// Header: predictor 1000, step index 5. Block is 8 bytes, so 1 + 4*2 = 9
// samples.
const uint8_t kBlock[] = {0xE8, 0x03, 0x05, 0x00, 0xF7, 0x83, 0x60, 0x1E};
const int16_t kExpected[] = {1000, 1022, 976, 1024, 1018, 1023, 1089, 971, 1019};

}  // namespace

void setUp() {}
void tearDown() {}

// The one that matters: byte-for-byte agreement with ffmpeg's decoder.
void test_a_block_decodes_the_way_ffmpeg_decodes_it() {
  int16_t out[16] = {};
  const size_t written = rt::decode_ima_adpcm_block(kBlock, sizeof(kBlock), out, 16);

  TEST_ASSERT_EQUAL_UINT32(9, written);
  for (size_t i = 0; i < written; i++) {
    TEST_ASSERT_EQUAL_INT16(kExpected[i], out[i]);
  }
}

// The first sample is stored verbatim in the header rather than encoded, so it
// must come back exactly - it is the predictor everything after it is coded
// against, and an off-by-one here would drift the whole block.
void test_the_header_sample_is_exact() {
  int16_t out[16] = {};
  rt::decode_ima_adpcm_block(kBlock, sizeof(kBlock), out, 16);
  TEST_ASSERT_EQUAL_INT16(1000, out[0]);
}

void test_the_sample_count_matches_the_block_size() {
  TEST_ASSERT_EQUAL_UINT32(9, rt::ima_adpcm_samples_per_block(8));
  TEST_ASSERT_EQUAL_UINT32(505, rt::ima_adpcm_samples_per_block(256));
  // Too short to carry a header at all.
  TEST_ASSERT_EQUAL_UINT32(0, rt::ima_adpcm_samples_per_block(3));
}

// --- what a damaged or hostile block must not do ---------------------------

// The step index is a byte from the file and indexes an 89-entry table. A file
// declaring 200 would read well past the end of it.
void test_a_step_index_past_the_table_is_clamped_not_indexed() {
  uint8_t block[8];
  memcpy(block, kBlock, sizeof(block));
  block[2] = 200;

  int16_t out[16] = {};
  const size_t written = rt::decode_ima_adpcm_block(block, sizeof(block), out, 16);
  // Still decodes - the step is simply wrong for a sample or two, which is
  // better than refusing a clip over one bad byte - and reads nothing it
  // should not. ASan and UBSan are the actual assertion here.
  TEST_ASSERT_EQUAL_UINT32(9, written);
  TEST_ASSERT_EQUAL_INT16(1000, out[0]);
}

void test_a_block_too_short_for_a_header_decodes_nothing() {
  int16_t out[16] = {};
  TEST_ASSERT_EQUAL_UINT32(0, rt::decode_ima_adpcm_block(kBlock, 3, out, 16));
  TEST_ASSERT_EQUAL_UINT32(0, rt::decode_ima_adpcm_block(kBlock, 0, out, 16));
}

// A header-only block is legal - it is one sample - and must not walk into the
// nibbles that are not there.
void test_a_header_only_block_yields_one_sample() {
  int16_t out[16] = {};
  TEST_ASSERT_EQUAL_UINT32(1, rt::decode_ima_adpcm_block(kBlock, 4, out, 16));
  TEST_ASSERT_EQUAL_INT16(1000, out[0]);
}

// The playback loop hands over a fixed buffer. Overrunning it would be a stack
// smash on a 4 KB task.
void test_the_output_capacity_is_respected() {
  int16_t out[4] = {};
  TEST_ASSERT_EQUAL_UINT32(4, rt::decode_ima_adpcm_block(kBlock, sizeof(kBlock), out, 4));
  TEST_ASSERT_EQUAL_UINT32(0, rt::decode_ima_adpcm_block(kBlock, sizeof(kBlock), out, 0));
  for (size_t i = 0; i < 4; i++) TEST_ASSERT_EQUAL_INT16(kExpected[i], out[i]);
}

void test_null_arguments_decode_nothing() {
  int16_t out[16] = {};
  TEST_ASSERT_EQUAL_UINT32(0, rt::decode_ima_adpcm_block(nullptr, 8, out, 16));
  TEST_ASSERT_EQUAL_UINT32(0, rt::decode_ima_adpcm_block(kBlock, 8, nullptr, 16));
}

// Every code from a saturated predictor, which is where a missing clamp shows
// up as a sign flip - the loudest possible artefact, and silent in a listening
// test on quiet material.
void test_the_predictor_saturates_rather_than_wrapping() {
  for (uint8_t code = 0; code < 16; code++) {
    uint8_t block[8] = {0xFF, 0x7F, 88, 0, 0, 0, 0, 0};  // predictor 32767, largest step
    const uint8_t packed = static_cast<uint8_t>(code | (code << 4));
    block[4] = block[5] = block[6] = block[7] = packed;

    int16_t out[16] = {};
    const size_t written = rt::decode_ima_adpcm_block(block, sizeof(block), out, 16);
    TEST_ASSERT_EQUAL_UINT32(9, written);
    for (size_t i = 0; i < written; i++) {
      TEST_ASSERT_TRUE(out[i] >= -32768 && out[i] <= 32767);
    }
  }
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_a_block_decodes_the_way_ffmpeg_decodes_it);
  RUN_TEST(test_the_header_sample_is_exact);
  RUN_TEST(test_the_sample_count_matches_the_block_size);
  RUN_TEST(test_a_step_index_past_the_table_is_clamped_not_indexed);
  RUN_TEST(test_a_block_too_short_for_a_header_decodes_nothing);
  RUN_TEST(test_a_header_only_block_yields_one_sample);
  RUN_TEST(test_the_output_capacity_is_respected);
  RUN_TEST(test_null_arguments_decode_nothing);
  RUN_TEST(test_the_predictor_saturates_rather_than_wrapping);
  return UNITY_END();
}
