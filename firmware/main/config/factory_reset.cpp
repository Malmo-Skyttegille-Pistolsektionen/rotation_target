#include "factory_reset.h"

#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

#if !CONFIG_RT_NET_OPENETH
#include "wifi_store.h"
#endif

namespace factory_reset {
namespace {
const char *TAG = "factory_reset";
}

void perform(const char *reason) {
  ESP_LOGW(TAG, "Factory reset (%s): erasing every stored setting", reason);

  // Erases the whole `nvs` partition, so a namespace nobody remembered to list
  // here goes with it. nvs_flash_erase() de-initialises first if it has to.
  const esp_err_t erased = nvs_flash_erase();
  if (erased != ESP_OK) {
    ESP_LOGE(TAG, "Could not erase NVS: %s", esp_err_to_name(erased));
  }

  // Brought back up only so the marker below has somewhere to live. Nothing
  // else runs between here and the restart.
  const esp_err_t reinit = nvs_flash_init();
  if (reinit != ESP_OK) {
    ESP_LOGE(TAG, "Could not re-initialise NVS: %s", esp_err_to_name(reinit));
  }

#if !CONFIG_RT_NET_OPENETH
  // An empty NVS is not a forgotten network: load_all() falls back to the
  // Kconfig seeds, and the device would rejoin the network the image was built
  // for instead of raising the portal. That is #222, and this is the line that
  // closes it.
  wifi_store::forget();
#endif

  ESP_LOGW(TAG, "Restarting - the setup portal will come up unless a network is already known");
  // The warnings above are still in the UART FIFO; esp_restart() would throw
  // them away, and this is the one operation where the log is the only record
  // of what happened.
  vTaskDelay(pdMS_TO_TICKS(200));
  esp_restart();
}

}  // namespace factory_reset
