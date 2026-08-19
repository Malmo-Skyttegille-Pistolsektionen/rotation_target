#include "sse_hub.h"

#include <PsychicHttp.h>

#include "config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "program_executor.h"

namespace sse_hub {
namespace {

const char *TAG = "sse";

PsychicEventSource s_events;
esp_timer_handle_t s_heartbeat = nullptr;
uint32_t s_heartbeat_id = 0;

void send_heartbeat(void *) {
  // Matches the MicroPython backend's payload shape: a monotonic id the client
  // can use to spot a missed beat.
  const std::string payload = "{\"id\":" + std::to_string(++s_heartbeat_id) + "}";
  s_events.send(payload.c_str(), "heartbeat", static_cast<uint32_t>(esp_timer_get_time() / 1000));
}

}  // namespace

void attach(PsychicHttpServer &server, const char *uri) {
  s_events.onOpen([](PsychicEventSourceClient *client) {
    // The full state on connect is what makes /status unnecessary.
    const std::string payload = executor::state_json();
    client->send(payload.c_str(), "stateUpdate", static_cast<uint32_t>(esp_timer_get_time() / 1000),
                 500);
    ESP_LOGI(TAG, "Client %d connected", client->socket());
  });

  s_events.onClose([](PsychicEventSourceClient *client) {
    ESP_LOGI(TAG, "Client %d disconnected", client->socket());
  });

  server.on(uri, &s_events);

  const esp_timer_create_args_t args = {
      .callback = &send_heartbeat,
      .arg = nullptr,
      .dispatch_method = ESP_TIMER_TASK,
      .name = "sse_heartbeat",
      .skip_unhandled_events = true,
  };
  if (esp_timer_create(&args, &s_heartbeat) == ESP_OK) {
    esp_timer_start_periodic(s_heartbeat, kSseHeartbeatSeconds * 1000000ULL);
  } else {
    ESP_LOGE(TAG, "Could not start the heartbeat timer");
  }
}

void broadcast_state(const std::string &payload) {
  s_events.send(payload.c_str(), "stateUpdate", static_cast<uint32_t>(esp_timer_get_time() / 1000));
}

}  // namespace sse_hub
