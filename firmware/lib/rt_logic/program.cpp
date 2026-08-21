#include "program.h"

#include <ArduinoJson.h>

#include <cstring>
#include <utility>

namespace rt {

namespace {

// `command` is optional, but a value the executor does not recognise is a typo,
// not an instruction: `"shwo"` would upload cleanly and the target would simply
// never turn, mid-exercise, with nothing to see. Absent, JSON `null` and the
// empty string all mean "leave the targets where they are" - the serializer
// omits the key, the legacy editor writes `null` - and anything else fails the
// whole program, the same as any other parse error.
bool parse_command(JsonVariantConst src, std::string &out) {
  if (src.isNull()) return true;
  if (!src.is<const char *>()) return false;

  const char *value = src.as<const char *>();
  if (value == nullptr || *value == '\0') return true;
  if (strcmp(value, "show") != 0 && strcmp(value, "hide") != 0) return false;

  out = value;
  return true;
}

bool parse_event(JsonObjectConst src, Event &e) {
  // Clamped, not merely read: `duration` is attacker-controlled via program
  // upload, and Series::total_ms() sums these into an int32. Unbounded values
  // overflow that sum (UB), and a negative one makes the run loop complete the
  // series on its first tick. kMaxEventMs is far longer than any real event.
  const int64_t duration = src["duration"] | static_cast<int64_t>(0);
  // Floor of 1 ms, not 0: locate_event() uses a half-open interval, so a
  // zero-duration event can never contain any elapsed time - its command and
  // audio would be silently skipped rather than fired.
  const int64_t clamped =
      duration < kMinEventMs ? kMinEventMs : (duration > kMaxEventMs ? kMaxEventMs : duration);
  e.duration_ms = static_cast<int32_t>(clamped);
  if (!parse_command(src["command"], e.command)) return false;

  JsonArrayConst ids = src["audio_ids"];
  for (JsonVariantConst id : ids) {
    if (id.is<int32_t>()) e.audio_ids.push_back(id.as<int32_t>());
  }
  return true;
}

bool parse_series(JsonObjectConst src, Series &s) {
  s.name = src["name"] | "";
  s.optional = src["optional"] | false;

  JsonArrayConst events = src["events"];
  s.events.reserve(events.size());
  for (JsonObjectConst e : events) {
    Event event;
    if (!parse_event(e, event)) return false;
    s.events.push_back(std::move(event));
  }
  return true;
}

}  // namespace

bool parse_program(const char *json, size_t len, bool readonly, Program &out, bool *id_present) {
  // ArduinoJson v7's JsonDocument grows on demand, so there is no capacity to
  // size up front. The ceiling on how much it can grow is the caller's: the
  // HTTP layer caps the request body and the shipped program files are ours.
  JsonDocument doc;
  if (deserializeJson(doc, json, len) != DeserializationError::Ok) return false;

  JsonObjectConst root = doc.as<JsonObjectConst>();
  if (root.isNull()) return false;

  out = Program{};
  out.id = root["id"] | 0;
  // Present means the key exists and is not JSON null - not that it is usable.
  // A garbage type reads as id 0 here, which `PUT /programs/{id}` then refuses
  // as a mismatch rather than quietly accepting.
  if (id_present != nullptr) *id_present = !root["id"].isNull();
  out.title = root["title"] | "";
  out.description = root["description"] | "";
  out.readonly = readonly;

  JsonArrayConst series = root["series"];
  out.series.reserve(series.size());
  for (JsonObjectConst s : series) {
    Series parsed;
    if (!parse_series(s, parsed)) return false;
    out.series.push_back(std::move(parsed));
  }

  return true;
}

bool parse_program_filename(const char *name, int32_t &out) {
  if (name == nullptr) return false;

  const size_t len = strlen(name);
  constexpr const char *kExt = ".json";
  constexpr size_t kExtLen = 5;
  // Needs at least one digit before the extension.
  if (len <= kExtLen || strcmp(name + len - kExtLen, kExt) != 0) return false;

  int64_t value = 0;
  for (size_t i = 0; i + kExtLen < len; i++) {
    if (name[i] < '0' || name[i] > '9') return false;
    value = value * 10 + (name[i] - '0');
    if (value > INT32_MAX) return false;
  }
  out = static_cast<int32_t>(value);
  return true;
}

}  // namespace rt
