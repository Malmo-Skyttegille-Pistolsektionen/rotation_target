#include "ima_adpcm.h"

namespace rt {
namespace {

// The IMA/DVI tables. Not derived: they *are* the format, and a generated
// approximation is a different codec that mostly works. Kept in lock-step with
// firmware/tools/wav_to_adpcm.py, which encodes against the same two.
const int16_t kStepTable[89] = {
    7,     8,     9,     10,    11,    12,    13,    14,    16,    17,    19,    21,    23,
    25,    28,    31,    34,    37,    41,    45,    50,    55,    60,    66,    73,    80,
    88,    97,    107,   118,   130,   143,   157,   173,   190,   209,   230,   253,   279,
    307,   337,   371,   408,   449,   494,   544,   598,   658,   724,   796,   876,   963,
    1060,  1166,  1282,  1411,  1552,  1707,  1878,  2066,  2272,  2499,  2749,  3024,  3327,
    3660,  4026,  4428,  4871,  5358,  5894,  6484,  7132,  7845,  8630,  9493,  10442, 11487,
    12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
};

const int8_t kIndexTable[16] = {-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8};

int16_t clamp16(int32_t value) {
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return static_cast<int16_t>(value);
}

}  // namespace

size_t decode_ima_adpcm_block(const uint8_t *block, size_t block_bytes, int16_t *out,
                              size_t out_capacity) {
  if (block == nullptr || out == nullptr || block_bytes < kImaAdpcmHeaderBytes) return 0;

  int32_t predictor = static_cast<int16_t>(static_cast<uint16_t>(block[0]) |
                                           (static_cast<uint16_t>(block[1]) << 8));
  // A file claiming an index past the table would read off the end of it. The
  // block is decodable either way - the step is simply wrong for one sample -
  // so this clamps rather than refusing the clip.
  uint8_t index = block[2] > kImaAdpcmMaxIndex ? kImaAdpcmMaxIndex : block[2];

  size_t written = 0;
  // The header sample is stored verbatim: it is the predictor everything after
  // it is coded against, so it costs two bytes and is exact.
  if (out_capacity == 0) return 0;
  out[written++] = static_cast<int16_t>(predictor);

  for (size_t i = kImaAdpcmHeaderBytes; i < block_bytes && written < out_capacity; i++) {
    // Low nibble first: the earlier sample of the pair is in the low half.
    for (int half = 0; half < 2 && written < out_capacity; half++) {
      const uint8_t code = half == 0 ? (block[i] & 0x0F) : (block[i] >> 4);

      const int32_t step = kStepTable[index];
      // ((2n+1) * step) / 8, in one multiply. The specification writes this out
      // as four separately-shifted terms (step/8 + step + step/2 + step/4,
      // selected by the code bits), which is algebraically the same and *not*
      // numerically the same: each term truncates on its own, so the two forms
      // disagree by a count or two on some codes. This is the form ffmpeg
      // decodes with, and the one host_test/test_ima_adpcm pins against it, so
      // a clip transcoded here plays identically everywhere else.
      // tools/wav_to_adpcm.py updates its predictor with the same expression
      // for the same reason: an encoder whose idea of the reconstruction
      // differs from the decoder's drifts over a block.
      const int32_t delta = ((2 * (code & 7) + 1) * step) >> 3;

      predictor = (code & 8) ? predictor - delta : predictor + delta;
      predictor = clamp16(predictor);
      out[written++] = static_cast<int16_t>(predictor);

      const int32_t next = static_cast<int32_t>(index) + kIndexTable[code];
      index = static_cast<uint8_t>(next < 0 ? 0 : (next > kImaAdpcmMaxIndex ? kImaAdpcmMaxIndex : next));
    }
  }
  return written;
}

}  // namespace rt
