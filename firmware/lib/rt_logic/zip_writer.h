// ============================================================================
//  rt_logic/zip_writer.h
//  Writing a stored ZIP straight at a socket. Host-testable, no ESP-IDF.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace rt {

// CRC-32 (the ISO 3309 polynomial ZIP requires), a byte at a time with no
// lookup table - 1 KB of rodata is more than this is worth on a part where the
// whole bundle is a rare operation. Seed a fresh stream with 0 and feed the
// result back in to continue one.
uint32_t crc32(uint32_t crc, const uint8_t *data, size_t len);

// A ZIP the device streams rather than builds.
//
// The troubleshooting bundle carries the coredump partition - 128 KB - and
// this device has nothing like that to spare, so nothing here holds the
// payload: bytes go from flash through this to the socket, and all that
// accumulates is one small record per entry for the central directory.
//
// **Stored, never deflated.** A deflate encoder is the only part of this that
// would need real memory, and it would buy little: a coredump is mostly stack
// and compresses poorly. Stored entries are the one thing every unzip
// implementation reads, which is the whole point of choosing ZIP - the
// recipient double-clicks it.
//
// The cost of never seeking backwards is that an entry's CRC and size must be
// known before its local header goes out. The caller therefore reads each
// source twice, once to sum and once to send; on flash that is a few
// milliseconds and no memory at all.
class ZipWriter {
 public:
  // Returns false when the bytes could not be handed on. One failure latches:
  // everything after it is refused too, so a caller checks once at the end
  // rather than at every call.
  using Sink = bool (*)(void *ctx, const uint8_t *data, size_t len);

  ZipWriter(Sink sink, void *ctx) : sink_(sink), ctx_(ctx) {}

  // Opens an entry. `name` is its path inside the archive, `size` and `crc`
  // describe the bytes the caller is about to write. Closing is implicit:
  // the entry ends once `size` bytes have arrived.
  bool begin(const std::string &name, uint32_t size, uint32_t crc);

  // Entry payload. Writing more than the declared size fails rather than
  // producing an archive whose directory disagrees with its contents.
  bool write(const uint8_t *data, size_t len);

  // Central directory and end-of-central-directory record. Fails if an entry
  // is still short of the size it declared. Nothing may be written after.
  bool finish();

  bool ok() const { return ok_; }

 private:
  struct Entry {
    std::string name;
    uint32_t crc;
    uint32_t size;
    uint32_t offset;  // of its local header, which the directory points at
  };

  bool emit(const uint8_t *data, size_t len);

  Sink sink_;
  void *ctx_;
  std::vector<Entry> entries_;
  uint32_t offset_ = 0;
  uint32_t entry_remaining_ = 0;
  bool ok_ = true;
  bool finished_ = false;
};

}  // namespace rt
