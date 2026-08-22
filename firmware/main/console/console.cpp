#include "console.h"

#include <cinttypes>
#include <cstdio>
#include <string>

#include "sdkconfig.h"

#if CONFIG_RT_CONSOLE_ENABLED
#include "driver/usb_serial_jtag.h"
#include "esp_app_desc.h"
#include "esp_idf_version.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "audios.h"
#include "config.h"
#include "console_command.h"
#include "net_mgr.h"
#include "partitions.h"
#include "programs.h"
#include "sse_hub.h"
#include "targets.h"
#endif

namespace console {

#if !CONFIG_RT_CONSOLE_ENABLED

void init() {}

#else

namespace {
const char *TAG = "console";

// Deliberately not printf: stdout is the UART, and the command arrived on the
// USB serial/JTAG port. Answering on a different cable than the question came
// in on is the kind of thing nobody debugs twice.
//
// Loops rather than writing once. The driver's TX ring is finite and
// usb_serial_jtag_write_bytes() returns as soon as it has taken what fits - a
// single call with the whole of `status` silently delivered nothing at all,
// while the four-byte prompt after it went through, which is exactly what a
// buffer-sized cliff looks like from the outside.
void say(const std::string &text) {
  size_t sent = 0;
  while (sent < text.size()) {
    const int wrote =
        usb_serial_jtag_write_bytes(text.data() + sent, text.size() - sent, pdMS_TO_TICKS(500));
    // Nothing taken within half a second means nobody is draining the port -
    // no terminal attached, or one that has stopped reading. Dropping the rest
    // beats blocking the console task forever.
    if (wrote <= 0) return;
    sent += static_cast<size_t>(wrote);
  }
}

// Read across a serial line by somebody standing at a bench, so rounded to
// something speakable. GET /api/v2/diagnostics/info carries the exact figures.
std::string human_size(size_t bytes) {
  char buf[32];
  if (bytes >= 1024 * 1024) {
    snprintf(buf, sizeof(buf), "%.1f MB", static_cast<double>(bytes) / (1024.0 * 1024.0));
  } else if (bytes >= 1024) {
    snprintf(buf, sizeof(buf), "%.0f KB", static_cast<double>(bytes) / 1024.0);
  } else {
    snprintf(buf, sizeof(buf), "%u B", static_cast<unsigned>(bytes));
  }
  return buf;
}

std::string status_text() {
  const esp_app_desc_t *desc = esp_app_get_description();
  char line[192];
  std::string out;

  snprintf(line, sizeof(line), "version    %s (%s %s), ESP-IDF %s\r\n", desc->version, desc->date,
           desc->time, IDF_VER);
  out += line;
  snprintf(line, sizeof(line), "uptime     %" PRId64 " s\r\n", esp_timer_get_time() / 1000000);
  out += line;
  snprintf(line, sizeof(line), "reset      %s\r\n",
           diagnostics::reset_reason_name(esp_reset_reason()));
  out += line;

  // The question at the range was "which network did it actually join, and on
  // what address" - HTTP could not answer it, because the laptop could not
  // reach the device at all.
  const std::string ip = net_mgr::ip_address();
  if (ip.empty()) {
    out += "network    not connected\r\n";
  } else {
    const std::string ssid = net_mgr::ssid();
    if (ssid.empty()) {
      snprintf(line, sizeof(line), "network    %s\r\n", ip.c_str());
    } else {
      snprintf(line, sizeof(line), "network    %s on '%s' (%d dBm)\r\n", ip.c_str(), ssid.c_str(),
               net_mgr::rssi());
    }
    out += line;
  }

  // Both halves: what the firmware drove, and what is actually on the pad.
  snprintf(line, sizeof(line), "targets    %s (gpio %d, level %d)\r\n",
           targets::level() == kTargetLevelShown ? "shown" : "hidden", targets::pin(),
           targets::level());
  out += line;

  snprintf(line, sizeof(line), "programs   %u\r\naudio      %u clips\r\n",
           static_cast<unsigned>(programs::all().size()),
           static_cast<unsigned>(audios::all().size()));
  out += line;

  out += "flash\r\n";
  for (const auto &part : diagnostics::partitions()) {
    if (part.used_known) {
      snprintf(line, sizeof(line), "  %-10s %s used of %s (%s free)%s\r\n", part.name,
               human_size(part.used_bytes).c_str(), human_size(part.size_bytes).c_str(),
               human_size(part.size_bytes - part.used_bytes).c_str(),
               part.running ? " [running]" : "");
    } else {
      snprintf(line, sizeof(line), "  %-10s %s (usage unknown)\r\n", part.name,
               human_size(part.size_bytes).c_str());
    }
    out += line;
  }

  const auto &issues = sse_hub::startup_issues();
  if (issues.empty()) {
    out += "issues     none\r\n";
  } else {
    snprintf(line, sizeof(line), "issues     %u from boot, see /api/v2/diagnostics/info\r\n",
             static_cast<unsigned>(issues.size()));
    out += line;
  }
  return out;
}

void handle(const std::string &line) {
  switch (rt::console::parse_command(line)) {
    case rt::console::Command::kNone:
      break;
    case rt::console::Command::kStatus:
      say(status_text());
      break;
    case rt::console::Command::kHelp:
      say("status   network, targets, storage, and what the boot scan found\r\n"
          "help     this\r\n");
      break;
    case rt::console::Command::kUnknown:
      say("unknown command '" + rt::console::first_word(line) + "' - try 'help'\r\n");
      break;
  }
  say("rt> ");
}

void task(void *) {
  say("\r\nrotation target console - type 'help'\r\nrt> ");

  std::string line;
  for (;;) {
    uint8_t byte = 0;
    const int read = usb_serial_jtag_read_bytes(&byte, 1, portMAX_DELAY);
    if (read <= 0) continue;

    if (byte == '\r' || byte == '\n') {
      say("\r\n");
      handle(line);
      line.clear();
      continue;
    }

    // Backspace, because a serial terminal sends the keystroke rather than an
    // edited line, and typing `status` correctly first time is not a given.
    if (byte == 0x7F || byte == '\b') {
      if (!line.empty()) {
        line.pop_back();
        say("\b \b");
      }
      continue;
    }

    // A bound, so line noise on a floating USB line cannot grow the heap.
    if (line.size() < 120 && byte >= 0x20) {
      line.push_back(static_cast<char>(byte));
      say(std::string(1, static_cast<char>(byte)));  // echo: the port does not
    }
  }
}

}  // namespace

void init() {
  usb_serial_jtag_driver_config_t config = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
  // The default TX ring is 256 bytes and a `status` dump is roughly three times
  // that. say() would cope by looping regardless, but a ring smaller than the
  // usual message means every reply pays several round trips.
  config.tx_buffer_size = 2048;
  const esp_err_t err = usb_serial_jtag_driver_install(&config);
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "Console unavailable (%s) - continuing without one", esp_err_to_name(err));
    return;
  }

  if (xTaskCreate(task, "console", 4096, nullptr, 2, nullptr) != pdPASS) {
    ESP_LOGW(TAG, "Console task would not start - continuing without one");
  }
}

#endif  // CONFIG_RT_CONSOLE_ENABLED

}  // namespace console
