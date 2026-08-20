#pragma once

#include <string>

class PsychicHttpServer;

// The /sse/v2 stream. `stateUpdate` is the only channel run state is published
// on - a client connects, receives the full state immediately, and receives it
// again after every mutation - plus a `heartbeat` every 10 seconds so a client
// can tell "nothing changed" from "the connection died".
namespace sse_hub {

// Registers the endpoint and starts the heartbeat timer.
void attach(PsychicHttpServer &server, const char *uri);

void broadcast_state(const std::string &payload);

}  // namespace sse_hub
