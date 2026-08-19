#include "sse_hub.h"

#include <PsychicHttp.h>

#include <string>

#include "config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "program_executor.h"

namespace sse_hub {
namespace {

const char *TAG = "sse";

PsychicEventSource s_events;
PsychicHttpServer *s_server = nullptr;
esp_timer_handle_t s_heartbeat = nullptr;
uint32_t s_heartbeat_id = 0;

// One SSE frame to fan out.
struct Work {
  const char *event;  // static string literal
  std::string payload;
};

// Runs on the httpd task, always.
//
// This is the whole point of the indirection. PsychicEventSource::send() walks
// PsychicHandler::_clients, and esp_http_server adds to and removes from that
// same list on the httpd task when clients connect and disconnect - with no
// lock anywhere in the vendored handler. Sending from the run loop or the timer
// task raced that list. Sending from the httpd task cannot, because it is the
// same task that mutates it.
//
// It also gets the blocking send off the run loop:
// PsychicEventSourceClient::sendEvent retries httpd_socket_send forever on
// HTTPD_SOCK_ERR_TIMEOUT, so one client that has stopped reading used to stall
// the run loop in 5-second multiples - freezing the targets mid-program.
void send_on_httpd_task(void *arg) {
  auto *work = static_cast<Work *>(arg);
  s_events.send(work->payload.c_str(), work->event,
                static_cast<uint32_t>(esp_timer_get_time() / 1000));
  delete work;
}

// Non-blocking: hands the frame to the httpd work queue and returns. Safe to
// call with the run-state lock held, which is what keeps snapshot order and
// send order the same.
void enqueue(const char *event, std::string payload) {
  if (s_server == nullptr || s_server->server == nullptr) return;

  auto *work = new Work{event, std::move(payload)};
  if (httpd_queue_work(s_server->server, send_on_httpd_task, work) != ESP_OK) {
    // The work queue is full - the httpd task is wedged or badly behind.
    // Dropping the frame beats blocking the caller, which may be the run loop.
    ESP_LOGW(TAG, "Dropped a '%s' frame: httpd work queue full", event);
    delete work;
  }
}

void send_heartbeat(void *) {
  // Matches the MicroPython backend's shape: a monotonic id a client can use
  // to spot a missed beat.
  enqueue("heartbeat", "{\"id\":" + std::to_string(++s_heartbeat_id) + "}");
}

}  // namespace

void attach(PsychicHttpServer &server, const char *uri) {
  s_server = &server;

  s_events.onOpen([](PsychicEventSourceClient *client) {
    // Already on the httpd task, so this one send needs no detour. The full
    // state on connect is what makes a /status endpoint unnecessary.
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
  enqueue("stateUpdate", payload);
}

}  // namespace sse_hub
