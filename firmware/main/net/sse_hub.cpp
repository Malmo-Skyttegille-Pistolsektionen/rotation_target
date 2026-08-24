#include "sse_hub.h"

#include <PsychicHttp.h>
#include <errno.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>

#include <string>
#include <vector>

#include "config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "issue_buffer.h"
#include "program_executor.h"

namespace sse_hub {
namespace {

const char *TAG = "sse";

PsychicEventSource s_events;
PsychicHttpServer *s_server = nullptr;
esp_timer_handle_t s_heartbeat = nullptr;
uint32_t s_heartbeat_id = 0;

// backend_issues raised while there was no server to send them through, kept
// so GET /api/v2/diagnostics/info can answer for them. Serialized payloads,
// exactly as a connected client would have received them.
//
// No lock, and that is a property of when it is written rather than a bet:
// the only append is the branch below that runs while `s_server` is null, and
// `s_server` is set once, in attach(), before the HTTP server can accept the
// request that reads it. Writes therefore all happen-before every read.
//
// It is also single-writer today: programs::load_all() is the only caller that
// reaches broadcast_issue() before attach(), and it runs on the main task with
// no other task able to raise an issue - the audio path needs a clip queued by
// a run, and a run needs a request. **Adding a program rescan, or any other
// pre-server emitter on another task, means revisiting this.**
rt::IssueBuffer s_startup_issues(kMaxStartupIssues);

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
  // Also the guard for frames raised before the server exists: `s_server` is
  // null until attach() runs, and the boot-time program scan reports malformed
  // files long before that. Nothing to send them to, so they are dropped.
  if (s_server == nullptr || s_server->server == nullptr) return;

  auto *work = new Work{event, std::move(payload)};
  if (httpd_queue_work(s_server->server, send_on_httpd_task, work) != ESP_OK) {
    // The work queue is full - the httpd task is wedged or badly behind.
    // Dropping the frame beats blocking the caller, which may be the run loop.
    ESP_LOGW(TAG, "Dropped a '%s' frame: httpd work queue full", event);
    delete work;
  }
}

// Whether the peer on `sock` is still there.
//
// A send is NOT a liveness test: httpd_socket_send into a half-open TCP
// connection buffers locally and returns success, so PsychicEventSource never
// saw the failure that would have made it drop the client. A peek does see it -
// a cleanly closed peer makes recv return 0.
bool peer_is_alive(int sock) {
  char probe = 0;
  const ssize_t n = recv(sock, &probe, 1, MSG_PEEK | MSG_DONTWAIT);
  if (n > 0) return true;                          // unread data waiting
  if (n == 0) return false;                        // peer sent FIN
  return errno == EAGAIN || errno == EWOULDBLOCK;  // alive, nothing to read
}

// Drops SSE clients whose peer has gone. Without this they accumulate: each one
// holds an httpd socket, and once max_open_sockets is reached new connections
// are refused until lru_purge reclaims them one failed connection at a time.
// Observed on hardware as roughly five REST calls failing before one succeeded.
//
// Runs on the httpd task, like every other client-list access.
void reap_dead_clients(void *) {
  if (s_server == nullptr || s_server->server == nullptr) return;

  // The sockets are collected first and closed after: closing runs
  // PsychicHttp's close callback, which mutates the very list being walked.
  std::vector<int> dead;
  for (PsychicClient *client : s_events.getClientList()) {
    if (client != nullptr && !peer_is_alive(client->socket())) dead.push_back(client->socket());
  }

  for (int sock : dead) {
    ESP_LOGI(TAG, "Reaping dead SSE client %d", sock);
    httpd_sess_trigger_close(s_server->server, sock);
  }
}

void send_heartbeat(void *) {
  // Matches the MicroPython backend's shape: a monotonic id a client can use
  // to spot a missed beat.
  enqueue("heartbeat", "{\"id\":" + std::to_string(++s_heartbeat_id) + "}");

  // Same cadence as the heartbeat: a client that has gone is detected within
  // one beat rather than holding a socket until the device is rebooted.
  if (s_server != nullptr && s_server->server != nullptr) {
    httpd_queue_work(s_server->server, reap_dead_clients, nullptr);
  }
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
    // TCP keepalive as the backstop for a peer that vanishes without a FIN -
    // a phone going out of range or losing power. The peek test only catches a
    // clean close; without keepalive such a socket would linger indefinitely.
    const int enable = 1;
    const int idle_s = 30, interval_s = 10, count = 3;
    const int sock = client->socket();
    setsockopt(sock, SOL_SOCKET, SO_KEEPALIVE, &enable, sizeof(enable));
    setsockopt(sock, IPPROTO_TCP, TCP_KEEPIDLE, &idle_s, sizeof(idle_s));
    setsockopt(sock, IPPROTO_TCP, TCP_KEEPINTVL, &interval_s, sizeof(interval_s));
    setsockopt(sock, IPPROTO_TCP, TCP_KEEPCNT, &count, sizeof(count));

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

void broadcast_issue(const char *code, const std::string &message,
                     const rt::IssueContext &context) {
  std::string payload = rt::backend_issue_json(code, message, context);

  // Before the server exists there is nobody to send to and enqueue() would
  // drop this. Keep it instead: the boot scan is the only thing that reports a
  // stored program it could not parse, and dropping that left the program
  // simply missing from GET /api/v2/programs with no explanation anywhere.
  if (s_server == nullptr || s_server->server == nullptr) {
    s_startup_issues.push(std::move(payload));
    return;
  }

  enqueue("backend_issue", std::move(payload));
}

const std::vector<std::string> &startup_issues() {
  return s_startup_issues.entries();
}

void broadcast_library_changed(const char *kind) {
  enqueue("libraryChanged", rt::library_changed_json(kind));
}

void broadcast_config_window(bool open, int32_t remaining_s) {
  // Same shape as `writeWindow` in GET /config/hardware, so a client keeps one
  // value from two sources rather than reconciling two.
  std::string payload = "{\"open\":";
  payload += open ? "true" : "false";
  payload += ",\"remainingSeconds\":";
  payload += std::to_string(remaining_s);
  payload += "}";
  enqueue("configWindow", payload);
}

}  // namespace sse_hub
