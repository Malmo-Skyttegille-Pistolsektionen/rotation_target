#include "restart.h"

#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace device_restart {
namespace {
const char *TAG = "restart";

// Measured against the OTA response, which is the largest one that has to
// drain before a restart.
constexpr uint32_t kDrainMs = 1500;

void restart_task(void *why) {
  vTaskDelay(pdMS_TO_TICKS(kDrainMs));
  ESP_LOGW(TAG, "Restarting: %s", static_cast<const char *>(why));
  esp_restart();
}

}  // namespace

void schedule(const char *why) {
  // const_cast only to cross xTaskCreate's void* parameter; restart_task reads
  // it back as const.
  xTaskCreate(restart_task, "restart", 2048, const_cast<char *>(why == nullptr ? "" : why), 5,
              nullptr);
}

}  // namespace device_restart
