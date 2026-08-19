#pragma once

// The REST surface (/api/v2) and the SSE stream (/sse/v2), plus the static
// webapp served from LittleFS. See docs/api-v2.md for the contract.
namespace web_server {

void start();

}  // namespace web_server
