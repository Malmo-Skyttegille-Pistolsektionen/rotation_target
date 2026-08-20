#pragma once

// The REST surface (/api/v2) and the SSE stream (/sse/v2), plus the static
// webapp served from LittleFS. See docs/api-v2.md for the contract.
namespace web_server {

// False if the HTTP server could not bind; the caller should not report the
// device as ready.
bool start();

}  // namespace web_server
