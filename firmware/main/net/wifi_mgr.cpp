#include "config/hardware_store.h"
#include "net_mgr.h"

#include <algorithm>
#include <cstring>
#include <vector>

#include "config.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "mdns.h"
#include "rgb_led.h"
#include "setup_portal.h"
#include "wifi_store.h"

namespace net_mgr {
namespace {

const char *TAG = "wifi";

constexpr int kConnectedBit = BIT0;
constexpr int kFailedBit = BIT1;

EventGroupHandle_t s_events = nullptr;
esp_netif_t *s_netif = nullptr;
int s_retries = 0;
// Set on the first successful association. After that the retry cap no longer
// applies - see the header: giving up mid-session leaves the device powered on
// and unreachable, needing someone to walk to it and power-cycle it.
bool s_joined_once = false;
// Written on the WiFi event task, read from the main task and from the
// diagnostics handler on the httpd task.
std::string s_ip;
SemaphoreHandle_t s_ip_lock = nullptr;

// Reconnect backoff, for the after-first-join path only. Observed at the
// range: the router restarted, and the immediate-reconnect loop hammered it
// every ~2.4 s for over a minute without ever getting back on - while a
// laptop on the same SSID had long since reassociated. An AP still booting
// answers those early attempts just well enough to fail them, and retrying
// instantly can also keep the supplicant on stale cached keys instead of
// renegotiating (espressif/arduino-esp32#7968). Doubles per failure, capped
// low enough that a device is never more than half a minute from noticing
// the network came back.
constexpr int64_t kReconnectBackoffFirstMs = 1000;
// The multiplication is done wide. `30 * 1000` is computed in `int` and only
// then widened, which is what bugprone-implicit-widening-of-multiplication-result
// objects to - harmless at these values, and the habit that overflows once the
// operands stop being literals.
constexpr int64_t kReconnectBackoffCapMs = int64_t{30} * 1000;
esp_timer_handle_t s_reconnect_timer = nullptr;
int64_t s_backoff_ms = kReconnectBackoffFirstMs;
// Whether any attempt at the current network got an answer out of the AP.
// Latches the larger retry budget for the rest of that network's attempts.
bool s_budget_answered = false;

// A reason that means the AP heard us and answered - the WPA handshake
// started and timed out, or an auth round expired mid-way. Seen on two
// different routers (an ASUS and a UniFi) on a crowded band: joins that
// reach `run` and then drop with reason 15, twice, before the third
// attempt sticks. Worth more patience than "no such network", because
// retrying is nearly always what fixes it. A wrong password produces the
// same reasons, so the budget is bigger, not infinite - the portal stays
// reachable.
bool ap_answered(uint8_t reason) {
  return reason == WIFI_REASON_AUTH_EXPIRE || reason == WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT ||
         reason == WIFI_REASON_HANDSHAKE_TIMEOUT;
}

void on_reconnect_timer(void *) {
  esp_wifi_connect();
}

void on_event(void *, esp_event_base_t base, int32_t id, void *data) {
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
    esp_wifi_connect();
  } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    const auto *event = static_cast<wifi_event_sta_disconnected_t *>(data);

    if (s_joined_once) {
      ESP_LOGW(TAG, "Link lost (reason %d) - reconnecting in %d ms",
               static_cast<int>(event->reason), static_cast<int>(s_backoff_ms));
      rgb_led::status_joining();
      if (s_reconnect_timer != nullptr &&
          esp_timer_start_once(s_reconnect_timer, s_backoff_ms * 1000) == ESP_OK) {
        s_backoff_ms = std::min<int64_t>(s_backoff_ms * 2, kReconnectBackoffCapMs);
      } else {
        // No timer to wait on: the old behaviour, immediate, beats stopping.
        esp_wifi_connect();
      }
      return;
    }

    // Sticky within one network's attempts: a struggling router alternates
    // "no answer to auth" with "not found in the scan", and a budget that
    // shrank back on the second kind ended a nominal twelve-attempt join at
    // five (seen on hardware). Once any attempt proves the AP is there, the
    // whole join keeps the bigger budget. connect() resets it per network.
    const int base_budget = hardware_store::current().wifi_max_retries;
    if (ap_answered(event->reason)) s_budget_answered = true;
    const int budget = s_budget_answered ? base_budget * 3 : base_budget;
    if (s_retries < budget) {
      s_retries++;
      ESP_LOGW(TAG, "Join attempt %d/%d failed (reason %d)", s_retries, budget,
               static_cast<int>(event->reason));
      rgb_led::status_joining();
      esp_wifi_connect();
    } else {
      // Out of attempts on this network. Solid red says so until the setup
      // portal takes over, if that is where we end up.
      rgb_led::status_offline();
      xEventGroupSetBits(s_events, kFailedBit);
    }
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    auto *event = static_cast<ip_event_got_ip_t *>(data);
    char buf[16];
    snprintf(buf, sizeof(buf), IPSTR, IP2STR(&event->ip_info.ip));
    if (s_ip_lock != nullptr) {
      xSemaphoreTake(s_ip_lock, portMAX_DELAY);
      s_ip = buf;
      xSemaphoreGive(s_ip_lock);
    }
    s_retries = 0;
    s_joined_once = true;
    s_backoff_ms = kReconnectBackoffFirstMs;
    rgb_led::status_online();
    ESP_LOGI(TAG, "Connected, IP %s", buf);
    xEventGroupSetBits(s_events, kConnectedBit);
  }
}

void start_mdns() {
  if (mdns_init() != ESP_OK) {
    ESP_LOGW(TAG, "mDNS unavailable");
    return;
  }
  mdns_hostname_set(hardware_store::current().hostname.c_str());
  mdns_instance_name_set("Rotation target");
  mdns_service_add(nullptr, "_http", "_tcp",
                   static_cast<uint16_t>(hardware_store::current().http_port), nullptr, 0);
  ESP_LOGI(TAG, "Reachable at http://%s.local", hardware_store::current().hostname.c_str());
}

}  // namespace

std::string ssid() {
  wifi_ap_record_t ap = {};
  if (esp_wifi_sta_get_ap_info(&ap) != ESP_OK) return "";
  return std::string(reinterpret_cast<const char *>(ap.ssid));
}

int rssi() {
  wifi_ap_record_t ap = {};
  if (esp_wifi_sta_get_ap_info(&ap) != ESP_OK) return 0;
  return ap.rssi;
}

std::string ip_address() {
  if (s_ip_lock == nullptr) return {};
  xSemaphoreTake(s_ip_lock, portMAX_DELAY);
  const std::string copy = s_ip;
  xSemaphoreGive(s_ip_lock);
  return copy;
}

Result connect() {
  const std::vector<wifi_store::Credentials> networks = wifi_store::load_all();

  // Nothing configured anywhere: go straight to the portal rather than burning
  // the retry budget on a placeholder.
  if (networks.empty()) {
    ESP_LOGW(TAG, "No network configured - starting the setup portal");
    return Result::kSetupPortal;
  }

  s_ip_lock = xSemaphoreCreateMutex();
  s_events = xEventGroupCreate();

  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  s_netif = esp_netif_create_default_wifi_sta();
  esp_netif_set_hostname(s_netif, hardware_store::current().hostname.c_str());

  wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

  ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &on_event,
                                                      nullptr, nullptr));
  ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &on_event,
                                                      nullptr, nullptr));

  const esp_timer_create_args_t timer_args = {.callback = &on_reconnect_timer,
                                              .arg = nullptr,
                                              .dispatch_method = ESP_TIMER_TASK,
                                              .name = "wifi_reconnect",
                                              .skip_unhandled_events = true};
  ESP_ERROR_CHECK(esp_timer_create(&timer_args, &s_reconnect_timer));

  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  // Maximum performance rather than the default modem sleep: the SSE stream is
  // long-lived and power saving adds latency to every state update.
  ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

  // Each configured network gets the full retry budget in turn. The radio is
  // started once and reconfigured between attempts - stopping and restarting it
  // per network would tear down the netif the DHCP client is bound to.
  bool radio_started = false;

  for (size_t i = 0; i < networks.size(); i++) {
    const wifi_store::Credentials &creds = networks[i];

    wifi_config_t wifi_cfg = {};
    // sizeof, not sizeof-1: the struct is zero-initialised and the field is not
    // required to be NUL-terminated, so an SSID of exactly 32 bytes is legal.
    strncpy(reinterpret_cast<char *>(wifi_cfg.sta.ssid), creds.ssid.c_str(),
            sizeof(wifi_cfg.sta.ssid));
    strncpy(reinterpret_cast<char *>(wifi_cfg.sta.password), creds.password.c_str(),
            sizeof(wifi_cfg.sta.password));

    // The club's network is hidden, which means it never answers a passive scan.
    // An all-channel active scan puts the SSID in the probe request, which is
    // what makes a hidden AP respond at all. WIFI_FAST_SCAN (the default) stops
    // at the first matching AP found passively and would never find it.
    wifi_cfg.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
    wifi_cfg.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg));

    s_retries = 0;
    s_budget_answered = false;
    xEventGroupClearBits(s_events, kConnectedBit | kFailedBit);

    ESP_LOGI(TAG, "Joining '%s' (%d of %d)", creds.ssid.c_str(), static_cast<int>(i + 1),
             static_cast<int>(networks.size()));

    if (!radio_started) {
      // STA_START triggers the first esp_wifi_connect() from the event handler.
      ESP_ERROR_CHECK(esp_wifi_start());
      radio_started = true;
    } else {
      ESP_ERROR_CHECK(esp_wifi_connect());
    }

    const EventBits_t bits =
        xEventGroupWaitBits(s_events, kConnectedBit | kFailedBit, pdFALSE, pdFALSE, portMAX_DELAY);

    if ((bits & kConnectedBit) != 0) {
      start_mdns();
      return Result::kConnected;
    }

    ESP_LOGW(TAG, "Could not join '%s'", creds.ssid.c_str());
  }

  ESP_LOGE(TAG, "No configured network could be joined - starting the setup portal");
  // Torn down so the portal can bring the radio up as an AP cleanly.
  esp_wifi_stop();
  esp_wifi_deinit();
  return Result::kSetupPortal;
}

void run_setup_portal() {
  setup_portal::run();
}

}  // namespace net_mgr
