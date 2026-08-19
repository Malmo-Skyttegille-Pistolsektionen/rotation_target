#include "wifi_mgr.h"

#include <cstring>

#include "config.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "mdns.h"
#include "rgb_led.h"
#include "wifi_store.h"

namespace wifi_mgr {
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

void on_event(void *, esp_event_base_t base, int32_t id, void *data) {
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
    esp_wifi_connect();
  } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    rgb_led::red();

    if (s_joined_once) {
      ESP_LOGW(TAG, "Link lost - reconnecting");
      esp_wifi_connect();
      return;
    }

    if (s_retries < CONFIG_RT_WIFI_MAX_RETRIES) {
      s_retries++;
      ESP_LOGW(TAG, "Join attempt %d/%d failed", s_retries, CONFIG_RT_WIFI_MAX_RETRIES);
      esp_wifi_connect();
    } else {
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
    rgb_led::green();
    ESP_LOGI(TAG, "Connected, IP %s", buf);
    xEventGroupSetBits(s_events, kConnectedBit);
  }
}

void start_mdns() {
  if (mdns_init() != ESP_OK) {
    ESP_LOGW(TAG, "mDNS unavailable");
    return;
  }
  mdns_hostname_set(CONFIG_RT_HOSTNAME);
  mdns_instance_name_set("Rotation target");
  mdns_service_add(nullptr, "_http", "_tcp", kHttpPort, nullptr, 0);
  ESP_LOGI(TAG, "Reachable at http://%s.local", CONFIG_RT_HOSTNAME);
}

}  // namespace

std::string ip_address() {
  if (s_ip_lock == nullptr) return {};
  xSemaphoreTake(s_ip_lock, portMAX_DELAY);
  const std::string copy = s_ip;
  xSemaphoreGive(s_ip_lock);
  return copy;
}

Result connect() {
  const wifi_store::Credentials creds = wifi_store::load();

  // Nothing provisioned and no compiled-in default worth trying: go straight
  // to the portal rather than burning the retry budget on a placeholder.
  if (creds.ssid.empty() || creds.ssid == "changeme") {
    ESP_LOGW(TAG, "No network configured - starting the setup portal");
    return Result::kSetupPortal;
  }

  s_ip_lock = xSemaphoreCreateMutex();
  s_events = xEventGroupCreate();

  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  s_netif = esp_netif_create_default_wifi_sta();
  esp_netif_set_hostname(s_netif, CONFIG_RT_HOSTNAME);

  wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

  ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &on_event,
                                                      nullptr, nullptr));
  ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &on_event,
                                                      nullptr, nullptr));

  wifi_config_t wifi_cfg = {};
  // sizeof, not sizeof-1: the struct is zero-initialised and the field is not
  // required to be NUL-terminated, so an SSID of exactly 32 bytes is legal.
  strncpy(reinterpret_cast<char *>(wifi_cfg.sta.ssid), creds.ssid.c_str(),
          sizeof(wifi_cfg.sta.ssid));
  strncpy(reinterpret_cast<char *>(wifi_cfg.sta.password), creds.password.c_str(),
          sizeof(wifi_cfg.sta.password));

  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg));
  // Maximum performance rather than the default modem sleep: the SSE stream is
  // long-lived and power saving adds latency to every state update.
  ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
  ESP_ERROR_CHECK(esp_wifi_start());

  ESP_LOGI(TAG, "Joining '%s'", creds.ssid.c_str());
  const EventBits_t bits =
      xEventGroupWaitBits(s_events, kConnectedBit | kFailedBit, pdFALSE, pdFALSE, portMAX_DELAY);

  if ((bits & kConnectedBit) == 0) {
    ESP_LOGE(TAG, "Could not join '%s' - starting the setup portal", creds.ssid.c_str());
    // Torn down so the portal can bring the radio up as an AP cleanly.
    esp_wifi_stop();
    esp_wifi_deinit();
    return Result::kSetupPortal;
  }

  start_mdns();
  return Result::kConnected;
}

}  // namespace wifi_mgr
