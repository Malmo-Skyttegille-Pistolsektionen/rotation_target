// ============================================================================
//  RIFF/WAVE header parsing, including the malformed inputs an uploaded file
//  can carry. These could not be written while the parser lived in
//  main/io/audio.cpp behind a FILE*.
// ============================================================================
#include <cstring>
#include <vector>

#include "unity.h"
#include "wav_header.h"

namespace {

// Backs rt::ByteSource with a std::vector, so a test can hand the parser any
// byte sequence at all - including ones no encoder would ever produce.
class MemorySource : public rt::ByteSource {
 public:
  explicit MemorySource(std::vector<uint8_t> bytes) : bytes_(std::move(bytes)) {}

  size_t read_at(uint64_t offset, void *out, size_t len) override {
    if (offset >= bytes_.size()) return 0;
    const size_t available = bytes_.size() - static_cast<size_t>(offset);
    const size_t n = len < available ? len : available;
    memcpy(out, bytes_.data() + offset, n);
    return n;
  }

  uint64_t size() const override { return bytes_.size(); }

 private:
  std::vector<uint8_t> bytes_;
};

void put_u32(std::vector<uint8_t> &v, uint32_t x) {
  v.push_back(x & 0xff);
  v.push_back((x >> 8) & 0xff);
  v.push_back((x >> 16) & 0xff);
  v.push_back((x >> 24) & 0xff);
}

void put_u16(std::vector<uint8_t> &v, uint16_t x) {
  v.push_back(x & 0xff);
  v.push_back((x >> 8) & 0xff);
}

void put_tag(std::vector<uint8_t> &v, const char *tag) {
  for (int i = 0; i < 4; i++) v.push_back(static_cast<uint8_t>(tag[i]));
}

// A minimal valid PCM WAV, parameterised so each test can break one field.
std::vector<uint8_t> make_wav(uint16_t audio_format = 1, uint16_t channels = 1,
                              uint32_t sample_rate = 16000, uint16_t bits = 16,
                              uint32_t data_bytes = 8) {
  std::vector<uint8_t> v;
  put_tag(v, "RIFF");
  put_u32(v, 0);  // size field is not trusted or used
  put_tag(v, "WAVE");

  put_tag(v, "fmt ");
  put_u32(v, 16);
  put_u16(v, audio_format);
  put_u16(v, channels);
  put_u32(v, sample_rate);
  put_u32(v, sample_rate * channels * bits / 8);
  put_u16(v, static_cast<uint16_t>(channels * bits / 8));
  put_u16(v, bits);

  put_tag(v, "data");
  put_u32(v, data_bytes);
  for (uint32_t i = 0; i < data_bytes; i++) v.push_back(static_cast<uint8_t>(i));
  return v;
}

// An IMA ADPCM WAV as tools/wav_to_adpcm.py emits one: a 20-byte `fmt ` with
// the samples-per-block extension, a `fact` chunk carrying the true sample
// count, then blocks.
std::vector<uint8_t> make_adpcm_wav(uint16_t channels = 1, uint16_t block_align = 256,
                                    uint16_t bits = 4, uint32_t total_samples = 505,
                                    bool with_fact = true) {
  std::vector<uint8_t> v;
  put_tag(v, "RIFF");
  put_u32(v, 0);
  put_tag(v, "WAVE");

  put_tag(v, "fmt ");
  put_u32(v, 20);
  put_u16(v, 0x11);  // IMA ADPCM
  put_u16(v, channels);
  put_u32(v, 24000);
  put_u32(v, 12000);
  put_u16(v, block_align);
  put_u16(v, bits);
  put_u16(v, 2);  // cbSize
  put_u16(v, 505);

  if (with_fact) {
    put_tag(v, "fact");
    put_u32(v, 4);
    put_u32(v, total_samples);
  }

  put_tag(v, "data");
  put_u32(v, block_align);
  for (uint32_t i = 0; i < block_align; i++) v.push_back(static_cast<uint8_t>(i));
  return v;
}

}  // namespace

void setUp() {}
void tearDown() {}

// --- accepted --------------------------------------------------------------

void test_a_minimal_mono_wav_parses() {
  MemorySource src(make_wav());
  rt::WavInfo info;

  TEST_ASSERT_TRUE(rt::parse_wav_header(src, info));
  TEST_ASSERT_EQUAL_UINT32(16000, info.sample_rate);
  TEST_ASSERT_EQUAL_UINT16(1, info.channels);
  TEST_ASSERT_EQUAL_UINT64(44, info.data_offset);
  TEST_ASSERT_EQUAL_UINT64(8, info.data_bytes);
}

void test_stereo_is_accepted() {
  MemorySource src(make_wav(1, 2));
  rt::WavInfo info;

  TEST_ASSERT_TRUE(rt::parse_wav_header(src, info));
  TEST_ASSERT_EQUAL_UINT16(2, info.channels);
}

void test_a_chunk_before_data_is_skipped() {
  // The shipped clips come from a TTS pipeline that emits LIST/INFO before
  // `data`; a fixed 44-byte skip would play that metadata as samples.
  std::vector<uint8_t> v;
  put_tag(v, "RIFF");
  put_u32(v, 0);
  put_tag(v, "WAVE");
  put_tag(v, "LIST");
  put_u32(v, 4);
  put_tag(v, "INFO");

  const std::vector<uint8_t> tail = make_wav();
  v.insert(v.end(), tail.begin() + 12, tail.end());

  MemorySource src(v);
  rt::WavInfo info;
  TEST_ASSERT_TRUE(rt::parse_wav_header(src, info));
  TEST_ASSERT_EQUAL_UINT32(16000, info.sample_rate);
}

void test_an_odd_sized_chunk_is_word_aligned() {
  std::vector<uint8_t> v;
  put_tag(v, "RIFF");
  put_u32(v, 0);
  put_tag(v, "WAVE");
  put_tag(v, "junk");
  put_u32(v, 3);
  v.push_back(1);
  v.push_back(2);
  v.push_back(3);
  v.push_back(0);  // pad byte, not counted in the declared size

  const std::vector<uint8_t> tail = make_wav();
  v.insert(v.end(), tail.begin() + 12, tail.end());

  MemorySource src(v);
  rt::WavInfo info;
  TEST_ASSERT_TRUE(rt::parse_wav_header(src, info));
}

// --- refused ---------------------------------------------------------------

void test_a_backwards_chunk_size_is_refused_and_terminates() {
  // The regression this parser was rewritten for: 0xFFFFFFF8 cast to a 32-bit
  // signed offset is -8, which seeked back onto the header just consumed and
  // spun forever. With unsigned absolute offsets it cannot be expressed.
  std::vector<uint8_t> v;
  put_tag(v, "RIFF");
  put_u32(v, 0);
  put_tag(v, "WAVE");
  put_tag(v, "junk");
  put_u32(v, 0xFFFFFFF8);
  for (int i = 0; i < 16; i++) v.push_back(0);

  MemorySource src(v);
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_a_chunk_size_past_the_end_is_refused() {
  std::vector<uint8_t> v;
  put_tag(v, "RIFF");
  put_u32(v, 0);
  put_tag(v, "WAVE");
  put_tag(v, "junk");
  put_u32(v, 0x7FFFFFFF);
  for (int i = 0; i < 16; i++) v.push_back(0);

  MemorySource src(v);
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_a_wall_of_empty_chunks_terminates() {
  // Bounded by kMaxWavChunks rather than walked to the end of the file.
  std::vector<uint8_t> v;
  put_tag(v, "RIFF");
  put_u32(v, 0);
  put_tag(v, "WAVE");
  for (int i = 0; i < 500; i++) {
    put_tag(v, "junk");
    put_u32(v, 0);
  }

  MemorySource src(v);
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_non_riff_is_refused() {
  std::vector<uint8_t> v(64, 0);
  MemorySource src(v);
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_an_empty_file_is_refused() {
  MemorySource src({});
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_a_truncated_header_is_refused() {
  std::vector<uint8_t> v = make_wav();
  v.resize(20);
  MemorySource src(v);
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_non_pcm_is_refused() {
  MemorySource src(make_wav(3));  // IEEE float
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

// --- IMA ADPCM (#227) ------------------------------------------------------
//
// The shipped clips are transcoded at build time; uploaded ones stay PCM. So
// both formats reach the same player and which one a file is has to come out
// of the header rather than out of where the file was found.

void test_an_ima_adpcm_wav_parses() {
  MemorySource src(make_adpcm_wav());
  rt::WavInfo info;

  TEST_ASSERT_TRUE(rt::parse_wav_header(src, info));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::WavFormat::kImaAdpcm), static_cast<int>(info.format));
  TEST_ASSERT_EQUAL_UINT16(256, info.block_bytes);
  TEST_ASSERT_EQUAL_UINT32(505, info.total_samples);
  TEST_ASSERT_EQUAL_UINT32(24000, info.sample_rate);
}

void test_pcm_still_reports_itself_as_pcm() {
  MemorySource src(make_wav());
  rt::WavInfo info;
  TEST_ASSERT_TRUE(rt::parse_wav_header(src, info));
  TEST_ASSERT_EQUAL(static_cast<int>(rt::WavFormat::kPcm16), static_cast<int>(info.format));
}

// `fact` is where the padding in the final block is undone. Optional, because
// a file without one still plays - it just plays the padding too.
void test_a_missing_fact_chunk_leaves_the_sample_count_unknown() {
  MemorySource src(make_adpcm_wav(1, 256, 4, 0, false));
  rt::WavInfo info;
  TEST_ASSERT_TRUE(rt::parse_wav_header(src, info));
  TEST_ASSERT_EQUAL_UINT32(0, info.total_samples);
}

// The player decodes a whole block into a fixed buffer, so an oversized
// declaration has to be refused here rather than overrun two layers down.
void test_an_oversized_block_is_refused() {
  MemorySource src(make_adpcm_wav(1, rt::kMaxAdpcmBlockBytes + 1));
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

// A block that cannot even hold its own header.
void test_a_block_smaller_than_a_header_is_refused() {
  for (uint16_t block : {static_cast<uint16_t>(0), static_cast<uint16_t>(4)}) {
    MemorySource src(make_adpcm_wav(1, block));
    rt::WavInfo info;
    TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
  }
}

// Stereo IMA ADPCM interleaves the channels four bytes at a time. Nothing here
// produces it, and half-decoding it would be noise at full volume on a range.
void test_stereo_ima_adpcm_is_refused() {
  MemorySource src(make_adpcm_wav(2));
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

// 0x11 is only ADPCM at 4 bits. Anything else claiming that tag is malformed.
void test_ima_adpcm_at_other_bit_depths_is_refused() {
  MemorySource src(make_adpcm_wav(1, 256, 16));
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_eight_bit_is_refused() {
  MemorySource src(make_wav(1, 1, 16000, 8));
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_more_than_two_channels_is_refused() {
  MemorySource src(make_wav(1, 6));
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_a_zero_sample_rate_is_refused() {
  // Would divide by zero in the I2S clock config downstream.
  MemorySource src(make_wav(1, 1, 0));
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_data_before_fmt_is_refused() {
  std::vector<uint8_t> v;
  put_tag(v, "RIFF");
  put_u32(v, 0);
  put_tag(v, "WAVE");
  put_tag(v, "data");
  put_u32(v, 4);
  for (int i = 0; i < 4; i++) v.push_back(0);

  MemorySource src(v);
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_an_empty_data_chunk_is_refused() {
  MemorySource src(make_wav(1, 1, 16000, 16, 0));
  rt::WavInfo info;
  TEST_ASSERT_FALSE(rt::parse_wav_header(src, info));
}

void test_a_truncated_data_chunk_is_clamped_to_the_file() {
  // Declares 8 bytes of samples but carries 4. Trusting the declared length
  // would read past the end of the file during playback.
  std::vector<uint8_t> v = make_wav(1, 1, 16000, 16, 8);
  v.resize(v.size() - 4);

  MemorySource src(v);
  rt::WavInfo info;
  TEST_ASSERT_TRUE(rt::parse_wav_header(src, info));
  TEST_ASSERT_EQUAL_UINT64(4, info.data_bytes);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_a_minimal_mono_wav_parses);
  RUN_TEST(test_stereo_is_accepted);
  RUN_TEST(test_a_chunk_before_data_is_skipped);
  RUN_TEST(test_an_odd_sized_chunk_is_word_aligned);

  RUN_TEST(test_a_backwards_chunk_size_is_refused_and_terminates);
  RUN_TEST(test_a_chunk_size_past_the_end_is_refused);
  RUN_TEST(test_a_wall_of_empty_chunks_terminates);
  RUN_TEST(test_non_riff_is_refused);
  RUN_TEST(test_an_empty_file_is_refused);
  RUN_TEST(test_a_truncated_header_is_refused);
  RUN_TEST(test_non_pcm_is_refused);
  RUN_TEST(test_an_ima_adpcm_wav_parses);
  RUN_TEST(test_pcm_still_reports_itself_as_pcm);
  RUN_TEST(test_a_missing_fact_chunk_leaves_the_sample_count_unknown);
  RUN_TEST(test_an_oversized_block_is_refused);
  RUN_TEST(test_a_block_smaller_than_a_header_is_refused);
  RUN_TEST(test_stereo_ima_adpcm_is_refused);
  RUN_TEST(test_ima_adpcm_at_other_bit_depths_is_refused);
  RUN_TEST(test_eight_bit_is_refused);
  RUN_TEST(test_more_than_two_channels_is_refused);
  RUN_TEST(test_a_zero_sample_rate_is_refused);
  RUN_TEST(test_data_before_fmt_is_refused);
  RUN_TEST(test_an_empty_data_chunk_is_refused);
  RUN_TEST(test_a_truncated_data_chunk_is_clamped_to_the_file);
  return UNITY_END();
}
