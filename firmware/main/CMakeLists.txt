# Sources are grouped by concern (io / storage / repositories / executor / net)
# rather than sitting flat. Every group is also on INCLUDE_DIRS, so
# `#include "targets.h"` works regardless of which group the including file
# lives in - the grouping is for humans navigating the tree, not a module
# boundary the compiler enforces.
idf_component_register(
    SRCS "app_main.cpp"
         "io/targets.cpp" "io/audio.cpp" "io/rgb_led.cpp"
         "storage/storage.cpp"
         "repositories/programs.cpp" "repositories/audios.cpp"
         "executor/program_executor.cpp"
         "net/wifi_mgr.cpp" "net/wifi_store.cpp" "net/setup_portal.cpp"
         "net/web_server.cpp" "net/sse_hub.cpp"
    INCLUDE_DIRS "." "io" "storage" "repositories" "executor" "net"
    REQUIRES rt_logic arduinojson psychic_http
             nvs_flash esp_wifi esp_netif esp_event esp_timer esp_system
             esp_http_server app_update espcoredump
             esp_driver_gpio esp_driver_i2s
             joltwallet__littlefs espressif__led_strip espressif__mdns dns_server
)

# The tested half (host_test/) builds with -Wall -Wextra -Werror; without this
# the firmware half - the part that actually touches hardware - got no warnings
# at all. Not -Werror here: a toolchain bump raising a new warning in vendored
# or IDF headers should not stop the range device being rebuilt.
target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra)
