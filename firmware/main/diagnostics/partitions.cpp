#include "partitions.h"

#include "esp_core_dump.h"
#include "esp_littlefs.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "nvs.h"

namespace diagnostics {
namespace {

// The on-flash length of the app image in `part`, or 0 if it does not hold one.
//
// ESP-IDF has no runtime call for this, and the figure is what says whether an
// OTA image will fit a slot (#127) - so we walk the image header the same way
// scripts/app_desc.py does offline. Layout per esp_image_format.h: a 24-byte
// header, then `segment_count` segments each with an 8-byte header, then
// padding to a 16-byte boundary less one, a checksum byte, and a 32-byte hash
// when the header says one is appended. Sizes are hardcoded rather than pulled
// from bootloader_support, which app code does not otherwise depend on.
uint32_t app_image_size(const esp_partition_t *part) {
  constexpr size_t kImageHeaderBytes = 24;
  constexpr size_t kSegmentHeaderBytes = 8;
  constexpr uint8_t kImageMagic = 0xE9;

  uint8_t header[kImageHeaderBytes];
  if (part == nullptr || esp_partition_read(part, 0, header, sizeof(header)) != ESP_OK) return 0;
  if (header[0] != kImageMagic) return 0;

  const uint8_t segments = header[1];
  const bool hash_appended = header[23] != 0;

  size_t offset = kImageHeaderBytes;
  for (uint8_t i = 0; i < segments; i++) {
    uint8_t seg[kSegmentHeaderBytes];
    if (esp_partition_read(part, offset, seg, sizeof(seg)) != ESP_OK) return 0;
    // Little-endian data_len, the second word of the segment header.
    const uint32_t data_len = static_cast<uint32_t>(seg[4]) | (static_cast<uint32_t>(seg[5]) << 8) |
                              (static_cast<uint32_t>(seg[6]) << 16) |
                              (static_cast<uint32_t>(seg[7]) << 24);
    offset += kSegmentHeaderBytes + data_len;
    if (offset > part->size) return 0;  // not a coherent image
  }

  offset = (offset + 16) & ~static_cast<size_t>(15);  // pad, then the checksum byte
  if (hash_appended) offset += 32;
  return offset > part->size ? 0 : static_cast<uint32_t>(offset);
}

}  // namespace

std::vector<PartitionUsage> partitions() {
  std::vector<PartitionUsage> out;
  const esp_partition_t *running = esp_ota_get_running_partition();

  esp_partition_iterator_t it =
      esp_partition_find(ESP_PARTITION_TYPE_ANY, ESP_PARTITION_SUBTYPE_ANY, nullptr);
  for (; it != nullptr; it = esp_partition_next(it)) {
    const esp_partition_t *part = esp_partition_get(it);
    if (part == nullptr) continue;

    PartitionUsage entry = {};
    entry.name = part->label;
    entry.is_app = part->type == ESP_PARTITION_TYPE_APP;
    entry.size_bytes = part->size;

    if (entry.is_app) {
      entry.used_known = true;
      entry.used_bytes = app_image_size(part);
      entry.running = running != nullptr && part->address == running->address;
    } else if (part->subtype == ESP_PARTITION_SUBTYPE_DATA_LITTLEFS) {
      size_t total = 0, used = 0;
      if (esp_littlefs_info(part->label, &total, &used) == ESP_OK) {
        entry.used_known = true;
        entry.used_bytes = used;
      }
    } else if (part->subtype == ESP_PARTITION_SUBTYPE_DATA_NVS) {
      nvs_stats_t stats = {};
      if (nvs_get_stats(part->label, &stats) == ESP_OK) {
        // NVS accounts in 32-byte entries, not bytes; converting keeps the
        // shape uniform, at the cost of being a whole number of entries.
        entry.used_known = true;
        entry.used_bytes = static_cast<size_t>(stats.used_entries) * 32;
      }
    } else if (part->subtype == ESP_PARTITION_SUBTYPE_DATA_COREDUMP) {
      size_t addr = 0, size = 0;
      entry.used_known = true;
      entry.used_bytes = esp_core_dump_image_get(&addr, &size) == ESP_OK ? size : 0;
    }

    out.push_back(entry);
  }
  esp_partition_iterator_release(it);
  return out;
}

const char *reset_reason_name(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:
      return "poweron";
    case ESP_RST_EXT:
      return "external";
    case ESP_RST_SW:
      return "software";
    case ESP_RST_PANIC:
      return "panic";
    case ESP_RST_INT_WDT:
      return "interrupt_watchdog";
    case ESP_RST_TASK_WDT:
      return "task_watchdog";
    case ESP_RST_WDT:
      return "other_watchdog";
    case ESP_RST_DEEPSLEEP:
      return "deepsleep";
    case ESP_RST_BROWNOUT:
      return "brownout";
    case ESP_RST_SDIO:
      return "sdio";
    // Added after a device reported "unknown": a USB-Serial/JTAG reset is what
    // every development reset looks like, and it was not in the switch.
    case ESP_RST_USB:
      return "usb";
    case ESP_RST_JTAG:
      return "jtag";
    case ESP_RST_EFUSE:
      return "efuse";
    case ESP_RST_PWR_GLITCH:
      return "power_glitch";
    case ESP_RST_CPU_LOCKUP:
      return "cpu_lockup";
    default:
      return "unknown";
  }
}

}  // namespace diagnostics
