// ============================================================================
//  rt_logic/problem.h
//  RFC 9457 problem details: the one shape every REST failure is answered in.
// ============================================================================
#pragma once

#include <string>

#include "json_util.h"

namespace rt {

// `type` is a stable relative URI under this prefix and is never dereferenced
// (D-19) - it is an identifier a client switches on, not a document to fetch.
constexpr const char *kProblemTypePrefix = "/problems/";

// RFC 9457's media type. A problem detail is never served as
// `application/json`: the distinct type is how a generic client knows the body
// is a problem before it looks at the fields.
constexpr const char *kProblemContentType = "application/problem+json";

// One problem type: the slug `type` is built from, the `title` every
// occurrence of it carries, and the status it is always answered with.
//
// Status belongs here rather than at the call site because RFC 9457 wants one
// title per type, and one status per type is what lets contracts/openapi.yaml
// list exactly which `type`s an operation can produce under each status code.
struct ProblemType {
  const char *slug;
  const char *title;
  int status;
};

// The whole vocabulary, in one list so the named constants below and the
// registry the tests walk cannot drift apart.
//
// `program_invalid` is deliberately the same string as
// `issue_code::kProgramInvalid` in backend_issue.h: a program that will not
// parse means the same thing whether it is refused over REST or reported over
// SSE, so it says so with the same word. test_problem asserts they stay equal.
#define RT_PROBLEM_TYPES(X)                                                                     \
  /* auth */                                                                                    \
  X(kAdminCredentialsRequired, "admin_credentials_required", "Admin credentials required", 401) \
  X(kInvalidPassword, "invalid_password", "Invalid password", 401)                              \
  /* not found */                                                                               \
  X(kRouteNotFound, "route_not_found", "Route not found", 404)                                  \
  X(kProgramNotFound, "program_not_found", "Program not found", 404)                            \
  X(kAudioNotFound, "audio_not_found", "Audio not found", 404)                                  \
  /* conflict / state */                                                                        \
  X(kAdminModeAlreadyEnabled, "admin_mode_already_enabled", "Admin mode already enabled", 409)  \
  X(kAdminModeNotEnabled, "admin_mode_not_enabled", "Admin mode not enabled", 409)              \
  X(kNoProgramLoaded, "no_program_loaded", "No program loaded", 400)                            \
  X(kProgramNotRunning, "program_not_running", "Program not running", 400)                      \
  X(kProgramRunning, "program_running", "A program is running", 409)                            \
  X(kProgramLoaded, "program_loaded", "Program is loaded", 409)                                 \
  X(kStartProgramMismatch, "start_program_mismatch", "A different program is loaded", 409)      \
  X(kSkipProgramMismatch, "skip_program_mismatch", "A different program is loaded", 409)        \
  X(kProgramReadonly, "program_readonly", "Program is read-only", 409)                          \
  X(kAudioReadonly, "audio_readonly", "Audio is read-only", 409)                                \
  X(kAudioInUse, "audio_in_use", "Audio is used by the loaded program", 409)                    \
  X(kAudioPlaying, "audio_playing", "Audio is currently playing", 409)                          \
  /* firmware update */                                                                         \
  X(kOtaImageRefused, "ota_image_refused", "Firmware image refused", 400)                       \
  /* validation */                                                                              \
  X(kProgramInvalid, "program_invalid", "Invalid program", 400)                                 \
  X(kProgramIdMismatch, "program_id_mismatch", "Program id does not match the path", 400)       \
  X(kSeriesIndexInvalid, "series_index_invalid", "Series index out of range", 400)              \
  X(kStartIdRequired, "start_id_required", "A program id is required to start", 400)            \
  X(kSkipIdRequired, "skip_id_required", "A program id is required to skip to a series", 400)   \
  X(kHardwareConfigInvalid, "hardware_config_invalid", "Invalid hardware configuration", 400)   \
  X(kHardwareConfigSerialOnly, "hardware_config_serial_only",                                   \
    "That setting changes only from the serial console", 400)                                   \
  X(kHardwareConfigWindowClosed, "hardware_config_window_closed",                               \
    "The configuration window is closed", 403)                                                  \
  /* upload */                                                                                  \
  X(kUploadMissingFile, "upload_missing_file", "No file uploaded", 400)                         \
  X(kUploadMissingTitle, "upload_missing_title", "Missing title", 400)                          \
  X(kAudioFormatUnsupported, "audio_format_unsupported", "Unsupported audio format", 400)       \
  /* internal */                                                                                \
  X(kProgramStoreFailed, "program_store_failed", "Could not store program", 500)                \
  X(kAudioStoreFailed, "audio_store_failed", "Could not store audio", 500)

namespace problem {
#define RT_PROBLEM_DEFINE(name, slug, title, status) \
  inline constexpr ProblemType name{slug, title, status};
RT_PROBLEM_TYPES(RT_PROBLEM_DEFINE)
#undef RT_PROBLEM_DEFINE
}  // namespace problem

// Every type, for the tests that check the vocabulary itself - slugs unique,
// titles present, statuses in range.
inline constexpr const ProblemType *kProblemTypes[] = {
#define RT_PROBLEM_ENTRY(name, slug, title, status) &problem::name,
    RT_PROBLEM_TYPES(RT_PROBLEM_ENTRY)
#undef RT_PROBLEM_ENTRY
};

// `{"type":"/problems/<slug>","title":...,"status":N,"detail":...}`.
//
// `instance` is omitted (D-19): it identifies a single occurrence, which means
// nothing on a device with no request ids. `detail` goes through json_quote
// because it can carry a user-supplied title or filename.
inline std::string problem_json(const ProblemType &type, const std::string &detail) {
  std::string out = "{\"type\":";
  out += json_quote(std::string(kProblemTypePrefix) + type.slug);
  out += ",\"title\":";
  out += json_quote(type.title);
  out += ",\"status\":";
  out += std::to_string(type.status);
  out += ",\"detail\":";
  out += json_quote(detail);
  out += '}';
  return out;
}

}  // namespace rt
