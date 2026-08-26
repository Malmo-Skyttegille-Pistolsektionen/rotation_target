#include "config/hardware_store.h"
#include "setup_portal.h"

#include <cstring>
#include <string>
#include <vector>

#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
// Must follow esp_netif.h: the vendored dns_server.h uses esp_ip4_addr_t
// without including the header that declares it, and it stays byte-identical
// to upstream, so the ordering is fixed here rather than there.
#include "dns_server.h"
#include "ssid_choice.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "json_util.h"
#include "boot_button.h"
#include "rgb_led.h"
#include "wifi_scan.h"
#include "wifi_store.h"

namespace setup_portal {
namespace {

const char *TAG = "setup";

// Deliberately its own server rather than the API's: nothing else on the
// device is reachable or meaningful in this state, and keeping the two apart
// means no API route can ever be exposed on an open setup AP.
httpd_handle_t s_httpd = nullptr;

const char kPageHead[] = R"HTML(<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rotation Target Setup</title><style>
body{font-family:system-ui,sans-serif;margin:0;padding:1.5rem;background:#111;color:#eee}
h1{font-size:1.25rem}form{max-width:22rem}label{display:block;margin:1rem 0 .25rem}
input,select{width:100%;padding:.6rem;font-size:1rem;border:1px solid #444;border-radius:.3rem;
background:#1c1c1c;color:#eee;box-sizing:border-box}
button{margin-top:1.25rem;width:100%;padding:.7rem;font-size:1rem;border:0;border-radius:.3rem;
background:#2d7;color:#000;font-weight:600}
p{color:#aaa;font-size:.85rem;line-height:1.4}
.hint{margin:.3rem 0 0}
.pw{position:relative}
.pw input{padding-right:4.5rem}
.pw button{position:absolute;right:.35rem;top:50%;transform:translateY(-50%);width:auto;
margin:0;padding:.35rem .55rem;font-size:.8rem;background:#333;color:#eee;font-weight:400}
.step{color:#eee;background:#1c1c1c;border-left:.2rem solid #2d7;padding:.6rem .7rem;
margin-top:1.25rem}
</style></head><body>
<h1>Rotation Target Setup</h1>
<p>This device could not join a network. Choose the WiFi it should use.
It will save the details and restart.</p>
<form method="POST" action="/save">
<label for="pick">Network</label>
<select id="pick" name="picked">)HTML";

// Spliced between the two halves: one <option> per network the scan found.
const char kPageTail[] = R"HTML(</select>
<p class="hint"><a href="/rescan" style="color:#2d7">Rescan networks</a></p>
<label for="s">Or type the network name</label>
<input id="s" name="ssid_manual" maxlength="32" autocapitalize="none" autocorrect="off"
spellcheck="false" placeholder="Network name (optional)">
<p class="hint">For a hidden network, or one the scan did not find. What you type here is
used instead of the choice above.</p>
<label for="p">Password</label>
<div class="pw">
<input id="p" name="password" type="password" maxlength="63" autocapitalize="none"
autocorrect="off" spellcheck="false">
<button type="button" id="eye" onclick="reveal()" aria-controls="p" aria-pressed="false"
aria-label="Show password">Show</button>
</div>
<p class="step"><b>Then press the BOOT button on the device</b> before saving.
It is next to the USB sockets, marked BOOT or FLASH. This is what proves you are
standing at the device rather than merely in range of it.</p>
<button type="submit">Save and restart</button></form>
<script>
// The only scripted behaviour on this page, and nothing depends on it: with
// JavaScript off the password simply stays hidden and the form still submits.
// Which network was asked for is decided on the device (rt::chosen_ssid), not
// here - the previous version needed script to reveal a field, and when that
// failed there was no way to name a hidden network at all.
function reveal(){
  var field = document.getElementById('p');
  var button = document.getElementById('eye');
  var showing = field.type === 'password';
  field.type = showing ? 'text' : 'password';
  // The label says what the button will do next, and aria-pressed says what
  // the state is now - a screen reader needs both.
  button.textContent = showing ? 'Hide' : 'Show';
  button.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
  button.setAttribute('aria-pressed', showing ? 'true' : 'false');
}
</script>
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

// An SSID is arbitrary bytes chosen by somebody else, and it lands inside both
// an attribute and element text. Escaped character by character rather than
// with sequential replaces, which double-escape the entities they just
// inserted - the bug AutoLee hit when '&' was added to its list last.
std::string html_escape(const std::string &in) {
  std::string out;
  out.reserve(in.size());
  for (const char c : in) {
    switch (c) {
      case '&':
        out += "&amp;";
        break;
      case '"':
        out += "&quot;";
        break;
      case '\'':
        out += "&#39;";
        break;
      case '<':
        out += "&lt;";
        break;
      case '>':
        out += "&gt;";
        break;
      default:
        out += c;
    }
  }
  return out;
}

// The <option> list, strongest first, from the scan taken before the AP went up.
std::string network_options() {
  // Collapsed here rather than in the scan: the pick-list wants one entry per
  // name, while the serial survey wants every radio.
  const std::vector<wifi_scan::AccessPoint> found =
      wifi_scan::strongest_per_ssid(wifi_scan::cached());

  std::string out = "<option value=\"\">";
  out += found.empty() ? "-- no networks found --" : "-- choose a network --";
  out += "</option>";

  for (const wifi_scan::AccessPoint &ap : found) {
    // A hidden network has no name to put in the list; "Other" covers it.
    if (ap.ssid.empty()) continue;
    const std::string safe = html_escape(ap.ssid);
    // Appended rather than concatenated: each `+` on the chain allocated a
    // temporary the next one immediately copied, once per network in range.
    out += "<option value=\"";
    out += safe;
    out += "\">";
    out += safe;
    out += " (";
    out += std::to_string(ap.rssi);
    out += " dBm, ";
    out += wifi_scan::auth_name(ap.auth);
    out += ")</option>";
  }

  // No "Other" entry, and no sentinel. It used to carry U+0001 so that a
  // network genuinely called "Other" could not collide with it - sound
  // reasoning, defeated by the transport: a control character in an HTML
  // attribute is a parse error, browsers are not obliged to preserve it, and
  // the reveal it was meant to trigger never fired. The text field below the
  // list is always visible now, so there is no mode to signal.
  return out;
}

esp_err_t serve_page(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html");
  httpd_resp_sendstr_chunk(req, kPageHead);
  httpd_resp_sendstr_chunk(req, network_options().c_str());
  httpd_resp_sendstr_chunk(req, kPageTail);
  return httpd_resp_sendstr_chunk(req, nullptr);
}

// Re-runs the scan and returns to the page. The reason it exists: somebody
// diagnosing a marginal signal moves the board or the access point and wants to
// see what changed, and power-cycling to refresh a list is a poor answer.
esp_err_t rescan(httpd_req_t *req) {
  wifi_scan::cache(wifi_scan::scan());
  httpd_resp_set_status(req, "303 See Other");
  httpd_resp_set_hdr(req, "Location", "/");
  return httpd_resp_send(req, nullptr, 0);
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

  // Before the credentials are even read: whoever is submitting has to have
  // pressed the button. The setup AP's password is compile-time and identical
  // on every device, and this repository is public, so being *on* this network
  // proves nothing (#208). A press proves physical access, which is the
  // property actually wanted - and it cannot be had over the air, by anyone,
  // at any distance.
  //
  // Checked on a build that has the button. Without one there is nothing to
  // press, and refusing every submission would make the device unrecoverable.
  if (boot_button::available() && !boot_button::consume_press()) {
    ESP_LOGW(TAG, "Credential submission refused: no button press");
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req,
                    "<!doctype html><meta charset=\"utf-8\">"
                    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                    "<body style=\"font-family:system-ui,sans-serif;margin:0;padding:1.5rem;"
                    "background:#111;color:#eee\">"
                    "<h1 style=\"font-size:1.25rem\">Press the button first</h1>"
                    "<p>Press the <b>BOOT</b> button on the device - it is next to the USB "
                    "sockets, and may be marked <b>FLASH</b> - then go back and save again.</p>"
                    "<p>Nothing has been saved. This step proves somebody is standing at the "
                    "device, which is why it cannot be done from the network.</p>"
                    "<p><a style=\"color:#2d7\" href=\"/\">Back</a></p>",
                    HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
  }

  const std::string ssid =
      rt::chosen_ssid(form_field(body, "picked"), form_field(body, "ssid_manual"));
  const std::string password = form_field(body, "password");

  if (ssid.empty() || ssid.size() > 32 || password.size() > 63) {
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req,
                    "<p>Choose a network from the list, or type its name. "
                    "<a href=\"/\">Back</a></p>",
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
  snprintf(ssid, sizeof(ssid), "%s-setup-%02X%02X", hardware_store::current().hostname.c_str(),
           mac[4], mac[5]);

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

  // APSTA, not plain AP. `esp_wifi_scan_start()` needs the station interface
  // active: in pure AP mode every scan fails, so the network list on the page
  // could never be refreshed once the access point was up. The station side is
  // never connected here - it exists so the radio can still listen.
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));

  // The station path disables modem sleep for SSE latency; here it is for the
  // AP's life. With the default power save and an idle station interface, the
  // modem sleeps against a DTIM schedule no AP is providing, and the SoftAP's
  // beacons become erratic to absent - observed as a portal that three client
  // devices could see for a short window after boot and never again.
  ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

  // `esp_wifi_init()` loads whatever station config the driver previously
  // persisted into its in-RAM copy. The moment APSTA brings the station
  // interface up, the driver tries to associate with that stale network - and
  // a device that quietly rejoins the old network while still serving its
  // setup portal is in two states at once. Clearing it is what stops that.
  wifi_config_t empty_sta = {};
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &empty_sta));

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
  static const httpd_uri_t scan = {"/rescan", HTTP_GET, rescan, nullptr, false, false, nullptr};
  static const httpd_uri_t any = {"/*", HTTP_GET, redirect, nullptr, false, false, nullptr};
  httpd_register_uri_handler(s_httpd, &root);
  httpd_register_uri_handler(s_httpd, &post);
  httpd_register_uri_handler(s_httpd, &scan);
  httpd_register_uri_handler(s_httpd, &any);
}

}  // namespace

void run() {
  rgb_led::status_portal();
  start_ap();

  // After the AP, which APSTA makes possible. The first list is ready before
  // anybody can have joined and asked for the page.
  wifi_scan::cache(wifi_scan::scan());

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
