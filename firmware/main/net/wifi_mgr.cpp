#include "wifi_mgr.h"

#include <cstring>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "mdns.h"
#include "nvs_flash.h"
#include "rgb_led.h"

namespace wifi_mgr {
namespace {

const char *TAG = "wifi";

constexpr int kConnectedBit = BIT0;
constexpr int kFailedBit = BIT1;

EventGroupHandle_t s_events = nullptr;
esp_netif_t *s_netif = nullptr;
int s_retries = 0;
std::string s_ip;

void on_event(void *, esp_event_base_t base, int32_t id, void *data) {
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
    esp_wifi_connect();
  } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    // Also fires when an established link drops, not just during the initial
    // join - reconnecting indefinitely after that is what keeps the device
    // reachable through an AP reboot mid-session.
    if (s_retries < CONFIG_RT_WIFI_MAX_RETRIES) {
      s_retries++;
      rgb_led::red();
      ESP_LOGW(TAG, "Disconnected, retry %d/%d", s_retries, CONFIG_RT_WIFI_MAX_RETRIES);
      esp_wifi_connect();
    } else {
      xEventGroupSetBits(s_events, kFailedBit);
    }
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    auto *event = static_cast<ip_event_got_ip_t *>(data);
    char buf[16];
    snprintf(buf, sizeof(buf), IPSTR, IP2STR(&event->ip_info.ip));
    s_ip = buf;
    s_retries = 0;
    rgb_led::yellow();
    ESP_LOGI(TAG, "Connected, IP %s", s_ip.c_str());
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
  mdns_service_add(nullptr, "_http", "_tcp", 80, nullptr, 0);
  ESP_LOGI(TAG, "Reachable at http://%s.local", CONFIG_RT_HOSTNAME);
}

}  // namespace

std::string ip_address() {
  return s_ip;
}

bool connect() {
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
  strncpy(reinterpret_cast<char *>(wifi_cfg.sta.ssid), CONFIG_RT_WIFI_SSID,
          sizeof(wifi_cfg.sta.ssid) - 1);
  strncpy(reinterpret_cast<char *>(wifi_cfg.sta.password), CONFIG_RT_WIFI_PASSWORD,
          sizeof(wifi_cfg.sta.password) - 1);

  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg));
  // Maximum performance rather than the default modem sleep: the SSE stream is
  // long-lived and power saving adds latency to every state update.
  ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
  ESP_ERROR_CHECK(esp_wifi_start());

  ESP_LOGI(TAG, "Joining '%s'", CONFIG_RT_WIFI_SSID);
  const EventBits_t bits =
      xEventGroupWaitBits(s_events, kConnectedBit | kFailedBit, pdFALSE, pdFALSE, portMAX_DELAY);
  if ((bits & kConnectedBit) == 0) {
    ESP_LOGE(TAG, "Could not join '%s'", CONFIG_RT_WIFI_SSID);
    return false;
  }

  start_mdns();
  return true;
}

}  // namespace wifi_mgr
