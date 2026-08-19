// ============================================================================
//  main/app_main.cpp
//  Boot order: hardware, storage, repositories, network, server.
// ============================================================================
#include "audio.h"
#include "audios.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "program_executor.h"
#include "programs.h"
#include "rgb_led.h"
#include "storage.h"
#include "targets.h"
#include "web_server.h"
#include "wifi_mgr.h"

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
  rgb_led::red();

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

  // Starts the run loop and drives the targets to the hidden position, which
  // is what the first stateUpdate a client receives will say.
  executor::init();

  if (!wifi_mgr::connect()) {
    ESP_LOGE(TAG, "Network unavailable - restarting");
    vTaskDelay(pdMS_TO_TICKS(5000));
    esp_restart();
  }

  web_server::start();
  rgb_led::green();

  ESP_LOGI(TAG, "Ready on http://%s", wifi_mgr::ip_address().c_str());

  // Mark the running image good so the bootloader stops holding the previous
  // one in reserve; reaching here means storage, audio and the server all came
  // up. Only meaningful after an OTA - a no-op on a serial flash.
  esp_ota_mark_app_valid_cancel_rollback();
}
