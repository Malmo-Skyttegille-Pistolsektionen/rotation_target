#pragma once

#include <string>
#include <vector>

#include "backend_issue.h"
#include "library_changed.h"

class PsychicHttpServer;

// The /sse/v2 stream. `stateUpdate` is the only channel run state is published
// on - a client connects, receives the full state immediately, and receives it
// again after every mutation - plus a `heartbeat` every 10 seconds so a client
// can tell "nothing changed" from "the connection died", a `backend_issue`
// whenever something failed that no client asked for, and a `libraryChanged`
// whenever the stored programs or audio clips are no longer what a client last
// fetched.
namespace sse_hub {

// Registers the endpoint and starts the heartbeat timer.
void attach(PsychicHttpServer &server, const char *uri);

void broadcast_state(const std::string &payload);

// A failure with no request to answer: a clip that would not play, a program
// file that would not parse. Fire-and-forget - nothing is queued for a client
// that is not connected yet and nothing is replayed on connect, so the log
// stays the record of what happened and this is only the notification.
//
// Safe to call before the web server exists, which is where the boot-time
// program scan calls it from; those are kept for startup_issues() instead of
// being dropped.
void broadcast_issue(const char *code, const std::string &message,
                     const rt::IssueContext &context = {});

// The issues raised before the HTTP server existed, as the same serialized
// `backend_issue` payloads a connected client would have received. At most
// kMaxStartupIssues are kept; past that the oldest is dropped, so a full
// result may be a truncated one.
//
// GET /api/v2/diagnostics/info serves these: no client can be connected while
// the boot scan runs, so without somewhere to put them a stored program that
// will not parse is visible only on the serial console.
const std::vector<std::string> &startup_issues();

// The library a client fetches over REST has changed: a program or an audio
// clip was created, replaced or deleted. `kind` is an rt::library_kind
// constant and names the list to refetch.
//
// Run state is NOT library state: load, start, stop, reset and skip leave the
// stored documents untouched and are already published as `stateUpdate`.
void broadcast_library_changed(const char *kind);

}  // namespace sse_hub
