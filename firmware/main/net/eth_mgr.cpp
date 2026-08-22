// ============================================================================
//  main/net/eth_mgr.cpp
//  The CONFIG_RT_NET_OPENETH implementation of net_mgr: OpenCores Ethernet.
//
//  Built instead of wifi_mgr.cpp when CONFIG_RT_NET_OPENETH is on, which is
//  the QEMU profile (sdkconfig.defaults.qemu) - QEMU emulates no WiFi radio,
//  so the guest reaches the outside world through the OpenCores MAC the
//  emulator maps onto the EMAC register window. The MAC does not exist on any
//  real ESP32-S3; a build with this option on is a simulator build only.
//
//  There is no setup portal and no NVS credential here: SLIRP hands out an
//  address over DHCP (10.0.2.15 by default), so there is nothing to provision.
//  See docs/QEMU.md.
// ============================================================================
#include <cstdio>

#include "config.h"
#include "esp_eth.h"
#include "esp_eth_mac_openeth.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "mdns.h"
#include "net_mgr.h"
#include "rgb_led.h"

namespace net_mgr {
namespace {

const char *TAG = "eth";

constexpr int kGotIpBit = BIT0;
// DHCP against SLIRP answers in milliseconds. The wait exists so a broken
// -nic argument shows up as one loud line rather than a boot that hangs
// forever with no server and no explanation.
constexpr TickType_t kDhcpTimeout = pdMS_TO_TICKS(30000);

// QEMU's open_eth answers MII reads for exactly one PHY address and leaves the
// identifier registers at zero, so ESP_ETH_PHY_ADDR_AUTO - which scans for a
// non-zero PHYIDR1 - finds nothing. The address is fixed in the device model.
constexpr int kPhyAddr = 1;

EventGroupHandle_t s_events = nullptr;
// Written on the event task, read from the main task and from the diagnostics
// handler on the httpd task.
std::string s_ip;
SemaphoreHandle_t s_ip_lock = nullptr;

void on_event(void *, esp_event_base_t base, int32_t id, void *data) {
  if (base == ETH_EVENT && id == ETHERNET_EVENT_CONNECTED) {
    ESP_LOGI(TAG, "Link up");
  } else if (base == ETH_EVENT && id == ETHERNET_EVENT_DISCONNECTED) {
    rgb_led::status_offline();
    ESP_LOGW(TAG, "Link down");
  } else if (base == IP_EVENT && id == IP_EVENT_ETH_GOT_IP) {
    auto *event = static_cast<ip_event_got_ip_t *>(data);
    char buf[16];
    snprintf(buf, sizeof(buf), IPSTR, IP2STR(&event->ip_info.ip));
    if (s_ip_lock != nullptr) {
      xSemaphoreTake(s_ip_lock, portMAX_DELAY);
      s_ip = buf;
      xSemaphoreGive(s_ip_lock);
    }
    rgb_led::status_online();
    ESP_LOGI(TAG, "Got IP %s", buf);
    xEventGroupSetBits(s_events, kGotIpBit);
  }
}

// Kept because it costs nothing and the same code serves a real board over
// Ethernet one day. Under QEMU's SLIRP the host cannot see multicast DNS -
// reach the guest at the forwarded localhost port instead.
void start_mdns() {
  if (mdns_init() != ESP_OK) {
    ESP_LOGW(TAG, "mDNS unavailable");
    return;
  }
  mdns_hostname_set(CONFIG_RT_HOSTNAME);
  mdns_instance_name_set("Rotation target");
  mdns_service_add(nullptr, "_http", "_tcp", kHttpPort, nullptr, 0);
}

}  // namespace

// No radio under QEMU, so there is no network to name and no signal to report.
std::string ssid() {
  return "";
}

int rssi() {
  return 0;
}

std::string ip_address() {
  if (s_ip_lock == nullptr) return {};
  xSemaphoreTake(s_ip_lock, portMAX_DELAY);
  const std::string copy = s_ip;
  xSemaphoreGive(s_ip_lock);
  return copy;
}

Result connect() {
  s_ip_lock = xSemaphoreCreateMutex();
  s_events = xEventGroupCreate();

  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());

  esp_netif_config_t netif_cfg = ESP_NETIF_DEFAULT_ETH();
  esp_netif_t *netif = esp_netif_new(&netif_cfg);
  esp_netif_set_hostname(netif, CONFIG_RT_HOSTNAME);

  eth_mac_config_t mac_cfg = ETH_MAC_DEFAULT_CONFIG();
  esp_eth_mac_t *mac = esp_eth_mac_new_openeth(&mac_cfg);

  eth_phy_config_t phy_cfg = ETH_PHY_DEFAULT_CONFIG();
  phy_cfg.phy_addr = kPhyAddr;
  // The default is GPIO5 - which on this board drives the targets. There is no
  // PHY reset line to pull in an emulator, so the pin must stay untouched.
  phy_cfg.reset_gpio_num = -1;
  esp_eth_phy_t *phy = esp_eth_phy_new_generic(&phy_cfg);

  esp_eth_config_t eth_cfg = ETH_DEFAULT_CONFIG(mac, phy);
  esp_eth_handle_t eth = nullptr;
  ESP_ERROR_CHECK(esp_eth_driver_install(&eth_cfg, &eth));
  ESP_ERROR_CHECK(esp_netif_attach(netif, esp_eth_new_netif_glue(eth)));

  ESP_ERROR_CHECK(esp_event_handler_instance_register(ETH_EVENT, ESP_EVENT_ANY_ID, &on_event,
                                                      nullptr, nullptr));
  ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_ETH_GOT_IP, &on_event,
                                                      nullptr, nullptr));

  ESP_ERROR_CHECK(esp_eth_start(eth));

  if ((xEventGroupWaitBits(s_events, kGotIpBit, pdFALSE, pdFALSE, kDhcpTimeout) & kGotIpBit) == 0) {
    // The DHCP client keeps retrying, so the server is still worth starting -
    // it just is not reachable yet, and ip_address() stays empty until it is.
    ESP_LOGE(TAG, "No DHCP lease after 30 s - starting the server anyway");
  }

  start_mdns();
  return Result::kConnected;
}

// Unreachable: connect() never returns kSetupPortal on this path. Provided
// because app_main links against the same net_mgr interface either way.
void run_setup_portal() {
  ESP_LOGE(TAG, "No setup portal in the Ethernet build");
  esp_restart();
}

}  // namespace net_mgr
