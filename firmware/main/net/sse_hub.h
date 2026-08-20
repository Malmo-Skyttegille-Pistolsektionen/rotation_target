#pragma once

#include <string>

#include "backend_issue.h"

class PsychicHttpServer;

// The /sse/v2 stream. `stateUpdate` is the only channel run state is published
// on - a client connects, receives the full state immediately, and receives it
// again after every mutation - plus a `heartbeat` every 10 seconds so a client
// can tell "nothing changed" from "the connection died", and a `backend_issue`
// whenever something failed that no client asked for.
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
// program scan calls it from.
void broadcast_issue(const char *code, const std::string &message,
                     const rt::IssueContext &context = {});

}  // namespace sse_hub
