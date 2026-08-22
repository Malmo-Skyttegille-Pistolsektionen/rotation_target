// ============================================================================
//  main/app_main.cpp
//  Boot order: hardware, storage, repositories, network, server.
// ============================================================================
#include "audio.h"
#include "config.h"
#include "audios.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "net_mgr.h"
#include "nvs_flash.h"
#include "program_executor.h"
#include "programs.h"
#include "rgb_led.h"
#include "storage.h"
#include "console.h"
#include "targets.h"
#include "web_server.h"

namespace {

const char *TAG = "main";

void init_nvs() {
  esp_err_t err = nvs_flash_init();
  if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    // Only WiFi's own calibration data lives here - admin mode is deliberately
    // RAM-only - so erasing costs nothing but a slower first association.
    ESP_ERROR_CHECK(nvs_flash_erase());
    err = nvs_flash_init();
  }
  ESP_ERROR_CHECK(err);
}

}  // namespace

extern "C" void app_main() {
  const esp_app_desc_t *desc = esp_app_get_description();
  ESP_LOGI(TAG, "Rotation target backend %s (%s %s)", desc->version, desc->date, desc->time);

  init_nvs();

  rgb_led::init();
  rgb_led::status_joining();

  targets::init();

  if (!storage::init()) {
    // Without the filesystem there are no programs and no audio, so there is
    // nothing worth serving. Reboot rather than come up empty and look healthy.
    ESP_LOGE(TAG, "Storage unavailable - restarting");
    vTaskDelay(pdMS_TO_TICKS(5000));
    esp_restart();
  }

  programs::load_all();
  audios::load_all();

  if (!audio::init()) ESP_LOGE(TAG, "Audio unavailable - programs will run silently");

  // Starts the run loop, adopting the target state targets::init() already
  // drove onto the pin - so the first stateUpdate a client receives says what
  // it can see downrange, and nothing moves in between.
  executor::init(kTargetsShownAtBoot);

  if (net_mgr::connect() == net_mgr::Result::kSetupPortal) {
    // No usable network. Serving the setup AP is the useful thing to do -
    // rebooting into the same failure would just loop, and the club would have
    // no way to point the device at a different network without a toolchain.
    net_mgr::run_setup_portal();  // never returns; reboots once credentials are saved
  }

  if (!web_server::start()) {
    ESP_LOGE(TAG, "HTTP server unavailable - restarting");
    vTaskDelay(pdMS_TO_TICKS(5000));
    esp_restart();
  }

  // After the server, so `status` can report an address rather than a blank.

  console::init();
  rgb_led::status_serving();

  ESP_LOGI(TAG, "Ready on http://%s", net_mgr::ip_address().c_str());

  // Mark the running image good so the bootloader stops holding the previous
  // one in reserve; reaching here means storage, audio and the server all came
  // up. Only meaningful after an OTA - a no-op on a serial flash.
  ESP_ERROR_CHECK_WITHOUT_ABORT(esp_ota_mark_app_valid_cancel_rollback());
}
