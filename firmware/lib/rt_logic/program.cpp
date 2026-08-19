#include "program.h"

#include <ArduinoJson.h>

#include <cstring>

namespace rt {

namespace {

Event parse_event(JsonObjectConst src) {
  Event e;
  // Clamped, not merely read: `duration` is attacker-controlled via program
  // upload, and Series::total_ms() sums these into an int32. Unbounded values
  // overflow that sum (UB), and a negative one makes the run loop complete the
  // series on its first tick. kMaxEventMs is far longer than any real event.
  const int64_t duration = src["duration"] | static_cast<int64_t>(0);
  e.duration_ms =
      duration < 0 ? 0 : (duration > kMaxEventMs ? kMaxEventMs : static_cast<int32_t>(duration));
  e.command = src["command"] | "";

  JsonArrayConst ids = src["audio_ids"];
  for (JsonVariantConst id : ids) {
    if (id.is<int32_t>()) e.audio_ids.push_back(id.as<int32_t>());
  }
  return e;
}

Series parse_series(JsonObjectConst src) {
  Series s;
  s.name = src["name"] | "";
  s.optional = src["optional"] | false;

  JsonArrayConst events = src["events"];
  s.events.reserve(events.size());
  for (JsonObjectConst e : events) s.events.push_back(parse_event(e));
  return s;
}

}  // namespace

bool parse_program(const char *json, size_t len, bool readonly, Program &out) {
  // ArduinoJson v7's JsonDocument grows on demand, so there is no capacity to
  // size up front. The ceiling on how much it can grow is the caller's: the
  // HTTP layer caps the request body and the shipped program files are ours.
  JsonDocument doc;
  if (deserializeJson(doc, json, len) != DeserializationError::Ok) return false;

  JsonObjectConst root = doc.as<JsonObjectConst>();
  if (root.isNull()) return false;

  out = Program{};
  out.id = root["id"] | 0;
  out.title = root["title"] | "";
  out.description = root["description"] | "";
  out.readonly = readonly;

  JsonArrayConst series = root["series"];
  out.series.reserve(series.size());
  for (JsonObjectConst s : series) out.series.push_back(parse_series(s));

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
