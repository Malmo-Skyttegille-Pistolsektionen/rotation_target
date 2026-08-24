#include "config/hardware_store.h"
#include "console.h"

#include <cinttypes>
#include <cstdio>
#include <string>

#include "sdkconfig.h"

#if CONFIG_RT_CONSOLE_ENABLED
#include "driver/usb_serial_jtag.h"
#include "esp_app_desc.h"
#include "esp_idf_version.h"
#include "esp_netif.h"
#include "esp_log.h"
#include "esp_wifi.h"
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
#if !CONFIG_RT_NET_OPENETH
#include "wifi_scan.h"
#endif
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
           targets::level() == targets::level_shown() ? "shown" : "hidden", targets::pin(),
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

// `boot-targets [shown|hidden]`. Serial-only on purpose (D-31, #144): which
// position is safe at rest depends on the target system, so it must be
// configurable - but a web form is the wrong place to change what the targets
// do while somebody may be downrange.
void handle_boot_targets(const std::string &line) {
  const bool current = hardware_store::current().targets_shown_at_boot;

  switch (rt::console::parse_boot_targets(line)) {
    case rt::console::BootTargets::kMissing: {
      // Both values when they differ. Reporting only the active one right
      // after a change reads as "that did nothing" - the same trap
      // `restartRequired` exists to close on the HTTP side.
      const bool pending = hardware_store::saved().targets_shown_at_boot;
      std::string out =
          std::string("targets rest ") + (current ? "shown" : "hidden") + " at boot\r\n";
      if (pending != current) {
        out += std::string("after the next restart they will rest ") +
               (pending ? "shown" : "hidden") + "\r\n";
      } else {
        out += "change with 'boot-targets shown' or 'boot-targets hidden'\r\n";
      }
      say(out);
      return;
    }
    case rt::console::BootTargets::kInvalid:
      say("expected 'shown' or 'hidden'\r\n");
      return;
    case rt::console::BootTargets::kShown:
    case rt::console::BootTargets::kHidden:
      break;
  }

  const bool shown = rt::console::parse_boot_targets(line) == rt::console::BootTargets::kShown;
  if (!hardware_store::save_boot_targets(shown)) {
    say("could not save - storage is not writable\r\n");
    return;
  }
  // Says what did *not* happen as well as what did: nothing moves now, and an
  // operator who reads only the first half would think the targets had already
  // changed behaviour.
  say(std::string("targets will rest ") + (shown ? "shown" : "hidden") +
      " at boot\r\nthe targets have not moved; this applies at the next restart\r\n");
}

#if !CONFIG_RT_NET_OPENETH

// A scan, printed as a table somebody can read at a range on a laptop screen.
//
// Runs a fresh scan rather than serving the cached one: the question being
// asked here is "what does it look like *now*", usually while somebody moves
// the board or an access point around.
void handle_wifi_scan() {
  say("scanning all channels (about 2s)...\r\n");
  const std::vector<wifi_scan::AccessPoint> found = wifi_scan::scan();
  if (found.empty()) {
    say("no networks found - the radio may be down, or nothing is on air\r\n");
    return;
  }

  char line[128];
  say("\r\n signal  dBm  ch  security    SSID\r\n");
  say(" ------  ---  --  ----------  ----------------------------------\r\n");
  for (const wifi_scan::AccessPoint &ap : found) {
    const int b = wifi_scan::bars(ap.rssi);
    char meter[5] = "....";
    for (int i = 0; i < b && i < 4; i++) meter[i] = '#';
    snprintf(line, sizeof(line), " [%s] %4d  %2u  %-10s  %s\r\n", meter, static_cast<int>(ap.rssi),
             static_cast<unsigned>(ap.channel), wifi_scan::auth_name(ap.auth),
             ap.ssid.empty() ? "(hidden)" : ap.ssid.c_str());
    say(line);
  }
  snprintf(line, sizeof(line), "\r\n%u network(s). Same list the setup portal offers.\r\n",
           static_cast<unsigned>(found.size()));
  say(line);
}

// What this device is joined to and how well, which is the other half of
// diagnosing a join that keeps dropping.
void handle_wifi_info() {
  char line[160];

  wifi_ap_record_t ap = {};
  if (esp_wifi_sta_get_ap_info(&ap) != ESP_OK) {
    say("not joined to a network\r\n");
    say("(if the setup portal is up, this device is serving its own AP instead)\r\n");
    return;
  }

  const size_t len = strnlen(reinterpret_cast<const char *>(ap.ssid), sizeof(ap.ssid));
  const std::string ssid(reinterpret_cast<const char *>(ap.ssid), len);
  snprintf(line, sizeof(line), "ssid       %s\r\n", ssid.empty() ? "(hidden)" : ssid.c_str());
  say(line);
  snprintf(line, sizeof(line), "bssid      %02x:%02x:%02x:%02x:%02x:%02x\r\n", ap.bssid[0],
           ap.bssid[1], ap.bssid[2], ap.bssid[3], ap.bssid[4], ap.bssid[5]);
  say(line);
  snprintf(line, sizeof(line), "signal     %d dBm (%d/4 bars)\r\n", static_cast<int>(ap.rssi),
           wifi_scan::bars(ap.rssi));
  say(line);
  snprintf(line, sizeof(line), "channel    %u\r\n", static_cast<unsigned>(ap.primary));
  say(line);
  snprintf(line, sizeof(line), "security   %s\r\n", wifi_scan::auth_name(ap.authmode));
  say(line);

  esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
  if (netif != nullptr) {
    esp_netif_ip_info_t ip = {};
    if (esp_netif_get_ip_info(netif, &ip) == ESP_OK) {
      snprintf(line, sizeof(line),
               "ip         " IPSTR "\r\nnetmask    " IPSTR "\r\ngateway    " IPSTR "\r\n",
               IP2STR(&ip.ip), IP2STR(&ip.netmask), IP2STR(&ip.gw));
      say(line);
    }
    esp_netif_dns_info_t dns = {};
    if (esp_netif_get_dns_info(netif, ESP_NETIF_DNS_MAIN, &dns) == ESP_OK) {
      snprintf(line, sizeof(line), "dns        " IPSTR "\r\n", IP2STR(&dns.ip.u_addr.ip4));
      say(line);
    }
    uint8_t mac[6] = {};
    if (esp_netif_get_mac(netif, mac) == ESP_OK) {
      snprintf(line, sizeof(line), "mac        %02x:%02x:%02x:%02x:%02x:%02x\r\n", mac[0], mac[1],
               mac[2], mac[3], mac[4], mac[5]);
      say(line);
    }
  }
}

#else  // CONFIG_RT_NET_OPENETH

// The QEMU build has an emulated Ethernet controller and no radio, so there is
// nothing to scan and wifi_scan.cpp is not linked in. Answered rather than
// hidden: a command that silently vanishes on one build is worse than one that
// says why it cannot help.
void handle_wifi_scan() {
  say("this build has no radio (CONFIG_RT_NET_OPENETH) - nothing to scan\r\n");
}

void handle_wifi_info() {
  say("this build has no radio (CONFIG_RT_NET_OPENETH) - see 'status' for the link\r\n");
}

#endif  // CONFIG_RT_NET_OPENETH

void handle(const std::string &line) {
  switch (rt::console::parse_command(line)) {
    case rt::console::Command::kNone:
      break;
    case rt::console::Command::kStatus:
      say(status_text());
      break;
    case rt::console::Command::kBootTargets:
      handle_boot_targets(line);
      break;
    case rt::console::Command::kWifiScan:
      handle_wifi_scan();
      break;
    case rt::console::Command::kWifiInfo:
      handle_wifi_info();
      break;
    case rt::console::Command::kHelp:
      say("status         network, targets, storage, and what the boot scan found\r\n"
          "boot-targets   where the targets rest at boot: 'shown' or 'hidden'\r\n"
          "               reads with no argument. Serial only - it is what\r\n"
          "               protects somebody standing downrange.\r\n"
          "wifi-scan      every network the radio can hear: signal, channel,\r\n"
          "               security. The same list the setup portal offers.\r\n"
          "wifi-info      what this device is joined to: signal, channel, IP,\r\n"
          "               gateway, DNS, MAC.\r\n"
          "help           this\r\n");
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
