#include "setup_portal.h"

#include <cstring>
#include <string>

#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
// Must follow esp_netif.h: the vendored dns_server.h uses esp_ip4_addr_t
// without including the header that declares it, and it stays byte-identical
// to upstream, so the ordering is fixed here rather than there.
#include "dns_server.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "json_util.h"
#include "rgb_led.h"
#include "wifi_store.h"

namespace setup_portal {
namespace {

const char *TAG = "setup";

// Deliberately its own server rather than the API's: nothing else on the
// device is reachable or meaningful in this state, and keeping the two apart
// means no API route can ever be exposed on an open setup AP.
httpd_handle_t s_httpd = nullptr;

const char kPage[] = R"HTML(<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rotation target setup</title><style>
body{font-family:system-ui,sans-serif;margin:0;padding:1.5rem;background:#111;color:#eee}
h1{font-size:1.25rem}form{max-width:22rem}label{display:block;margin:1rem 0 .25rem}
input{width:100%;padding:.6rem;font-size:1rem;border:1px solid #444;border-radius:.3rem;
background:#1c1c1c;color:#eee;box-sizing:border-box}
button{margin-top:1.25rem;width:100%;padding:.7rem;font-size:1rem;border:0;border-radius:.3rem;
background:#2d7;color:#000;font-weight:600}
p{color:#aaa;font-size:.85rem;line-height:1.4}
</style></head><body>
<h1>Rotation target setup</h1>
<p>This device could not join a network. Enter the WiFi it should use.
It will save the details and restart.</p>
<form method="POST" action="/save">
<label for="s">Network name (SSID)</label><input id="s" name="ssid" required maxlength="32">
<label for="p">Password</label><input id="p" name="password" type="password" maxlength="63">
<button type="submit">Save and restart</button></form>
</body></html>)HTML";

// Percent-decoding for application/x-www-form-urlencoded. A WiFi password can
// legitimately contain '+', '%' and every other reserved character, so the
// decode has to be real rather than a strip.
std::string url_decode(const std::string &in) {
  std::string out;
  out.reserve(in.size());
  for (size_t i = 0; i < in.size(); i++) {
    if (in[i] == '+') {
      out += ' ';
    } else if (in[i] == '%' && i + 2 < in.size()) {
      const auto hex = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
      };
      const int hi = hex(in[i + 1]);
      const int lo = hex(in[i + 2]);
      if (hi < 0 || lo < 0) {
        out += in[i];
        continue;
      }
      out += static_cast<char>(hi * 16 + lo);
      i += 2;
    } else {
      out += in[i];
    }
  }
  return out;
}

std::string form_field(const std::string &body, const std::string &name) {
  const std::string key = name + "=";
  size_t pos = 0;
  while (pos < body.size()) {
    const size_t end = body.find('&', pos);
    const std::string pair = body.substr(pos, end == std::string::npos ? end : end - pos);
    if (pair.compare(0, key.size(), key) == 0) return url_decode(pair.substr(key.size()));
    if (end == std::string::npos) break;
    pos = end + 1;
  }
  return {};
}

esp_err_t serve_page(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, kPage, HTTPD_RESP_USE_STRLEN);
}

// Every captive-portal probe gets a redirect to the page, which is what makes
// phones pop the "sign in to network" sheet instead of reporting no internet.
esp_err_t redirect(httpd_req_t *req) {
  httpd_resp_set_status(req, "302 Found");
  httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
  return httpd_resp_send(req, nullptr, 0);
}

esp_err_t save(httpd_req_t *req) {
  // Bounded: an SSID is at most 32 bytes and a WPA2 passphrase 63, so a body
  // beyond this is not a form we should be reading into RAM.
  if (req->content_len > 512) {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Body too large");
    return ESP_FAIL;
  }

  std::string body(req->content_len, '\0');
  int received = 0;
  while (received < req->content_len) {
    const int n = httpd_req_recv(req, &body[received], req->content_len - received);
    if (n <= 0) {
      httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Truncated body");
      return ESP_FAIL;
    }
    received += n;
  }

  const std::string ssid = form_field(body, "ssid");
  const std::string password = form_field(body, "password");

  if (ssid.empty() || ssid.size() > 32 || password.size() > 63) {
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, "<p>Invalid network name or password. <a href=\"/\">Back</a></p>",
                    HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
  }

  if (!wifi_store::save(ssid, password)) {
    httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Could not save");
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "text/html");
  httpd_resp_send(req, "<p>Saved. The device is restarting and will join that network.</p>",
                  HTTPD_RESP_USE_STRLEN);

  // Long enough for the response to leave the socket before the reset.
  vTaskDelay(pdMS_TO_TICKS(1500));
  ESP_LOGI(TAG, "Credentials saved - restarting");
  esp_restart();
}

void start_ap() {
  ESP_ERROR_CHECK(esp_netif_init());
  // The STA path may already have created it; either outcome is fine.
  esp_event_loop_create_default();
  esp_netif_create_default_wifi_ap();

  wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

  // The MAC suffix keeps two devices on one site distinguishable, which the
  // club has: there are two of these boards.
  uint8_t mac[6] = {};
  esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
  char ssid[33];
  snprintf(ssid, sizeof(ssid), "%s-setup-%02X%02X", CONFIG_RT_HOSTNAME, mac[4], mac[5]);

  wifi_config_t ap_cfg = {};
  strncpy(reinterpret_cast<char *>(ap_cfg.ap.ssid), ssid, sizeof(ap_cfg.ap.ssid));
  ap_cfg.ap.ssid_len = static_cast<uint8_t>(strlen(ssid));
  ap_cfg.ap.max_connection = 4;
  ap_cfg.ap.channel = 1;

  const std::string password = CONFIG_RT_SETUP_AP_PASSWORD;
  if (password.size() >= 8) {
    strncpy(reinterpret_cast<char *>(ap_cfg.ap.password), password.c_str(),
            sizeof(ap_cfg.ap.password));
    ap_cfg.ap.authmode = WIFI_AUTH_WPA2_PSK;
  } else {
    // WPA2 requires 8 characters; anything shorter would silently fail to
    // apply and leave the AP open without saying so.
    ESP_LOGW(TAG, "Setup AP password too short - the AP is OPEN");
    ap_cfg.ap.authmode = WIFI_AUTH_OPEN;
  }

  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_cfg));
  ESP_ERROR_CHECK(esp_wifi_start());

  ESP_LOGW(TAG, "Setup AP '%s' up - join it and browse to http://192.168.4.1", ssid);
}

void start_http() {
  httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
  cfg.max_uri_handlers = 8;
  cfg.lru_purge_enable = true;
  // A phone fires several connectivity probes in parallel the moment it joins.
  cfg.uri_match_fn = httpd_uri_match_wildcard;

  if (httpd_start(&s_httpd, &cfg) != ESP_OK) {
    ESP_LOGE(TAG, "Setup server failed to start");
    return;
  }

  static const httpd_uri_t root = {"/", HTTP_GET, serve_page, nullptr, false, false, nullptr};
  static const httpd_uri_t post = {"/save", HTTP_POST, save, nullptr, false, false, nullptr};
  static const httpd_uri_t any = {"/*", HTTP_GET, redirect, nullptr, false, false, nullptr};
  httpd_register_uri_handler(s_httpd, &root);
  httpd_register_uri_handler(s_httpd, &post);
  httpd_register_uri_handler(s_httpd, &any);
}

}  // namespace

void run() {
  rgb_led::status_portal();
  start_ap();

  // Answers every A query with our own address, so any hostname a phone probes
  // lands on the setup page.
  // ESP-IDF 6.0 turned on -Werror=missing-field-initializers, and the vendored
  // DNS_SERVER_CONFIG_SINGLE macro does not initialise every member. The header
  // stays byte-identical to upstream, so the suppression lives here.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
  static dns_server_config_t dns_cfg = DNS_SERVER_CONFIG_SINGLE("*", "WIFI_AP_DEF");
#pragma GCC diagnostic pop
  // The vendored server logs "Waiting for data" once per loop turn. Upstream
  // that is once per query; our local SO_RCVTIMEO of 250 ms - added so the task
  // can be stopped without deadlocking lwIP - makes it four lines a second,
  // forever. The portal is the recovery path, so the console has to stay
  // readable while it is up (#157). Errors and the address still print.
  esp_log_level_set("example_dns_redirect_server", ESP_LOG_WARN);
  start_dns_server(&dns_cfg);

  start_http();

  while (true) vTaskDelay(portMAX_DELAY);
}

}  // namespace setup_portal
