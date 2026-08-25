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

#include "ima_adpcm.h"

namespace rt {

// Ceiling on nBlockAlign. The player decodes a whole block at a time into a
// fixed buffer sized from this, so a file may not declare a block larger than
// the buffer - and 512 is already twice what tools/wav_to_adpcm.py emits. The
// number is here rather than in main/ because it is what makes an oversized
// declaration a *parse* failure instead of an overrun two layers down.
constexpr uint16_t kMaxAdpcmBlockBytes = 512;

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

// Which of the two encodings a playable WAV carries.
//
// Uploaded clips are plain PCM - a browser hands over whatever the club
// recorded, and transcoding an upload is out of scope. The *shipped* set is
// IMA ADPCM, transcoded at build time so that firmware, web app and audio fit
// one OTA-updatable image (#227). So the player has to handle both, and which
// one a file is is a property of the file rather than of where it came from.
enum class WavFormat {
  kPcm16,
  kImaAdpcm,
};

// A WAV this firmware can play: 16-bit PCM (mono or stereo), or mono IMA
// ADPCM.
struct WavInfo {
  WavFormat format = WavFormat::kPcm16;
  uint32_t sample_rate = 0;
  uint16_t channels = 0;
  uint64_t data_offset = 0;  // byte offset of the samples
  uint64_t data_bytes = 0;   // clamped to what the file actually holds

  // ADPCM only. `block_bytes` is nBlockAlign: one self-contained block, which
  // is the unit the decoder works in.
  uint16_t block_bytes = 0;
  // From the `fact` chunk, which is where the padding in the final block is
  // undone - a block is a fixed size whether or not the clip ends on one.
  // Zero when the file carries no `fact`, meaning "play every decoded sample".
  uint32_t total_samples = 0;
};

// Upper bound on chunks walked before giving up. A valid WAV has a handful;
// anything pathological is refused rather than walked to the end of the file.
constexpr int kMaxWavChunks = 64;

// Parses and validates the header. False for anything that is neither
// PCM/16-bit/1-2ch nor mono IMA ADPCM, and for anything truncated or
// malformed.
bool parse_wav_header(ByteSource &src, WavInfo &out);

}  // namespace rt
