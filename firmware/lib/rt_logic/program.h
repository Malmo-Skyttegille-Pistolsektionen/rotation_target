// ============================================================================
//  rt_logic/program.h
//  The program model and its JSON contract - host-testable, no hardware.
//  Ported from src/backend/dataclasses/program.py of the MicroPython backend.
// ============================================================================
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "json_util.h"

namespace rt {

// Ceiling on a single event's duration, and therefore on how far a malformed
// or hostile program can push Series::total_ms(). One hour is already far
// beyond any real shooting sequence; 64 events at this ceiling still sum well
// inside int32.
constexpr int32_t kMaxEventMs = 60 * 60 * 1000;

// Floor on a parsed event duration. locate_event() uses a half-open interval,
// so a zero-duration event would never be entered at all and its command and
// audio would silently not happen.
constexpr int32_t kMinEventMs = 1;

// A single step of a series: hold for `duration_ms`, optionally moving the
// targets and playing audio on entry.
struct Event {
  int32_t duration_ms = 0;
  // "show", "hide", or empty for "leave the targets where they are".
  std::string command;
  std::vector<int32_t> audio_ids;
};

struct Series {
  std::string name;
  bool optional = false;
  std::vector<Event> events;

  int32_t total_ms() const {
    int32_t total = 0;
    for (const Event &e : events) total += e.duration_ms;
    return total;
  }
};

struct Program {
  int32_t id = 0;
  std::string title;
  std::string description;
  // Shipped programs are read-only; only uploaded ones can be deleted.
  bool readonly = false;
  std::vector<Series> series;
};

// --- Serialization ---------------------------------------------------------
//
// Hand-rolled rather than delegated to ArduinoJson so the wire format is
// literal and reviewable against docs/api-v2.md, and so a serializer change
// shows up as a diff in the format string rather than in library behaviour.

// The summary form returned by `GET /api/v2/programs` - no series.
inline std::string program_summary_json(const Program &p) {
  std::string out = "{\"id\":";
  out += std::to_string(p.id);
  out += ",\"title\":";
  out += json_quote(p.title);
  out += ",\"description\":";
  out += json_quote(p.description);
  out += ",\"readonly\":";
  out += p.readonly ? "true" : "false";
  out += "}";
  return out;
}

inline std::string event_json(const Event &e) {
  // `command` and `audio_ids` are omitted when absent, matching Event.to_dict()
  // in the MicroPython backend - the webapp treats both as optional.
  std::string out = "{\"duration\":";
  out += std::to_string(e.duration_ms);
  if (!e.command.empty()) {
    out += ",\"command\":";
    out += json_quote(e.command);
  }
  if (!e.audio_ids.empty()) {
    out += ",\"audio_ids\":[";
    for (size_t i = 0; i < e.audio_ids.size(); i++) {
      if (i > 0) out += ',';
      out += std::to_string(e.audio_ids[i]);
    }
    out += ']';
  }
  out += '}';
  return out;
}

inline std::string series_json(const Series &s) {
  std::string out = "{\"name\":";
  out += json_quote(s.name);
  out += ",\"optional\":";
  out += s.optional ? "true" : "false";
  out += ",\"events\":[";
  for (size_t i = 0; i < s.events.size(); i++) {
    if (i > 0) out += ',';
    out += event_json(s.events[i]);
  }
  out += "]}";
  return out;
}

// The full form returned by `GET /api/v2/programs/{id}`.
inline std::string program_json(const Program &p) {
  std::string out = "{\"id\":";
  out += std::to_string(p.id);
  out += ",\"title\":";
  out += json_quote(p.title);
  out += ",\"description\":";
  out += json_quote(p.description);
  out += ",\"readonly\":";
  out += p.readonly ? "true" : "false";
  out += ",\"series\":[";
  for (size_t i = 0; i < p.series.size(); i++) {
    if (i > 0) out += ',';
    out += series_json(p.series[i]);
  }
  out += "]}";
  return out;
}

// --- Parsing ---------------------------------------------------------------

// Parse a program document. Returns false on malformed JSON or a non-object
// root; missing fields fall back to the same defaults the MicroPython
// `from_dict` used, so a sparse-but-valid document still loads.
//
// `readonly` is imposed by the caller rather than read from the document: it
// is a property of where the file came from (shipped vs uploaded), not
// something an uploader gets to assert about itself.
//
// `id_present`, when given, reports whether the document carried an `id` field
// at all. A document without one parses to id 0, and 0 is itself a legal id,
// so the distinction cannot be recovered from `out` - `PUT /programs/{id}`
// needs it to tell "no id offered" from "id 0 offered".
bool parse_program(const char *json, size_t len, bool readonly, Program &out,
                   bool *id_present = nullptr);

inline bool parse_program(const std::string &json, bool readonly, Program &out,
                          bool *id_present = nullptr) {
  return parse_program(json.c_str(), json.size(), readonly, out, id_present);
}

// A program file is named `<digits>.json` and the filename is the authority on
// the id. Rejects anything else, including values that would overflow int32 -
// the accumulator this replaced had no bound, so a long enough filename on the
// uploads partition was signed-overflow UB.
bool parse_program_filename(const char *name, int32_t &out);

}  // namespace rt
