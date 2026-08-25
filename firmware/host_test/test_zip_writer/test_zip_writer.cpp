// ============================================================================
//  The stored-ZIP writer behind the troubleshooting bundle (#201).
//
//  The bundle is the one thing this device produces that is opened by somebody
//  who is not holding it - a club member forwards it - so "unzip reads this"
//  is the whole requirement. Nothing on the device ever reads one back, which
//  means a mistake here is invisible until it is in somebody's Downloads
//  folder; hence the byte-level assertions below rather than a round trip.
//
//  The layout asserted here was checked against Python's `zipfile` and against
//  `unzip -t` on archives this writer produced, which is where the confidence
//  that the offsets are the format's and not merely self-consistent comes
//  from.
// ============================================================================
#include <cstring>
#include <string>
#include <vector>

#include "unity.h"
#include "zip_writer.h"

namespace {

// The sink under test: everything written, in order.
std::vector<uint8_t> g_out;

bool collect(void *, const uint8_t *data, size_t len) {
  g_out.insert(g_out.end(), data, data + len);
  return true;
}

// A sink that fails after `g_fail_after` bytes, for the socket that went away.
size_t g_fail_after = 0;

bool collect_until_full(void *, const uint8_t *data, size_t len) {
  if (g_out.size() + len > g_fail_after) return false;
  g_out.insert(g_out.end(), data, data + len);
  return true;
}

uint16_t u16_at(size_t offset) {
  return static_cast<uint16_t>(g_out[offset] | (g_out[offset + 1] << 8));
}

uint32_t u32_at(size_t offset) {
  return static_cast<uint32_t>(g_out[offset]) | (static_cast<uint32_t>(g_out[offset + 1]) << 8) |
         (static_cast<uint32_t>(g_out[offset + 2]) << 16) |
         (static_cast<uint32_t>(g_out[offset + 3]) << 24);
}

const std::string kName = "diagnostics.json";
const std::string kBody = "{\"version\":\"2.0.0\"}";

// One entry, written the way the route writes one.
void write_one_entry_archive() {
  rt::ZipWriter zip(collect, nullptr);
  const uint8_t *body = reinterpret_cast<const uint8_t *>(kBody.data());
  TEST_ASSERT_TRUE(
      zip.begin(kName, static_cast<uint32_t>(kBody.size()), rt::crc32(0, body, kBody.size())));
  TEST_ASSERT_TRUE(zip.write(body, kBody.size()));
  TEST_ASSERT_TRUE(zip.finish());
  TEST_ASSERT_TRUE(zip.ok());
}

}  // namespace

void setUp() {
  g_out.clear();
  g_fail_after = 0;
}

void tearDown() {}

// The published check value for CRC-32/ISO-HDLC. An independent number: it is
// the one every implementation of this polynomial agrees on, so matching it
// says the seeding and the final inversion are right, not just the loop.
void test_crc32_matches_the_published_check_value() {
  const char *check = "123456789";
  TEST_ASSERT_EQUAL_HEX32(0xCBF43926,
                          rt::crc32(0, reinterpret_cast<const uint8_t *>(check), strlen(check)));
}

// Seeding with the previous result must continue the same stream, because the
// route sums a 128 KB partition in chunks and never holds it whole.
void test_crc32_in_chunks_equals_crc32_in_one_go() {
  const char *check = "123456789";
  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(check);
  const uint32_t whole = rt::crc32(0, bytes, 9);
  const uint32_t chunked = rt::crc32(rt::crc32(rt::crc32(0, bytes, 4), bytes + 4, 3), bytes + 7, 2);
  TEST_ASSERT_EQUAL_HEX32(whole, chunked);
}

void test_the_local_header_describes_the_entry_that_follows_it() {
  write_one_entry_archive();

  TEST_ASSERT_EQUAL_HEX32(0x04034b50, u32_at(0));
  TEST_ASSERT_EQUAL_UINT16(0, u16_at(6));        // no flags
  TEST_ASSERT_EQUAL_UINT16(0, u16_at(8));        // stored, never deflated
  TEST_ASSERT_EQUAL_UINT16(0x0021, u16_at(12));  // 1980-01-01: the device has no clock
  TEST_ASSERT_EQUAL_HEX32(
      rt::crc32(0, reinterpret_cast<const uint8_t *>(kBody.data()), kBody.size()), u32_at(14));
  // Stored, so the two sizes are the same figure - a reader that trusts either
  // one must land in the same place.
  TEST_ASSERT_EQUAL_UINT32(kBody.size(), u32_at(18));
  TEST_ASSERT_EQUAL_UINT32(kBody.size(), u32_at(22));
  TEST_ASSERT_EQUAL_UINT16(kName.size(), u16_at(26));
  TEST_ASSERT_EQUAL_UINT16(0, u16_at(28));  // no extra field

  TEST_ASSERT_EQUAL_STRING_LEN(kName.c_str(), g_out.data() + 30, kName.size());
  TEST_ASSERT_EQUAL_STRING_LEN(kBody.c_str(), g_out.data() + 30 + kName.size(), kBody.size());
}

// The end record is what a reader opens the archive from: it finds the
// directory through these two figures, and everything else follows.
void test_the_end_record_points_at_the_central_directory() {
  write_one_entry_archive();

  const size_t end = g_out.size() - 22;
  TEST_ASSERT_EQUAL_HEX32(0x06054b50, u32_at(end));
  TEST_ASSERT_EQUAL_UINT16(1, u16_at(end + 8));
  TEST_ASSERT_EQUAL_UINT16(1, u16_at(end + 10));

  const uint32_t directory_size = u32_at(end + 12);
  const uint32_t directory_offset = u32_at(end + 16);
  TEST_ASSERT_EQUAL_UINT32(end, directory_offset + directory_size);
  TEST_ASSERT_EQUAL_HEX32(0x02014b50, u32_at(directory_offset));
  // 46 fixed bytes plus the name, and no extra or comment.
  TEST_ASSERT_EQUAL_UINT32(46 + kName.size(), directory_size);
  // And it points back at the local header, which is at the start here.
  TEST_ASSERT_EQUAL_UINT32(0, u32_at(directory_offset + 42));
}

// The bundle is two entries when there is a coredump, so the second one's
// directory record has to point past the first one's payload rather than at
// the start of the file.
void test_a_second_entry_is_offset_past_the_first() {
  rt::ZipWriter zip(collect, nullptr);
  const uint8_t first[] = {'a', 'b', 'c'};
  const uint8_t second[] = {0x00, 0xFF};

  TEST_ASSERT_TRUE(zip.begin("diagnostics.json", 3, rt::crc32(0, first, 3)));
  TEST_ASSERT_TRUE(zip.write(first, 3));
  TEST_ASSERT_TRUE(zip.begin("coredump.bin", 2, rt::crc32(0, second, 2)));
  TEST_ASSERT_TRUE(zip.write(second, 2));
  TEST_ASSERT_TRUE(zip.finish());

  const size_t end = g_out.size() - 22;
  TEST_ASSERT_EQUAL_UINT16(2, u16_at(end + 10));

  const uint32_t directory = u32_at(end + 16);
  TEST_ASSERT_EQUAL_UINT32(0, u32_at(directory + 42));
  const size_t second_record = directory + 46 + strlen("diagnostics.json");
  TEST_ASSERT_EQUAL_HEX32(0x02014b50, u32_at(second_record));
  // 30 header bytes + the name + the 3 payload bytes.
  TEST_ASSERT_EQUAL_UINT32(30 + strlen("diagnostics.json") + 3, u32_at(second_record + 42));
}

// An entry shorter than its declared size would put the next local header
// inside the previous payload: an archive that reads as a truncated file
// rather than as the bug it is. Refused at the point it becomes detectable.
void test_an_entry_short_of_its_declared_size_is_refused() {
  rt::ZipWriter zip(collect, nullptr);
  const uint8_t body[] = {'a', 'b', 'c'};

  TEST_ASSERT_TRUE(zip.begin("short.bin", 3, rt::crc32(0, body, 3)));
  TEST_ASSERT_TRUE(zip.write(body, 2));
  TEST_ASSERT_FALSE(zip.finish());
  TEST_ASSERT_FALSE(zip.ok());
}

void test_writing_past_the_declared_size_is_refused() {
  rt::ZipWriter zip(collect, nullptr);
  const uint8_t body[] = {'a', 'b', 'c', 'd'};

  TEST_ASSERT_TRUE(zip.begin("over.bin", 3, rt::crc32(0, body, 3)));
  TEST_ASSERT_FALSE(zip.write(body, 4));
  TEST_ASSERT_FALSE(zip.ok());
}

// A browser that gives up mid-download is the ordinary case, not an error to
// recover from. What must not happen is the writer carrying on and reporting
// success, because the route decides what to log from `ok()`.
void test_a_failed_sink_latches_and_stops_everything_after_it() {
  g_fail_after = 10;
  rt::ZipWriter zip(collect_until_full, nullptr);
  const uint8_t body[] = {'a', 'b', 'c'};

  TEST_ASSERT_FALSE(zip.begin("truncated.bin", 3, rt::crc32(0, body, 3)));
  TEST_ASSERT_FALSE(zip.write(body, 3));
  TEST_ASSERT_FALSE(zip.finish());
  TEST_ASSERT_FALSE(zip.ok());
}

// An empty archive is a legitimate one, and it is what a bundle would be if
// both entries were somehow absent - better than a zero-length download.
void test_an_archive_with_no_entries_is_still_a_valid_one() {
  rt::ZipWriter zip(collect, nullptr);
  TEST_ASSERT_TRUE(zip.finish());
  TEST_ASSERT_EQUAL_UINT32(22, g_out.size());
  TEST_ASSERT_EQUAL_HEX32(0x06054b50, u32_at(0));
  TEST_ASSERT_EQUAL_UINT16(0, u16_at(8));
  TEST_ASSERT_EQUAL_UINT32(0, u32_at(12));
  TEST_ASSERT_EQUAL_UINT32(0, u32_at(16));
}

void test_nothing_may_be_written_after_the_directory() {
  rt::ZipWriter zip(collect, nullptr);
  TEST_ASSERT_TRUE(zip.finish());
  TEST_ASSERT_FALSE(zip.begin("late.bin", 0, 0));
  TEST_ASSERT_FALSE(zip.ok());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_crc32_matches_the_published_check_value);
  RUN_TEST(test_crc32_in_chunks_equals_crc32_in_one_go);
  RUN_TEST(test_the_local_header_describes_the_entry_that_follows_it);
  RUN_TEST(test_the_end_record_points_at_the_central_directory);
  RUN_TEST(test_a_second_entry_is_offset_past_the_first);
  RUN_TEST(test_an_entry_short_of_its_declared_size_is_refused);
  RUN_TEST(test_writing_past_the_declared_size_is_refused);
  RUN_TEST(test_a_failed_sink_latches_and_stops_everything_after_it);
  RUN_TEST(test_an_archive_with_no_entries_is_still_a_valid_one);
  RUN_TEST(test_nothing_may_be_written_after_the_directory);
  return UNITY_END();
}
