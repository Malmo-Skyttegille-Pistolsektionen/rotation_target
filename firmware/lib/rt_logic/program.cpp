#include "program.h"

#include <ArduinoJson.h>

namespace rt {

namespace {

Event parse_event(JsonObjectConst src) {
  Event e;
  e.duration_ms = src["duration"] | 0;
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

}  // namespace rt
