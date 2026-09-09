#include "ota.h"

#include <cstring>
#include <string>

#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_ota_ops.h"

#include "ota_policy.h"
#include "problem.h"
#include "program_executor.h"
#include "restart.h"
#include "sse_hub.h"

namespace ota {
namespace {
const char *TAG = "ota";

esp_ota_handle_t s_handle = 0;
const esp_partition_t *s_partition = nullptr;
volatile bool s_in_progress = false;
uint64_t s_written = 0;

// Set when the image is accepted; device_restart::schedule leaves long enough
// for the HTTP response to be delivered before the chip restarts.
volatile bool s_reboot_pending = false;

// The image landed and is the boot partition, but no restart could be started.
// Sticky until a power cycle: see the guard at the top of onUpload.
volatile bool s_installed_awaiting_power_cycle = false;

// Why the last upload was refused, so onRequest can answer with the status the
// contract declares rather than a blanket 400.
rt::ota::Refusal s_refusal = rt::ota::Refusal::kNone;

// Reset the bookkeeping. Does NOT touch the driver - call only after the handle
// has been released, by esp_ota_end or esp_ota_abort.
void clear() {
  s_handle = 0;
  s_partition = nullptr;
  s_in_progress = false;
  s_written = 0;
}

// Abort an upload whose handle is still open. Must not run after esp_ota_end,
// which has already freed it.
void abort_upload(const char *why) {
  ESP_LOGE(TAG, "Aborting: %s", why);
  if (s_handle != 0) esp_ota_abort(s_handle);
  clear();
}

void raise(rt::ota::Refusal refusal) {
  sse_hub::broadcast_issue("ota_refused", rt::ota::message(refusal));
}

}  // namespace

bool in_progress() {
  return s_in_progress;
}

void register_routes(PsychicHttpServer &server) {
  static PsychicUploadHandler upload;

  upload.onUpload([](PsychicRequest *request, const char *filename, uint64_t index, uint8_t *data,
                     size_t len, bool final) -> esp_err_t {
    if (index == 0) {
      ESP_LOGI(TAG, "Upload '%s' starting", filename == nullptr ? "(unnamed)" : filename);

      // The contract requires multipart/form-data. A raw body that is refused
      // is answered by the upload handler itself and never reaches onRequest,
      // so anything recorded for it would be reported to whoever asks next.
      // Refused before anything is recorded, which is what keeps "nothing
      // survives a request" true.
      if (request != nullptr && !request->isMultipart()) {
        ESP_LOGW(TAG, "Refused: not a multipart upload");
        return ESP_FAIL;
      }

      // Per request; the power-cycle flag deliberately survives, it is not
      // about one request.
      s_reboot_pending = false;
      s_refusal = rt::ota::Refusal::kNone;

      // Nothing may be written while an installed image is waiting for a power
      // cycle: the inactive slot is now the *boot* partition, so
      // esp_ota_get_next_update_partition would hand back the image somebody is
      // waiting to run and the first write would erase it. Refused before the
      // partition is even looked up; onRequest answers off the same flag.
      if (s_installed_awaiting_power_cycle) {
        ESP_LOGW(TAG, "Refused: an installed image is waiting for a power cycle");
        return ESP_FAIL;
      }

      // Reclaim a handle a previous upload leaked. A client that vanishes
      // mid-transfer never delivers a final chunk, so nothing else closes it.
      if (s_handle != 0) abort_upload("leftover handle from an abandoned upload");

      const rt::ota::Refusal refusal = rt::ota::check_start(executor::is_running());
      if (refusal != rt::ota::Refusal::kNone) {
        ESP_LOGW(TAG, "Refused: %s", rt::ota::message(refusal));
        s_refusal = refusal;
        raise(refusal);
        return ESP_FAIL;
      }

      s_partition = esp_ota_get_next_update_partition(nullptr);

      // Sized from Content-Length rather than OTA_SIZE_UNKNOWN. Unknown makes
      // esp_ota_begin erase the whole 3 MB slot before the first byte is
      // written, synchronously, on this HTTP task - measured on hardware as the
      // server going unresponsive for long enough that the client gave up and
      // the device looked hung. Erasing only what the image needs takes a
      // fraction of that. The multipart envelope makes Content-Length slightly
      // larger than the image, which is harmless: a little over is still far
      // under the slot.
      size_t erase_size = OTA_SIZE_UNKNOWN;
      const size_t declared =
          request == nullptr ? 0 : static_cast<size_t>(request->contentLength());
      if (declared > 0 && declared <= s_partition->size) erase_size = declared;

      if (s_partition == nullptr || esp_ota_begin(s_partition, erase_size, &s_handle) != ESP_OK) {
        ESP_LOGE(TAG, "Could not open the inactive slot");
        s_handle = 0;  // a failed begin leaves nothing to abort
        clear();
        return ESP_FAIL;
      }
      s_in_progress = true;
      s_written = 0;
    }

    if (s_handle == 0) return ESP_FAIL;

    if (esp_ota_write(s_handle, data, len) != ESP_OK) {
      abort_upload("write failed");
      return ESP_FAIL;
    }
    s_written += len;

    if (!final) return ESP_OK;

    // Identity is checked while the handle is still open, so a foreign image is
    // aborted rather than finalised and then disowned. It must never be the
    // boot partition, even for an instant.
    esp_app_desc_t written = {};
    const esp_app_desc_t *running = esp_app_get_description();
    const bool readable = esp_ota_get_partition_description(s_partition, &written) == ESP_OK;

    const rt::ota::Refusal refusal =
        readable ? rt::ota::check_image(written.project_name, running->project_name, s_written)
                 : rt::ota::Refusal::kProjectMismatch;
    if (refusal != rt::ota::Refusal::kNone) {
      ESP_LOGE(TAG, "Refused: %s (image '%s', running '%s')", rt::ota::message(refusal),
               readable ? written.project_name : "unreadable", running->project_name);
      s_refusal = refusal;
      raise(refusal);
      abort_upload("image refused");
      return ESP_FAIL;
    }

    // esp_ota_end frees the handle either way, so neither branch may abort.
    if (esp_ota_end(s_handle) != ESP_OK) {
      ESP_LOGE(TAG, "Image failed validation");
      clear();
      return ESP_FAIL;
    }
    if (esp_ota_set_boot_partition(s_partition) != ESP_OK) {
      ESP_LOGE(TAG, "Could not set the boot partition");
      clear();
      return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Accepted %llu bytes, version '%s' - restarting shortly", s_written,
             written.version);
    clear();
    // Only once the restart is on its way: an image that will boot but never
    // does is worse than a refusal.
    s_reboot_pending = device_restart::schedule("into the new firmware");
    if (!s_reboot_pending) {
      s_installed_awaiting_power_cycle = true;
      return ESP_FAIL;
    }
    return ESP_OK;
  });

  upload.onRequest([](PsychicRequest *req, PsychicResponse *res) -> esp_err_t {
    (void)req;

    // Read and clear, before anything can return. A multipart body whose file
    // part is empty or missing never reaches onUpload at all -
    // MultipartProcessor guards the final callback with `if (_itemSize)` - so
    // without this a request that wrote nothing would answer with the previous
    // upload's outcome.
    const bool restarting = s_reboot_pending;
    const rt::ota::Refusal reported = s_refusal;
    s_reboot_pending = false;
    s_refusal = rt::ota::Refusal::kNone;

    if (restarting) {
      res->setCode(200);
      res->setContentType("application/json");
      res->setContent("{\"status\":\"accepted\",\"restarting\":true}");
      return res->send();
    }

    // Not read-and-cleared, unlike the two above: it holds until the device is
    // power-cycled, so every upload attempted in the meantime gets this answer
    // rather than the "empty image" a cleared flag would fall through to.
    if (s_installed_awaiting_power_cycle) {
      const std::string body =
          rt::problem_json(rt::problem::kRestartFailed,
                           "The firmware was installed and is the boot partition, but the restart "
                           "could not be started. Power-cycle the device to run it.");
      res->setCode(rt::problem::kRestartFailed.status);
      res->setContentType(rt::kProblemContentType);
      res->setContent(body.c_str());
      return res->send();
    }

    // A refusal is a problem detail like every other error (D-19), and the
    // status distinguishes them: a running program is a conflict that clears on
    // its own, a bad image never will. onUpload cannot answer for itself -
    // returning ESP_FAIL is how it reports - so the reason is carried here.
    const rt::ota::Refusal refusal =
        reported == rt::ota::Refusal::kNone ? rt::ota::Refusal::kEmptyImage : reported;
    const auto &type = refusal == rt::ota::Refusal::kProgramRunning ? rt::problem::kProgramRunning
                                                                    : rt::problem::kOtaImageRefused;
    const std::string body = rt::problem_json(type, rt::ota::message(refusal));
    res->setCode(type.status);
    res->setContentType(rt::kProblemContentType);
    res->setContent(body.c_str());
    return res->send();
  });

  server.on("/api/v2/ota", HTTP_POST, &upload);
}

}  // namespace ota
