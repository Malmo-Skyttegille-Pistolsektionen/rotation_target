#include "wifi_scan.h"

#include <algorithm>
#include <cstring>

#include "esp_log.h"
#include "esp_wifi.h"

namespace wifi_scan {
namespace {

const char *TAG = "wifi_scan";

// Enough for a busy site. A club hall sees a handful; a range next to a car
// park on a Saturday can see thirty. Beyond this the weakest are dropped, which
// is the right end to lose.
constexpr uint16_t kMaxResults = 40;

std::vector<AccessPoint> s_cached;

}  // namespace

std::vector<AccessPoint> scan() {
  wifi_scan_config_t cfg = {};
  // Hidden networks included: the deployment SSID is hidden, and a survey that
  // silently omitted it would be actively misleading about what is on air.
  cfg.show_hidden = true;
  cfg.scan_type = WIFI_SCAN_TYPE_ACTIVE;

  const esp_err_t err = esp_wifi_scan_start(&cfg, true /* block */);
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "Scan failed: %s", esp_err_to_name(err));
    return {};
  }

  uint16_t found = 0;
  esp_wifi_scan_get_ap_num(&found);
  if (found == 0) return {};

  std::vector<wifi_ap_record_t> records(std::min<uint16_t>(found, kMaxResults));
  uint16_t wanted = static_cast<uint16_t>(records.size());
  if (esp_wifi_scan_get_ap_records(&wanted, records.data()) != ESP_OK) return {};
  records.resize(wanted);

  std::vector<AccessPoint> out;
  out.reserve(records.size());
  for (const wifi_ap_record_t &r : records) {
    AccessPoint ap;
    // The SSID field is not guaranteed to be terminated when it uses all 32
    // bytes, so the length is bounded rather than trusted.
    const size_t len = strnlen(reinterpret_cast<const char *>(r.ssid), sizeof(r.ssid));
    ap.ssid.assign(reinterpret_cast<const char *>(r.ssid), len);
    ap.rssi = r.rssi;
    ap.channel = r.primary;
    ap.auth = r.authmode;

    // One SSID on several access points is one network to a human. Keep the
    // strongest sighting; a list of six identical names says nothing about
    // which one you would actually associate with.
    const auto seen = std::find_if(out.begin(), out.end(), [&](const AccessPoint &existing) {
      return !existing.ssid.empty() && existing.ssid == ap.ssid;
    });
    if (seen != out.end()) {
      if (ap.rssi > seen->rssi) *seen = ap;
      continue;
    }
    out.push_back(std::move(ap));
  }

  std::sort(out.begin(), out.end(),
            [](const AccessPoint &a, const AccessPoint &b) { return a.rssi > b.rssi; });

  ESP_LOGI(TAG, "Scan found %u network(s)", static_cast<unsigned>(out.size()));
  return out;
}

const std::vector<AccessPoint> &cached() {
  return s_cached;
}

void cache(std::vector<AccessPoint> results) {
  s_cached = std::move(results);
}

const char *auth_name(wifi_auth_mode_t auth) {
  switch (auth) {
    case WIFI_AUTH_OPEN:
      return "open";
    case WIFI_AUTH_WEP:
      return "WEP";
    case WIFI_AUTH_WPA_PSK:
      return "WPA";
    case WIFI_AUTH_WPA2_PSK:
      return "WPA2";
    case WIFI_AUTH_WPA_WPA2_PSK:
      return "WPA/WPA2";
    case WIFI_AUTH_ENTERPRISE:
      return "enterprise";
    case WIFI_AUTH_WPA3_PSK:
      return "WPA3";
    case WIFI_AUTH_WPA2_WPA3_PSK:
      return "WPA2/WPA3";
    case WIFI_AUTH_WAPI_PSK:
      return "WAPI";
    case WIFI_AUTH_OWE:
      return "OWE";
    default:
      return "?";
  }
}

int bars(int8_t rssi) {
  if (rssi >= -55) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}

}  // namespace wifi_scan
