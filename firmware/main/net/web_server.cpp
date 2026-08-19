// ============================================================================
//  main/net/web_server.cpp
//  REST /api/v2 + SSE /sse/v2, the contract in docs/api-v2.md.
//  Ported route-for-route from src/backend/apis/api.py of the MicroPython
//  backend; Microdot's API swapped for PsychicHttp's.
// ============================================================================
#include "web_server.h"

#include <ArduinoJson.h>
#include <PsychicHttp.h>

#include <cstring>
#include <string>

#include "admin_mode.h"
#include "audio.h"
#include "audios.h"
#include "config.h"
#include "esp_app_desc.h"
#include "esp_core_dump.h"
#include "esp_heap_caps.h"
#include "esp_idf_version.h"
#include "esp_littlefs.h"
#include "esp_ota_ops.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "json_util.h"
#include "uri_path.h"
#include "program_executor.h"
#include "programs.h"
#include "sse_hub.h"
#include "storage.h"
#include "wifi_mgr.h"

namespace web_server {
namespace {

const char *TAG = "web_server";

PsychicHttpServer s_server;
PsychicUploadHandler s_audio_upload;

void esp_random_bytes(uint8_t *out, size_t len) {
  esp_fill_random(out, len);
}

rt::AdminMode s_admin(esp_random_bytes);

// --- response helpers ------------------------------------------------------

esp_err_t send_json(PsychicResponse *res, int code, const std::string &body) {
  return res->send(code, "application/json", body.c_str());
}

esp_err_t send_error(PsychicResponse *res, int code, const char *message) {
  return send_json(res, code, rt::json_error(message));
}

esp_err_t send_message(PsychicResponse *res, const std::string &message) {
  return send_json(res, 200, rt::json_message(message));
}

// --- auth ------------------------------------------------------------------

// Guards an endpoint that is only protected while admin mode is enabled.
// Returns false once it has already answered the request.
bool require_admin(PsychicRequest *req, PsychicResponse *res) {
  // header() and getCookie() both return PsychicRequest::_tmp.c_str() - one
  // per-request scratch string that each call overwrites - so the header has
  // to be copied out before the cookie is read, or it turns into the cookie.
  const char *raw = req->header("Authorization");
  const std::string authorization = raw != nullptr ? raw : "";

  std::string cookie;
  const char *raw_cookie = req->getCookie("admin");
  if (raw_cookie != nullptr) cookie = raw_cookie;

  if (s_admin.authorize(authorization, cookie)) return true;

  ESP_LOGD(TAG, "Rejected %s %s", req->methodStr(), req->uri());
  send_error(res, 401, "Invalid or missing admin credentials");
  return false;
}

// SameSite=Lax means the cookie only rides along when the webapp is served
// from the device itself; a webapp on another origin authenticates with the
// bearer token instead. Deliberately not HttpOnly - the webapp reads it back.
esp_err_t send_admin_session(PsychicResponse *res, const std::string &token) {
  const std::string cookie = "admin=" + token + "; Path=/; SameSite=Lax";
  res->addHeader("Set-Cookie", cookie.c_str());
  return send_json(res, 200, "{\"token\":" + rt::json_quote(token) + "}");
}

// The password from a JSON body, or empty when the body does not carry one.
std::string password_from(PsychicRequest *req) {
  const char *body = req->body();
  if (body == nullptr || *body == '\0') return {};

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return {};
  return doc["password"] | "";
}

// --- path parsing ---------------------------------------------------------

// rt::path_id does the work; see lib/rt_logic/uri_path.h. It lives there
// rather than here so host_test/test_uri_path can cover it - it is the
// security boundary for every {id} route.
using rt::path_id;

// --- routes ----------------------------------------------------------------

void register_admin_mode_routes() {
  s_server.on("/api/v2/admin-mode/status", HTTP_GET, [](PsychicRequest *, PsychicResponse *res) {
    return send_json(res, 200,
                     std::string("{\"enabled\":") + (s_admin.enabled() ? "true" : "false") + "}");
  });

  s_server.on("/api/v2/admin-mode/enable", HTTP_POST,
              [](PsychicRequest *req, PsychicResponse *res) {
                if (s_admin.enabled()) {
                  return send_error(res, 409,
                                    "Admin mode is already enabled. Log in or disable it "
                                    "before enabling again.");
                }
                const std::string token = s_admin.enable(password_from(req));
                if (token.empty()) return send_error(res, 401, "Invalid password");

                ESP_LOGI(TAG, "Admin mode enabled");
                return send_admin_session(res, token);
              });

  s_server.on("/api/v2/admin-mode/login", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!s_admin.enabled()) {
      return send_error(res, 409, "Admin mode is not enabled. Enable it before logging in.");
    }
    const std::string token = s_admin.login(password_from(req));
    if (token.empty()) return send_error(res, 401, "Invalid password");
    return send_admin_session(res, token);
  });

  s_server.on("/api/v2/admin-mode/disable", HTTP_POST,
              [](PsychicRequest *req, PsychicResponse *res) {
                if (!require_admin(req, res)) return ESP_OK;
                s_admin.disable();
                ESP_LOGI(TAG, "Admin mode disabled");
                return send_message(res, "Admin mode disabled");
              });
}

void register_program_routes() {
  // Registration order matters: esp_http_server matches wildcards in the order
  // handlers were added, so the fixed run-control paths must come before the
  // "/api/v2/programs/*" catch-all that carries {id}.
  s_server.on("/api/v2/programs/start", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;
    if (!executor::start()) return send_error(res, 400, "No program loaded");
    return send_message(res, "Program started");
  });

  s_server.on("/api/v2/programs/stop", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;
    if (!executor::stop()) return send_error(res, 400, "Program not running");
    return send_message(res, "Program paused");
  });

  s_server.on("/api/v2/programs/reset", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;
    if (!executor::reset()) return send_error(res, 400, "No program loaded");
    return send_message(res, "Program reset");
  });

  s_server.on("/api/v2/programs/series/*", HTTP_POST,
              [](PsychicRequest *req, PsychicResponse *res) {
                if (!require_admin(req, res)) return ESP_OK;

                int32_t index = 0;
                if (!path_id(req->uri(), "/api/v2/programs/series/", "/skip_to", index)) {
                  return send_error(res, 404, "Not found");
                }
                if (!executor::skip_to_series(index)) {
                  return send_error(res, 400, "No program loaded or series index out of bounds");
                }
                return send_message(res, "Skipped to series " + std::to_string(index));
              });

  s_server.on("/api/v2/programs", HTTP_GET, [](PsychicRequest *, PsychicResponse *res) {
    std::string out = "[";
    bool first = true;
    for (const auto &kv : programs::all()) {
      if (!first) out += ',';
      first = false;
      out += rt::program_summary_json(kv.second);
    }
    out += ']';
    return send_json(res, 200, out);
  });

  s_server.on("/api/v2/programs", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;

    const char *body = req->body();
    if (body == nullptr || *body == '\0') return send_error(res, 400, "Invalid program");

    const int32_t id = programs::add_uploaded(body, strlen(body));
    if (id < 0) return send_error(res, 400, "Invalid program");

    return send_json(res, 201, "{\"id\":" + std::to_string(id) + "}");
  });

  s_server.on("/api/v2/programs/*", HTTP_GET, [](PsychicRequest *req, PsychicResponse *res) {
    int32_t id = 0;
    if (!path_id(req->uri(), "/api/v2/programs/", "", id)) {
      return send_error(res, 404, "Program not found");
    }
    const rt::Program *program = programs::get(id);
    if (program == nullptr) return send_error(res, 404, "Program not found");

    return send_json(res, 200, rt::program_json(*program));
  });

  s_server.on("/api/v2/programs/*", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;

    int32_t id = 0;
    if (!path_id(req->uri(), "/api/v2/programs/", "/load", id)) {
      return send_error(res, 404, "Not found");
    }
    if (!executor::load(id)) return send_error(res, 404, "Program not found");
    return send_message(res, "Program loaded");
  });

  s_server.on("/api/v2/programs/*", HTTP_DELETE, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;

    int32_t id = 0;
    if (!path_id(req->uri(), "/api/v2/programs/", "/delete", id)) {
      return send_error(res, 404, "Not found");
    }
    // Unload first: dropping the program while the run loop holds a pointer to
    // it would dangle, and the client needs the stateUpdate either way.
    executor::unload_if_loaded(id);
    if (!programs::remove(id)) return send_error(res, 404, "Program not found");

    return send_message(res, "Program deleted successfully");
  });
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
    default:
      return "unknown";
  }
}

// Answers "what happened to the device last Tuesday" without a USB cable.
// Deliberately public, like every other GET: it carries no credential and no
// program data - only the firmware's own identity and health. The coredump
// itself is NOT exposed here; it is a raw RAM snapshot and can contain the
// WiFi password, so retrieving it stays an out-of-band, physical-access job.
void register_diagnostics_routes() {
  s_server.on("/api/v2/diagnostics/info", HTTP_GET, [](PsychicRequest *, PsychicResponse *res) {
    const esp_app_desc_t *desc = esp_app_get_description();
    const esp_partition_t *running = esp_ota_get_running_partition();

    size_t fs_total = 0, fs_used = 0;
    esp_littlefs_info("storage", &fs_total, &fs_used);

    // ESP_OK means an image is waiting to be pulled; anything else
    // (including "no coredump") is reported as absent.
    size_t dump_addr = 0, dump_size = 0;
    const bool coredump = esp_core_dump_image_get(&dump_addr, &dump_size) == ESP_OK;

    std::string out = "{\"version\":";
    out += rt::json_quote(desc->version);
    out += ",\"idfVersion\":";
    out += rt::json_quote(IDF_VER);
    out += ",\"buildDate\":";
    out += rt::json_quote(std::string(desc->date) + " " + desc->time);
    out += ",\"resetReason\":";
    out += rt::json_quote(reset_reason_name(esp_reset_reason()));
    out += ",\"uptimeSeconds\":";
    out += std::to_string(esp_timer_get_time() / 1000000);
    out += ",\"freeHeapBytes\":";
    out += std::to_string(esp_get_free_heap_size());
    // The low-water mark, not the current free figure: a leak that
    // has already been reclaimed is invisible in the latter.
    out += ",\"minFreeHeapBytes\":";
    out += std::to_string(esp_get_minimum_free_heap_size());
    out += ",\"freePsramBytes\":";
    out += std::to_string(heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
    out += ",\"runningPartition\":";
    out += rt::json_quote(running != nullptr ? running->label : "unknown");
    out += ",\"coredumpPresent\":";
    out += coredump ? "true" : "false";
    out += ",\"storageTotalBytes\":";
    out += std::to_string(fs_total);
    out += ",\"storageUsedBytes\":";
    out += std::to_string(fs_used);
    out += ",\"programCount\":";
    out += std::to_string(programs::all().size());
    out += ",\"audioCount\":";
    out += std::to_string(audios::all().size());
    out += ",\"ipAddress\":";
    out += rt::json_quote(wifi_mgr::ip_address());
    out += ",\"adminModeEnabled\":";
    out += s_admin.enabled() ? "true" : "false";
    out += "}";

    return send_json(res, 200, out);
  });
}

void register_target_routes() {
  s_server.on("/api/v2/targets/show", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;
    executor::set_targets(true);
    return send_message(res, "Targets shown");
  });

  s_server.on("/api/v2/targets/hide", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;
    executor::set_targets(false);
    return send_message(res, "Targets hidden");
  });

  s_server.on("/api/v2/targets/toggle", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;
    const bool shown = executor::toggle_targets();
    return send_message(res, shown ? "Targets shown" : "Targets hidden");
  });
}

void register_audio_routes() {
  s_server.on("/api/v2/audios", HTTP_GET, [](PsychicRequest *, PsychicResponse *res) {
    return send_json(res, 200, audios::list_json());
  });

  s_server.on("/api/v2/audios/*", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;

    int32_t id = 0;
    if (!path_id(req->uri(), "/api/v2/audios/", "/play", id)) {
      return send_error(res, 404, "Not found");
    }
    const audios::Audio *clip = audios::get(id);
    if (clip == nullptr) return send_error(res, 404, "Audio not found");

    // Acknowledged immediately and played in the background: holding the
    // response open for the length of the clip blocked the client for its
    // whole duration in v1.
    audio::play({clip->path});
    return send_json(res, 200,
                     "{\"message\":\"Playback started\",\"audioId\":" + std::to_string(id) + "}");
  });

  s_server.on("/api/v2/audios/*", HTTP_DELETE, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;

    int32_t id = 0;
    if (!path_id(req->uri(), "/api/v2/audios/", "/delete", id)) {
      return send_error(res, 404, "Not found");
    }
    if (!audios::remove(id)) return send_error(res, 404, "Audio not found");
    return send_message(res, "Audio deleted successfully");
  });

  // Streamed straight to LittleFS rather than buffered: a WAV is far larger
  // than the heap can hold in one piece.
  s_audio_upload.onUpload([](PsychicRequest *req, const char *filename, uint64_t index,
                             uint8_t *data, size_t len, bool final) -> esp_err_t {
    if (filename == nullptr || *filename == '\0') return ESP_FAIL;
    // Reject any path separator: the filename comes from the client and is
    // about to be concatenated into a path.
    if (strchr(filename, '/') != nullptr || strstr(filename, "..") != nullptr) return ESP_FAIL;

    const std::string path = std::string(kUploadAudioDir) + "/" + filename;
    storage::make_dirs(kUploadAudioDir);

    FILE *f = fopen(path.c_str(), index == 0 ? "wb" : "ab");
    if (f == nullptr) return ESP_FAIL;
    const size_t written = fwrite(data, 1, len, f);
    fclose(f);
    if (written != len) return ESP_FAIL;

    if (final) req->setSessionKey("upload_filename", filename);
    return ESP_OK;
  });

  // Gated as handler middleware, not inside onRequest: PsychicHandler::process
  // runs the chain before handleRequest, and handleRequest is what streams the
  // body to flash. Checking afterwards would let an unauthenticated caller
  // write a file and only then be told no.
  s_audio_upload.addMiddleware(
      [](PsychicRequest *req, PsychicResponse *res, PsychicMiddlewareNext next) -> esp_err_t {
        if (!require_admin(req, res)) return ESP_OK;
        return next();
      });

  s_audio_upload.onRequest([](PsychicRequest *req, PsychicResponse *res) -> esp_err_t {
    PsychicWebParameter *title = req->hasParam("title") ? req->getParam("title", false) : nullptr;
    if (title == nullptr) return send_error(res, 400, "Missing title or codec");

    const char *filename =
        req->hasSessionKey("upload_filename") ? req->getSessionKey("upload_filename") : nullptr;
    if (filename == nullptr || *filename == '\0') return send_error(res, 400, "No file uploaded");

    // Rejected here rather than at the first byte: the file is already on
    // flash, so it is removed again before the caller is told it is unusable.
    rt::WavInfo info;
    const std::string path = std::string(kUploadAudioDir) + "/" + filename;
    if (!audio::probe_wav(path.c_str(), info)) {
      ::remove(path.c_str());
      return send_error(res, 400, "Unsupported audio format");
    }

    const int32_t id = audios::add_uploaded(title->value(), filename);
    if (id < 0) return send_error(res, 500, "Failed to add audio");

    return send_json(res, 201, "{\"id\":" + std::to_string(id) + "}");
  });

  s_server.on("/api/v2/audios", HTTP_POST, &s_audio_upload);
}

// Serves the built webapp from LittleFS when one has been uploaded. Kept last
// so it never shadows an API route.
void register_static_routes() {
  // The native ESP-IDF overload takes a POSIX path; the fs::FS one is
  // Arduino-only (see lib/psychic_http/src/PsychicFS.h).
  s_server.serveStatic("/", "/storage/webapp/")->setDefaultFile("index.html");
}

}  // namespace

void start() {
  // Must stay above the real registration count; a failed registration is only
  // an "Add endpoint failed" log line, trivially missed.
  s_server.config.max_uri_handlers = 32;
  // Every connected client holds a socket open indefinitely for /sse/v2 on top
  // of its REST traffic. Bounded by LWIP: httpd requires
  // max_open_sockets <= CONFIG_LWIP_MAX_SOCKETS - 3, and sdkconfig.defaults
  // sets that to 16 - raise the two together or httpd_start() fails.
  s_server.config.max_open_sockets = 12;
  s_server.config.lru_purge_enable = true;

  // Credentialed CORS. The webapp sends the admin cookie and bearer token with
  // every call, and a browser refuses `Access-Control-Allow-Origin: *` on a
  // credentialed request - so the request's own Origin is reflected back.
  // PsychicHttp's built-in CorsMiddleware only emits a fixed origin, which is
  // why this is hand-rolled.
  s_server.addMiddleware(
      [](PsychicRequest *req, PsychicResponse *res, PsychicMiddlewareNext next) -> esp_err_t {
        const char *origin = req->header("Origin");
        if (origin != nullptr && *origin != '\0') {
          const std::string reflected = origin;
          res->addHeader("Access-Control-Allow-Origin", reflected.c_str());
          res->addHeader("Access-Control-Allow-Credentials", "true");
          res->addHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
          res->addHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
          res->addHeader("Access-Control-Max-Age", "600");
          res->addHeader("Vary", "Origin");
        }
        return next();
      });

  s_server.setPort(kHttpPort);

  // Preflight. Registered as a catch-all because nothing else answers OPTIONS,
  // and a preflight that 404s fails the real request that follows it.
  s_server.on("/*", HTTP_OPTIONS,
              [](PsychicRequest *, PsychicResponse *res) { return res->send(204); });

  s_server.on("/api/v2/version", HTTP_GET, [](PsychicRequest *, PsychicResponse *res) {
    // Derived from git via esp_app_desc_t, not a hand-maintained constant -
    // see CLAUDE.md's Conventions. The three-part split is what the webapp
    // expects; a non-semver describe output degrades to zeroes rather than
    // failing the call.
    const esp_app_desc_t *desc = esp_app_get_description();
    unsigned major = 0, minor = 0, patch = 0;
    sscanf(desc->version, "%u.%u.%u", &major, &minor, &patch);

    return send_json(res, 200,
                     "{\"major\":" + std::to_string(major) + ",\"minor\":" + std::to_string(minor) +
                         ",\"patch\":" + std::to_string(patch) + "}");
  });

  register_admin_mode_routes();
  register_program_routes();
  register_diagnostics_routes();
  register_target_routes();
  register_audio_routes();

  sse_hub::attach(s_server, "/sse/v2");

  register_static_routes();

  // Routes are registered against the server object first and bound when it
  // starts, so nothing can arrive at a half-registered surface.
  s_server.start();

  ESP_LOGI(TAG, "HTTP server listening on port %u", kHttpPort);
}

}  // namespace web_server
