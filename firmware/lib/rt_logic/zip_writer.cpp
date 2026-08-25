#include "zip_writer.h"

namespace rt {
namespace {

// PKWARE's four signatures, of which a stored archive needs three.
constexpr uint32_t kLocalSig = 0x04034b50;
constexpr uint32_t kCentralSig = 0x02014b50;
constexpr uint32_t kEndSig = 0x06054b50;

constexpr uint16_t kMethodStored = 0;
// 2.0 is what the format calls "no feature beyond the original": no zip64, no
// encryption, no data descriptor.
constexpr uint16_t kVersion = 20;

// 1980-01-01 00:00, the bottom of the MS-DOS range. This device has no wall
// clock - it never learns the date - so an honest constant beats a timestamp
// derived from uptime, which would claim every bundle was made in 1970 anyway.
// The date that matters is in the filename, put there by the browser.
constexpr uint16_t kDosTime = 0;
constexpr uint16_t kDosDate = 0x0021;

// Everything in a ZIP is little-endian, whatever the machine is.
void put_u16(uint8_t *out, uint16_t value) {
  out[0] = static_cast<uint8_t>(value & 0xFF);
  out[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
}

void put_u32(uint8_t *out, uint32_t value) {
  out[0] = static_cast<uint8_t>(value & 0xFF);
  out[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
  out[2] = static_cast<uint8_t>((value >> 16) & 0xFF);
  out[3] = static_cast<uint8_t>((value >> 24) & 0xFF);
}

constexpr size_t kLocalHeaderBytes = 30;
constexpr size_t kCentralHeaderBytes = 46;
constexpr size_t kEndRecordBytes = 22;

}  // namespace

uint32_t crc32(uint32_t crc, const uint8_t *data, size_t len) {
  if (data == nullptr) return crc;
  crc = ~crc;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int bit = 0; bit < 8; bit++) {
      // The reflected form of the polynomial, which is why this shifts right.
      crc = (crc & 1u) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
    }
  }
  return ~crc;
}

bool ZipWriter::emit(const uint8_t *data, size_t len) {
  if (!ok_) return false;
  if (len > 0 && !sink_(ctx_, data, len)) {
    ok_ = false;
    return false;
  }
  offset_ += static_cast<uint32_t>(len);
  return true;
}

bool ZipWriter::begin(const std::string &name, uint32_t size, uint32_t crc) {
  // A short entry would leave the next local header inside the previous
  // entry's declared payload, i.e. a corrupt archive that unzip reads as a
  // truncated file rather than as the bug it is.
  if (!ok_ || finished_ || entry_remaining_ != 0 || name.empty() || name.size() > 0xFFFF) {
    ok_ = false;
    return false;
  }

  entries_.push_back({name, crc, size, offset_});

  uint8_t header[kLocalHeaderBytes];
  put_u32(header + 0, kLocalSig);
  put_u16(header + 4, kVersion);
  put_u16(header + 6, 0);  // no flags: the name is ASCII and nothing is deferred
  put_u16(header + 8, kMethodStored);
  put_u16(header + 10, kDosTime);
  put_u16(header + 12, kDosDate);
  put_u32(header + 14, crc);
  put_u32(header + 18, size);  // stored, so compressed and uncompressed agree
  put_u32(header + 22, size);
  put_u16(header + 26, static_cast<uint16_t>(name.size()));
  put_u16(header + 28, 0);  // no extra field

  entry_remaining_ = size;
  if (!emit(header, sizeof(header))) return false;
  return emit(reinterpret_cast<const uint8_t *>(name.data()), name.size());
}

bool ZipWriter::write(const uint8_t *data, size_t len) {
  if (!ok_ || finished_ || len > entry_remaining_) {
    ok_ = false;
    return false;
  }
  entry_remaining_ -= static_cast<uint32_t>(len);
  return emit(data, len);
}

bool ZipWriter::finish() {
  if (!ok_ || finished_ || entry_remaining_ != 0) {
    ok_ = false;
    return false;
  }
  finished_ = true;

  const uint32_t directory_offset = offset_;
  for (const Entry &entry : entries_) {
    uint8_t header[kCentralHeaderBytes];
    put_u32(header + 0, kCentralSig);
    put_u16(header + 4, kVersion);
    put_u16(header + 6, kVersion);
    put_u16(header + 8, 0);
    put_u16(header + 10, kMethodStored);
    put_u16(header + 12, kDosTime);
    put_u16(header + 14, kDosDate);
    put_u32(header + 16, entry.crc);
    put_u32(header + 20, entry.size);
    put_u32(header + 24, entry.size);
    put_u16(header + 28, static_cast<uint16_t>(entry.name.size()));
    put_u16(header + 30, 0);  // extra
    put_u16(header + 32, 0);  // comment
    put_u16(header + 34, 0);  // disk the entry starts on
    put_u16(header + 36, 0);  // internal attributes
    put_u32(header + 38, 0);  // external attributes: no unix mode to report
    put_u32(header + 42, entry.offset);

    if (!emit(header, sizeof(header))) return false;
    if (!emit(reinterpret_cast<const uint8_t *>(entry.name.data()), entry.name.size())) {
      return false;
    }
  }

  uint8_t end[kEndRecordBytes];
  put_u32(end + 0, kEndSig);
  put_u16(end + 4, 0);  // this disk
  put_u16(end + 6, 0);  // the disk the directory starts on
  put_u16(end + 8, static_cast<uint16_t>(entries_.size()));
  put_u16(end + 10, static_cast<uint16_t>(entries_.size()));
  put_u32(end + 12, offset_ - directory_offset);
  put_u32(end + 16, directory_offset);
  put_u16(end + 20, 0);  // no archive comment

  return emit(end, sizeof(end));
}

}  // namespace rt
