// ============================================================================
//  rt_logic/wav_header.h
//  RIFF/WAVE header parsing - host-testable, no filesystem.
//
//  Uploaded audio is attacker-reachable input, so this lives here rather than
//  in main/io/audio.cpp: it is pure by nature, and being here means it is
//  covered by host_test/test_wav_header and runs under ASan/UBSan in CI.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>

namespace rt {

// Random-access byte source.
//
// Absolute offsets, unsigned, deliberately: the previous relative-`fseek(...,
// SEEK_CUR)` form let a chunk declaring size 0xFFFFFFF8 cast to -8 on a 32-bit
// `long` and seek *backwards* onto the header just consumed, so the parser
// re-read it forever. With absolute uint64_t offsets bounded by size(), a
// backwards or out-of-range seek cannot be expressed.
class ByteSource {
 public:
  virtual ~ByteSource() = default;
  // Returns bytes actually read - a short read is how truncation is detected.
  virtual size_t read_at(uint64_t offset, void *out, size_t len) = 0;
  virtual uint64_t size() const = 0;
};

// A WAV this firmware can play: PCM, 16-bit, mono or stereo.
struct WavInfo {
  uint32_t sample_rate = 0;
  uint16_t channels = 0;
  uint64_t data_offset = 0;  // byte offset of the samples
  uint64_t data_bytes = 0;   // clamped to what the file actually holds
};

// Upper bound on chunks walked before giving up. A valid WAV has a handful;
// anything pathological is refused rather than walked to the end of the file.
constexpr int kMaxWavChunks = 64;

// Parses and validates the header. False for anything not PCM/16-bit/1-2ch,
// truncated, or malformed.
bool parse_wav_header(ByteSource &src, WavInfo &out);

}  // namespace rt
