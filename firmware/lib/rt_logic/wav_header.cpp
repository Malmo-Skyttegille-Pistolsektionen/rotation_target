#include "wav_header.h"

#include <cstring>

namespace rt {
namespace {

uint32_t read_le(const uint8_t *p, size_t bytes) {
  uint32_t v = 0;
  for (size_t i = 0; i < bytes; i++) v |= static_cast<uint32_t>(p[i]) << (8 * i);
  return v;
}

}  // namespace

bool parse_wav_header(ByteSource &src, WavInfo &out) {
  const uint64_t file_size = src.size();

  uint8_t riff[12];
  if (src.read_at(0, riff, sizeof(riff)) != sizeof(riff)) return false;
  if (memcmp(riff, "RIFF", 4) != 0 || memcmp(riff + 8, "WAVE", 4) != 0) return false;

  bool have_fmt = false;
  uint64_t cursor = sizeof(riff);

  // Walks the chunk list rather than assuming a 44-byte header: the shipped
  // clips come from a TTS pipeline that emits a LIST/INFO chunk before `data`,
  // and a fixed skip would play that metadata as samples.
  for (int walked = 0; walked < kMaxWavChunks; walked++) {
    uint8_t header[8];
    if (src.read_at(cursor, header, sizeof(header)) != sizeof(header)) return false;
    cursor += sizeof(header);

    const uint32_t size = read_le(header + 4, 4);
    // Chunks are word-aligned; the pad byte is not counted in `size`.
    const uint64_t advance = static_cast<uint64_t>(size) + (size & 1);

    if (memcmp(header, "fmt ", 4) == 0) {
      uint8_t fmt[16];
      if (size < sizeof(fmt)) return false;
      if (src.read_at(cursor, fmt, sizeof(fmt)) != sizeof(fmt)) return false;

      const uint16_t audio_format = static_cast<uint16_t>(read_le(fmt, 2));
      out.channels = static_cast<uint16_t>(read_le(fmt + 2, 2));
      out.sample_rate = read_le(fmt + 4, 4);
      const uint16_t bits = static_cast<uint16_t>(read_le(fmt + 14, 2));

      if (audio_format != 1 || bits != 16) return false;
      if (out.channels != 1 && out.channels != 2) return false;
      // A zero rate would divide by zero in the I2S clock config downstream.
      if (out.sample_rate == 0) return false;
      have_fmt = true;

    } else if (memcmp(header, "data", 4) == 0) {
      if (!have_fmt) return false;
      out.data_offset = cursor;
      // A `data` size larger than the file is truncation, not a reason to read
      // past the end - clamp rather than trust the declared length.
      const uint64_t available = file_size > cursor ? file_size - cursor : 0;
      out.data_bytes = advance > available ? available : size;
      return out.data_bytes > 0;
    }

    // Unsigned throughout, and bounded by the real file size, so the cursor can
    // only ever move forward and can never leave the file.
    if (advance > file_size - cursor) return false;
    cursor += advance;
  }
  return false;
}

}  // namespace rt
