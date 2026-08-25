// ============================================================================
//  rt_logic/ima_adpcm.h
//  IMA ADPCM block decoding - host-testable, no filesystem, no I2S.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>

namespace rt {

// The shipped audio is transcoded to IMA ADPCM at build time and decoded here
// on the way to the DAC (#227). 3.9x smaller on the measured corpus, which is
// what lets firmware, web app and audio share one OTA-updatable image.
//
// ADPCM rather than Opus or MP3 because size was never the binding constraint -
// latency was. These are spoken range commands: they tell a shooter when to
// fire. ADPCM adds no algorithmic delay and no library; Opus would cost 26 ms,
// ~200 KB and a fixed output rate.
//
// In rt_logic rather than main/io/audio.cpp for the reason every parser here
// is: this turns outside bytes into meaning, so it belongs where a host test
// and a sanitizer can reach it. Behind a FILE* in an anonymous namespace,
// nothing would ever have exercised a malformed block.

// Bytes of block header before the encoded nibbles: the initial predictor
// (int16 LE), the step index, and one reserved byte.
constexpr size_t kImaAdpcmHeaderBytes = 4;

// Highest valid step-table index. A block header carrying anything above this
// is malformed; the decoder clamps rather than indexing out of bounds.
constexpr uint8_t kImaAdpcmMaxIndex = 88;

// How many samples a block of `block_bytes` holds, for a mono stream. The
// header sample is stored verbatim and each remaining byte carries two.
constexpr size_t ima_adpcm_samples_per_block(size_t block_bytes) {
  return block_bytes < kImaAdpcmHeaderBytes ? 0 : 1 + (block_bytes - kImaAdpcmHeaderBytes) * 2;
}

// Decodes one mono block into 16-bit samples. Returns how many were written,
// which is 0 for a block too short to carry a header.
//
// Each block restarts from its own predictor and step index, so a damaged
// block costs one block rather than the rest of the clip - the reason the
// format is block-based, and the reason nothing here carries state between
// calls.
size_t decode_ima_adpcm_block(const uint8_t *block, size_t block_bytes, int16_t *out,
                              size_t out_capacity);

}  // namespace rt
