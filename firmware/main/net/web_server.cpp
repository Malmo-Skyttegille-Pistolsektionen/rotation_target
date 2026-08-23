// ============================================================================
//  main/net/web_server.cpp
//  REST /api/v2 + SSE /sse/v2, the contract in docs/api-v2.md.
//  Ported route-for-route from src/backend/apis/api.py of the MicroPython
//  backend; Microdot's API swapped for PsychicHttp's.
// ============================================================================
#include "web_server.h"

#include "ota.h"

#include <ArduinoJson.h>
#include <PsychicHttp.h>

#include <sys/stat.h>

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
#include "partitions.h"
#include "esp_ota_ops.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "issue_buffer.h"
#include "json_util.h"
#include "net_mgr.h"
#include "problem.h"
#include "uri_path.h"
#include "program_executor.h"
#include "programs.h"
#include "sse_hub.h"
#include "storage.h"
#include "targets.h"

namespace web_server {
namespace {

const char *TAG = "web_server";

PsychicHttpServer s_server;
PsychicUploadHandler s_audio_upload;

// Uploads land here first and are renamed to <id>.wav once validated.
constexpr const char *kStagedUploadPath = "/storage/uploads/audio/.staging";

// Set while a request body is being streamed to the staging file, cleared by
// the handler's onRequest. Still set outside a request means the last upload
// died mid-body.
bool s_upload_in_flight = false;

// Bytes taken by the upload in flight, counted against kMaxUploadBytes. The
// server-wide ceiling is sized for firmware, so audio bounds itself.
size_t s_upload_bytes = 0;

// Drops whatever a previous upload left staged. Safe to call outside a
// request: every completion path either renames the staging file into the
// repository or removes it, so a survivor is always dead weight.
void discard_dead_upload() {
  if (s_upload_in_flight) {
    ESP_LOGW(TAG, "Previous upload died mid-body - discarding its staged bytes");
    s_upload_in_flight = false;
  }
  ::remove(kStagedUploadPath);
}

void esp_random_bytes(uint8_t *out, size_t len) {
  esp_fill_random(out, len);
}

int64_t now_ms() {
  return esp_timer_get_time() / 1000;
}

rt::AdminMode s_admin(esp_random_bytes, now_ms);

// --- response helpers ------------------------------------------------------

esp_err_t send_json(PsychicResponse *res, int code, const std::string &body) {
  return res->send(code, "application/json", body.c_str());
}

// Every failure answers an RFC 9457 problem detail (D-19). The status comes
// from the type, so a `type` and the status it is served with can never drift
// apart - which is what makes the per-operation type lists in
// contracts/openapi.yaml exact.
esp_err_t send_problem(PsychicResponse *res, const rt::ProblemType &type,
                       const std::string &detail) {
  return res->send(type.status, rt::kProblemContentType, rt::problem_json(type, detail).c_str());
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
  send_problem(res, rt::problem::kAdminCredentialsRequired, "Invalid or missing admin credentials");
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

// The program id from a `{"id": N}` body, shared by `start` (#95) and
// `skip_to` (#105). False when the body is absent, is not JSON, or carries no
// integer `id` - the caller turns that into a `400`. The id is required
// rather than optional: an id-less call is exactly the ambiguity these two
// remove, and accepting one would keep a way to ask the device to act on
// whatever it happens to hold.
bool body_program_id(PsychicRequest *req, int32_t &out) {
  const char *body = req->body();
  if (body == nullptr || *body == '\0') return false;

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return false;

  JsonVariantConst id = doc["id"];
  if (!id.is<int32_t>()) return false;
  out = id.as<int32_t>();
  return true;
}

// Origins the webapp may legitimately be served from: the device itself by
// mDNS name or by whatever address it currently holds, plus an optional
// development origin. Anything else gets no CORS headers, so the browser
// blocks the response.
bool origin_allowed(const std::string &origin) {
  const std::string host = std::string(CONFIG_RT_HOSTNAME);
  if (origin == "http://" + host + ".local" || origin == "https://" + host + ".local") return true;

  const std::string ip = net_mgr::ip_address();
  if (!ip.empty() && (origin == "http://" + ip || origin == "https://" + ip)) return true;

  const std::string dev = CONFIG_RT_DEV_ORIGIN;
  if (!dev.empty() && origin == dev) return true;

  return false;
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
                  return send_problem(res, rt::problem::kAdminModeAlreadyEnabled,
                                      "Admin mode is already enabled. Log in or disable it "
                                      "before enabling again.");
                }
                const std::string token = s_admin.enable(password_from(req));
                if (token.empty())
                  return send_problem(res, rt::problem::kInvalidPassword, "Invalid password");

                ESP_LOGI(TAG, "Admin mode enabled");
                return send_admin_session(res, token);
              });

  s_server.on("/api/v2/admin-mode/login", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!s_admin.enabled()) {
      return send_problem(res, rt::problem::kAdminModeNotEnabled,
                          "Admin mode is not enabled. Enable it before logging in.");
    }
    const std::string token = s_admin.login(password_from(req));
    if (token.empty()) return send_problem(res, rt::problem::kInvalidPassword, "Invalid password");
    return send_admin_session(res, token);
  });

  s_server.on("/api/v2/admin-mode/logout", HTTP_POST,
              [](PsychicRequest *req, PsychicResponse *res) {
                // Ends this session only. disable() turns protection off
                // entirely, which is the opposite of what a client logging out
                // of a shared range laptop wants.
                const char *header = req->header("Authorization");
                std::string token = rt::AdminMode::bearer_token(header != nullptr ? header : "");
                if (token.empty()) {
                  const char *cookie = req->getCookie("admin");
                  if (cookie != nullptr) token = cookie;
                }
                s_admin.logout(token);
                res->addHeader("Set-Cookie", "admin=; Path=/; SameSite=Lax; Max-Age=0");
                return send_message(res, "Logged out");
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

  // #95: the body names the program the caller decided to start, and a device
  // holding a different one refuses. No client-side check can close this - the
  // program can change between a client's last stateUpdate and its start
  // arriving - and starting the wrong one on a range is wrong target timing and
  // wrong spoken commands. Same shape as #79 and #80: the device enforces, the
  // client only explains.
  s_server.on("/api/v2/programs/start", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;

    // The reciprocal of the OTA's own refusal: an upload is in flight and a
    // restart is moments away, so a program started now would be cut off
    // part-way through a sequence with targets already moving.
    if (ota::in_progress()) {
      return send_problem(res, rt::problem::kProgramRunning,
                          "A firmware update is in progress - wait for the device to restart");
    }

    int32_t expected_id = 0;
    if (!body_program_id(req, expected_id)) {
      return send_problem(res, rt::problem::kStartIdRequired,
                          "Expected a JSON body naming the program to start: {\"id\": <id>}");
    }

    const executor::StartOutcome outcome = executor::start(expected_id);
    switch (outcome.result) {
      case rt::StartResult::kNotLoaded:
        return send_problem(res, rt::problem::kNoProgramLoaded, "No program loaded");
      case rt::StartResult::kMismatch:
        // Both ids, because the operator has to know what the device actually
        // holds to decide what to do about it.
        return send_problem(res, rt::problem::kStartProgramMismatch,
                            "Start refused: the device has program " +
                                std::to_string(outcome.loaded_program_id) +
                                " loaded, not program " + std::to_string(expected_id));
      case rt::StartResult::kStarted:
        break;
    }
    return send_message(res, "Program started");
  });

  s_server.on("/api/v2/programs/stop", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;
    if (!executor::stop())
      return send_problem(res, rt::problem::kProgramNotRunning, "Program not running");
    return send_message(res, "Program paused");
  });

  s_server.on("/api/v2/programs/reset", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;
    if (!executor::reset())
      return send_problem(res, rt::problem::kNoProgramLoaded, "No program loaded");
    return send_message(res, "Program reset");
  });

  s_server.on("/api/v2/programs/unload", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;

    // Refused mid-run rather than stopping the run itself: unloading is
    // bookkeeping, and a call that reads as bookkeeping must not end a series
    // in progress. Nothing loaded answers 200 with the same message - the
    // caller asked for a state this already is - and publishes nothing,
    // because the payload would repeat the last one sent.
    if (executor::unload() == rt::UnloadResult::kRunning) {
      return send_problem(res, rt::problem::kProgramRunning,
                          "A program is running - stop it before unloading");
    }
    return send_message(res, "Program unloaded");
  });

  // #105: same shape as #95's start above - the body names the program the
  // index is for, and a device holding a different one refuses. skip_to arms
  // rather than runs, so the immediate consequence is a confusing UI state
  // rather than targets moving; the id check still closes it, for one rule on
  // run control rather than two.
  s_server.on(
      "/api/v2/programs/series/*", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
        if (!require_admin(req, res)) return ESP_OK;

        int32_t index = 0;
        if (!path_id(req->uri(), "/api/v2/programs/series/", "/skip_to", index)) {
          return send_problem(res, rt::problem::kRouteNotFound, "Not found");
        }

        int32_t expected_id = 0;
        if (!body_program_id(req, expected_id)) {
          return send_problem(res, rt::problem::kSkipIdRequired,
                              "Expected a JSON body naming the program to skip: {\"id\": <id>}");
        }

        const executor::SkipOutcome outcome = executor::skip_to_series(index, expected_id);
        switch (outcome.result) {
          case rt::SkipResult::kInvalid:
            return send_problem(res, rt::problem::kSeriesIndexInvalid,
                                "No program loaded or series index out of bounds");
          case rt::SkipResult::kMismatch:
            // Both ids, same reasoning as start's 409: the operator has
            // to know what the device actually holds.
            return send_problem(res, rt::problem::kSkipProgramMismatch,
                                "Skip refused: the device has program " +
                                    std::to_string(outcome.loaded_program_id) +
                                    " loaded, not program " + std::to_string(expected_id));
          case rt::SkipResult::kSkipped:
            break;
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
    const size_t length = static_cast<size_t>(req->contentLength());
    if (body == nullptr || length == 0)
      return send_problem(res, rt::problem::kProgramInvalid, "Invalid program");

    // contentLength, not strlen: a body carrying an embedded NUL would
    // otherwise be parsed as the prefix before it and rejected with a
    // misleading error.
    const int32_t id = programs::add_uploaded(body, length);
    if (id < 0) return send_problem(res, rt::problem::kProgramInvalid, "Invalid program");

    sse_hub::broadcast_library_changed(rt::library_kind::kProgram);
    return send_json(res, 201, "{\"id\":" + std::to_string(id) + "}");
  });

  s_server.on("/api/v2/programs/*", HTTP_GET, [](PsychicRequest *req, PsychicResponse *res) {
    int32_t id = 0;
    if (!path_id(req->uri(), "/api/v2/programs/", "", id)) {
      return send_problem(res, rt::problem::kProgramNotFound, "Program not found");
    }
    const rt::Program *program = programs::get(id);
    if (program == nullptr)
      return send_problem(res, rt::problem::kProgramNotFound, "Program not found");

    return send_json(res, 200, rt::program_json(*program));
  });

  // Currently the only PUT route, so this wildcard shadows nothing; a fixed
  // PUT path under /api/v2/programs/ would have to be registered above it.
  s_server.on("/api/v2/programs/*", HTTP_PUT, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;

    int32_t id = 0;
    if (!path_id(req->uri(), "/api/v2/programs/", "", id)) {
      return send_problem(res, rt::problem::kProgramNotFound, "Program not found");
    }
    const rt::Program *existing = programs::get(id);
    if (existing == nullptr)
      return send_problem(res, rt::problem::kProgramNotFound, "Program not found");
    // Unlike DELETE, a shipped program is not disguised as a 404: it exists
    // and is fetchable, it just has no writable file behind it.
    if (existing->readonly) {
      return send_problem(res, rt::problem::kProgramReadonly,
                          "Program is read-only and cannot be updated");
    }

    // Refused while loaded rather than handled: ProgramState holds a bare
    // `const rt::Program *` into the repository map, so replacing the value
    // under it would swap the series out from beneath a run that is mid-series
    // and beneath the indices already published over SSE. Making the client
    // unload first keeps that case out of existence.
    if (executor::is_loaded(id)) {
      return send_problem(res, rt::problem::kProgramLoaded,
                          "Program is loaded; unload it before updating");
    }

    const char *body = req->body();
    const size_t length = static_cast<size_t>(req->contentLength());
    if (body == nullptr || length == 0)
      return send_problem(res, rt::problem::kProgramInvalid, "Invalid program");

    switch (programs::update_uploaded(id, body, length)) {
      case programs::UpdateResult::kNotFound:
        return send_problem(res, rt::problem::kProgramNotFound, "Program not found");
      case programs::UpdateResult::kReadonly:
        return send_problem(res, rt::problem::kProgramReadonly,
                            "Program is read-only and cannot be updated");
      case programs::UpdateResult::kIdMismatch:
        return send_problem(res, rt::problem::kProgramIdMismatch,
                            "Program id in the document does not match the path");
      case programs::UpdateResult::kInvalid:
        return send_problem(res, rt::problem::kProgramInvalid, "Invalid program");
      case programs::UpdateResult::kWriteFailed:
        return send_problem(res, rt::problem::kProgramStoreFailed, "Could not store program");
      case programs::UpdateResult::kOk:
        break;
    }

    const rt::Program *stored = programs::get(id);
    if (stored == nullptr)
      return send_problem(res, rt::problem::kProgramStoreFailed, "Could not store program");

    sse_hub::broadcast_library_changed(rt::library_kind::kProgram);
    return send_json(res, 200, rt::program_json(*stored));
  });

  s_server.on("/api/v2/programs/*", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;

    int32_t id = 0;
    if (!path_id(req->uri(), "/api/v2/programs/", "/load", id)) {
      return send_problem(res, rt::problem::kRouteNotFound, "Not found");
    }
    if (!executor::load(id))
      return send_problem(res, rt::problem::kProgramNotFound, "Program not found");
    return send_message(res, "Program loaded");
  });

  s_server.on("/api/v2/programs/*", HTTP_DELETE, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;

    int32_t id = 0;
    if (!path_id(req->uri(), "/api/v2/programs/", "/delete", id)) {
      return send_problem(res, rt::problem::kRouteNotFound, "Not found");
    }
    // Deletability first, THEN unload. programs::remove refuses shipped
    // (read-only) programs, so unloading first meant a DELETE against a
    // shipped program aborted a running series and *then* answered an error -
    // the caller told nothing happened while the range run had already stopped.
    //
    // Shipped is 409, not 404: it exists, GET lists it and fetches it, and only
    // the write is refused - exactly what PUT above answers for the same
    // program. Hiding the refusal behind "not found" left a client unable to
    // tell "gone" from "never deletable", with nothing gained: there is no
    // secret in an id every GET already publishes.
    const rt::Program *program = programs::get(id);
    if (program == nullptr)
      return send_problem(res, rt::problem::kProgramNotFound, "Program not found");
    if (program->readonly) {
      return send_problem(res, rt::problem::kProgramReadonly,
                          "Program is read-only and cannot be deleted");
    }

    // Only now: dropping the program while the run loop holds a pointer to it
    // would dangle, and the client needs the stateUpdate either way.
    executor::unload_if_loaded(id);
    if (!programs::remove(id))
      return send_problem(res, rt::problem::kProgramNotFound, "Program not found");

    sse_hub::broadcast_library_changed(rt::library_kind::kProgram);
    return send_message(res, "Program deleted successfully");
  });
}

// One partition's entry in the diagnostics `partitions` array. The figures
// come from diagnostics::partitions(); this only shapes them.
void append_partition_json(std::string &out, const diagnostics::PartitionUsage &part) {
  out += "{\"name\":";
  out += rt::json_quote(part.name);
  out += ",\"kind\":";
  out += rt::json_quote(part.is_app ? "app" : "data");
  out += ",\"sizeBytes\":";
  out += std::to_string(part.size_bytes);
  if (part.used_known) {
    out += ",\"usedBytes\":";
    out += std::to_string(part.used_bytes);
  }
  if (part.is_app) {
    out += ",\"running\":";
    out += part.running ? "true" : "false";
  }
  out += "}";
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
    out += rt::json_quote(diagnostics::reset_reason_name(esp_reset_reason()));
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
    out += rt::json_quote(net_mgr::ip_address());
    // What the target pin is configured as, and what is actually on the pad -
    // the pair that distinguishes "the firmware never drove it" from
    // "something else is holding it".
    out += ",\"targetGpio\":";
    out += std::to_string(targets::pin());
    out += ",\"targetGpioLevel\":";
    out += std::to_string(targets::level());
    out += ",\"adminModeEnabled\":";
    out += s_admin.enabled() ? "true" : "false";
    // The backend_issues raised before this server existed, which is the only
    // way they can reach a client at all - sse_hub had nowhere to send them.
    // Already-serialized payloads, joined into the array.
    // Every partition in the table, so the app slots and NVS are visible
    // alongside the filesystem - only `storage` was reported before, and it is
    // not the only one that can fill (#132). Emitted in flash-offset order,
    // which is the order partitions.csv reads in.
    out += ",\"partitions\":[";
    bool first = true;
    for (const auto &part : diagnostics::partitions()) {
      if (!first) out += ",";
      first = false;
      append_partition_json(out, part);
    }
    out += "]";
    out += ",\"startupIssues\":";
    out += rt::issue_array_json(sse_hub::startup_issues());
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
  // Nothing reads a staged file back after a reboot, so a survivor is an
  // interrupted upload's remains.
  discard_dead_upload();

  s_server.on("/api/v2/audios", HTTP_GET, [](PsychicRequest *, PsychicResponse *res) {
    return send_json(res, 200, audios::list_json());
  });

  s_server.on("/api/v2/audios/*", HTTP_POST, [](PsychicRequest *req, PsychicResponse *res) {
    if (!require_admin(req, res)) return ESP_OK;

    int32_t id = 0;
    if (!path_id(req->uri(), "/api/v2/audios/", "/play", id)) {
      return send_problem(res, rt::problem::kRouteNotFound, "Not found");
    }
    const audios::Audio *clip = audios::get(id);
    if (clip == nullptr) return send_problem(res, rt::problem::kAudioNotFound, "Audio not found");

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
      return send_problem(res, rt::problem::kRouteNotFound, "Not found");
    }

    // A clip that matters to a run must not disappear from under it: a spoken
    // command that silently fails mid-exercise is a range-safety problem.
    // Refusal order, most specific reason first, and existence before any of
    // them so a bogus id is never reported as a conflict:
    //   1. no such clip                              -> 404
    //   2. a shipped one                             -> 409  (permanent)
    //   3. the loaded program plays it               -> 409  (about this clip)
    //   4. a run is in progress                      -> 409  (about any clip)
    //   5. the audio task is reading it right now    -> 409  (audios::remove)
    // 3 before 4 because it names the clip's own role: it survives a stop and
    // tells the user deleting it needs the program unloaded, not just paused.
    // Read-only ahead of both because it is the reason that never lifts.
    const audios::Audio *clip = audios::get(id);
    if (clip == nullptr) return send_problem(res, rt::problem::kAudioNotFound, "Audio not found");
    if (clip->readonly) {
      return send_problem(res, rt::problem::kAudioReadonly,
                          "Audio is read-only and cannot be deleted");
    }

    // Not only while running: stop() is a pause, so a clip removed between two
    // runs would be missing when the loaded program is resumed.
    if (executor::loaded_program_uses_audio(id)) {
      return send_problem(res, rt::problem::kAudioInUse,
                          "Audio is used by the loaded program - unload the program first");
    }
    if (executor::is_running()) {
      return send_problem(res, rt::problem::kProgramRunning,
                          "A program is running - stop it before deleting audio");
    }

    switch (audios::remove(id)) {
      case audios::RemoveResult::kNotFound:
        return send_problem(res, rt::problem::kAudioNotFound, "Audio not found");
      case audios::RemoveResult::kPlaying:
        return send_problem(res, rt::problem::kAudioPlaying, "Audio is currently playing");
      case audios::RemoveResult::kOk:
        break;
    }

    sse_hub::broadcast_library_changed(rt::library_kind::kAudio);
    return send_message(res, "Audio deleted successfully");
  });

  // Streamed to a fixed staging file rather than a client-named one. The
  // client's filename is never used on disk: it could collide with the
  // repository's own audios.json index (destroying it) or with an existing
  // clip (leaving two ids sharing one file). audios::add_uploaded renames the
  // staged file to <id>.wav once an id is assigned.
  s_audio_upload.onUpload([](PsychicRequest *req, const char *filename, uint64_t index,
                             uint8_t *data, size_t len, bool final) -> esp_err_t {
    if (filename == nullptr || *filename == '\0') return ESP_FAIL;

    // Extension is the only thing taken from the client name, and only as an
    // early reject - the header is validated properly once the file has landed.
    const size_t name_len = strlen(filename);
    if (name_len < 5 || strcasecmp(filename + name_len - 4, ".wav") != 0) {
      ESP_LOGW(TAG, "Rejected upload '%s': not a .wav", filename);
      return ESP_FAIL;
    }

    if (index == 0) {
      // Marks the body as streaming so the middleware can tell, next time
      // round, that this request never reached onRequest.
      s_upload_in_flight = true;
      s_upload_bytes = 0;
      storage::make_dirs(kUploadAudioDir);
    }

    // The server-wide ceiling is sized for firmware now, so a clip has to be
    // bounded here or it is bounded by the size of the partition.
    s_upload_bytes += len;
    if (s_upload_bytes > kMaxUploadBytes) {
      ESP_LOGW(TAG, "Rejected upload '%s': past the %u-byte ceiling", filename,
               static_cast<unsigned>(kMaxUploadBytes));
      s_upload_in_flight = false;
      ::remove(kStagedUploadPath);
      return ESP_FAIL;
    }

    FILE *f = fopen(kStagedUploadPath, index == 0 ? "wb" : "ab");
    if (f == nullptr) {
      s_upload_in_flight = false;
      ::remove(kStagedUploadPath);
      return ESP_FAIL;
    }
    const size_t written = fwrite(data, 1, len, f);
    fclose(f);

    if (written != len) {
      // Out of space, most likely. Never leave the partial behind: a repeated
      // failed upload would otherwise fill the partition.
      s_upload_in_flight = false;
      ::remove(kStagedUploadPath);
      return ESP_FAIL;
    }

    if (final) req->setSessionKey("upload_done", "1");
    return ESP_OK;
  });

  s_audio_upload.addMiddleware(
      [](PsychicRequest *req, PsychicResponse *res, PsychicMiddlewareNext next) -> esp_err_t {
        // Gated as middleware, not inside onRequest: PsychicHandler::process
        // runs the chain before handleRequest, and handleRequest is what
        // streams the body to flash. Checking afterwards would let an
        // unauthenticated caller write a file and only then be told no.
        if (!require_admin(req, res)) return ESP_OK;

        // The server is single-task (ENABLE_ASYNC is off), so no other upload
        // can still be running: a flag still set here belongs to one whose
        // connection died mid-body, which skipped onRequest - the only reset -
        // and left its bytes staged. Clear both, or they prepend the file
        // about to arrive.
        discard_dead_upload();
        return next();
      });

  s_audio_upload.onRequest([](PsychicRequest *req, PsychicResponse *res) -> esp_err_t {
    // sess_ctx is per-socket, not per-request, so a second upload on the same
    // keep-alive connection would otherwise still see the previous one's flag
    // and register the earlier file again under a new id.
    const bool uploaded = req->hasSessionKey("upload_done");
    req->setSessionKey("upload_done", "");
    s_upload_in_flight = false;

    // From here every failure path removes the staged file.
    struct Staged {
      ~Staged() {
        if (armed) ::remove(kStagedUploadPath);
      }
      bool armed = true;
    } staged;

    if (!uploaded) return send_problem(res, rt::problem::kUploadMissingFile, "No file uploaded");

    PsychicWebParameter *title = req->hasParam("title") ? req->getParam("title", false) : nullptr;
    if (title == nullptr || title->value() == nullptr || *title->value() == '\0') {
      return send_problem(res, rt::problem::kUploadMissingTitle, "Missing title");
    }

    rt::WavInfo info;
    if (!audio::probe_wav(kStagedUploadPath, info)) {
      return send_problem(res, rt::problem::kAudioFormatUnsupported, "Unsupported audio format");
    }

    const int32_t id = audios::add_uploaded(title->value(), kStagedUploadPath);
    if (id < 0) return send_problem(res, rt::problem::kAudioStoreFailed, "Failed to add audio");

    // add_uploaded renamed the staged file into place; nothing left to clean.
    staged.armed = false;

    sse_hub::broadcast_library_changed(rt::library_kind::kAudio);
    return send_json(res, 201, "{\"id\":" + std::to_string(id) + "}");
  });

  s_server.on("/api/v2/audios", HTTP_POST, &s_audio_upload);
}

constexpr const char *kWebappDir = "/storage/webapp/";
constexpr const char *kWebappIndex = "/storage/webapp/index.html";

// Whether the build bundled a webapp at all. An API-only image has no
// index.html to fall back to and keeps the JSON 404 for everything.
bool s_webapp_bundled = false;

// Serves the built webapp from LittleFS when one has been uploaded. Kept last
// so it never shadows an API route.
void register_static_routes() {
  // Only .gz survives the build for the text assets (firmware/CMakeLists.txt),
  // so the uncompressed name is not the one to probe for.
  struct stat st;
  const std::string gz = std::string(kWebappIndex) + ".gz";
  s_webapp_bundled = stat(kWebappIndex, &st) == 0 || stat(gz.c_str(), &st) == 0;

  // The native ESP-IDF overload takes a POSIX path; the fs::FS one is
  // Arduino-only (see lib/psychic_http/src/PsychicFS.h).
  s_server.serveStatic("/", kWebappDir)->setDefaultFile("index.html");
}

}  // namespace

bool start() {
  // PsychicHttpServer::start() computes max_uri_handlers itself (one wildcard
  // meta-handler per HTTP method; it dispatches endpoints from its own list),
  // so setting it here was dead and the "keep it above the route count"
  // comment described a guard this library version does not have.

  // The documented 1 MB ceiling was only ever consulted when reading files
  // *back* off flash. Without these the real limits were PsychicHttp's
  // defaults - 16 KB for a JSON body and 2 MB for an upload.
  // The server-wide ceiling has to admit the largest legitimate upload, which
  // is firmware: a 1 MB cap rejected every real app image outright. Raising it
  // here would leave audio and programs unbounded, so each now counts its own
  // bytes against kMaxUploadBytes - the ceiling that used to do that job for
  // them.
  s_server.maxUploadSize = kMaxFirmwareUploadBytes;
  s_server.maxRequestBodySize = kMaxFirmwareUploadBytes;
  // Every connected client holds a socket open indefinitely for /sse/v2 on top
  // of its REST traffic. Bounded by LWIP: httpd requires
  // max_open_sockets <= CONFIG_LWIP_MAX_SOCKETS - 3, and sdkconfig.defaults
  // sets that to 16 - raise the two together or httpd_start() fails.
  s_server.config.max_open_sockets = 12;
  s_server.config.lru_purge_enable = true;

  // Credentialed CORS, against an allowlist.
  //
  // A browser refuses `Access-Control-Allow-Origin: *` on a credentialed
  // request, so the origin has to be echoed - but echoing *any* origin meant
  // any page an operator visited on the range network could script the device
  // cross-origin and read every response. The allowlist keeps the webapp
  // working (served from the device, or a dev origin set in Kconfig) while
  // making a drive-by page fail the preflight.
  //
  // PsychicHttp's built-in CorsMiddleware only emits one fixed origin, which
  // is why this is hand-rolled.
  s_server.addMiddleware(
      [](PsychicRequest *req, PsychicResponse *res, PsychicMiddlewareNext next) -> esp_err_t {
        const char *origin = req->header("Origin");
        if (origin != nullptr && *origin != '\0' && origin_allowed(origin)) {
          const std::string reflected = origin;
          res->addHeader("Access-Control-Allow-Origin", reflected.c_str());
          res->addHeader("Access-Control-Allow-Credentials", "true");
          res->addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
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
    // Strict: sscanf alone accepted a bare `git describe` hash, because
    // "9f7c98d" parses as major=9 and the device then reported 9.0.0. Require
    // all three fields AND that what follows is a legitimate semver
    // continuation - end of string, or the -N-gHASH / +meta that describe adds.
    const esp_app_desc_t *desc = esp_app_get_description();
    unsigned major = 0, minor = 0, patch = 0;
    int consumed = 0;
    if (sscanf(desc->version, "%u.%u.%u%n", &major, &minor, &patch, &consumed) != 3 ||
        consumed <= 0 ||
        (desc->version[consumed] != '\0' && desc->version[consumed] != '-' &&
         desc->version[consumed] != '+')) {
      // An untagged build has no version to report; 0.0.0 says so honestly
      // rather than inventing one from the hash.
      major = minor = patch = 0;
    }

    return send_json(res, 200,
                     "{\"major\":" + std::to_string(major) + ",\"minor\":" + std::to_string(minor) +
                         ",\"patch\":" + std::to_string(patch) + "}");
  });

  register_admin_mode_routes();
  register_program_routes();
  register_diagnostics_routes();
  register_target_routes();
  register_audio_routes();
  // Lives in its own translation unit: the ESP-IDF OTA calls have a lifetime
  // discipline of their own (a handle that must be aborted, not ended, before
  // it is finalised) and do not belong mixed into the request handlers here.
  ota::register_routes(s_server);

  sse_hub::attach(s_server, "/sse/v2");

  // PsychicHttpServer::notFoundHandler builds a fresh request and does not run
  // the server middleware chain, so an unmatched URI answered with no CORS
  // headers - which a browser surfaces as an opaque CORS failure rather than
  // the 404 it is. The headers are therefore set here rather than inherited.
  s_server.onNotFound([](PsychicRequest *req, PsychicResponse *res) {
    const char *origin = req->header("Origin");
    if (origin != nullptr && *origin != '\0' && origin_allowed(origin)) {
      const std::string reflected = origin;
      res->addHeader("Access-Control-Allow-Origin", reflected.c_str());
      res->addHeader("Access-Control-Allow-Credentials", "true");
      res->addHeader("Vary", "Origin");
    }

    // SPA fallback. The webapp routes client-side, so GET /run is a real page
    // with no file behind it and a reload would otherwise answer a JSON 404.
    //
    // It lives here rather than in a catch-all route because _process() matches
    // endpoints before handlers: a `/*` GET endpoint would shadow every static
    // file whenever it was registered. onNotFound runs only once both have
    // missed, which is exactly the condition. rt::spa_fallback_eligible keeps
    // the API's and the assets' own 404s intact.
    if (s_webapp_bundled && req->method() == HTTP_GET &&
        rt::spa_fallback_eligible(req->uriCStr())) {
      // PsychicFileResponse picks index.html.gz and sets Content-Encoding
      // itself, the same way the static handler serves the file for `/`.
      PsychicFileResponse index(res, kWebappIndex);
      return index.send();
    }

    return send_problem(res, rt::problem::kRouteNotFound, "Not found");
  });

  register_static_routes();

  // Routes are registered against the server object first and bound when it
  // starts, so nothing can arrive at a half-registered surface.
  if (s_server.start() != ESP_OK) {
    // Notably ESP_ERR_INVALID_ARG when the socket budget is mis-tuned against
    // CONFIG_LWIP_MAX_SOCKETS. Dropping the result meant logging "listening"
    // and turning the LED green on a device serving nothing.
    ESP_LOGE(TAG, "HTTP server failed to start");
    return false;
  }

  ESP_LOGI(TAG, "HTTP server listening on port %u", kHttpPort);
  return true;
}

}  // namespace web_server
