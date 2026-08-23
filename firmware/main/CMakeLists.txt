# Sources are grouped by concern (io / storage / repositories / executor / net)
# rather than sitting flat. Every group is also on INCLUDE_DIRS, so
# `#include "targets.h"` works regardless of which group the including file
# lives in - the grouping is for humans navigating the tree, not a module
# boundary the compiler enforces.

# Exactly one implementation of net_mgr.h is compiled: WiFi on the board, or
# OpenCores Ethernet under QEMU, which emulates no radio. With wifi_mgr out of
# the build the setup portal and the NVS credential store are not merely
# unused, they are not linked in. See net/net_mgr.h and docs/QEMU.md.
#
# REQUIRES cannot be split the same way: it is collected in the early-expansion
# pass, before Kconfig values exist, so both stacks stay named there and the
# linker drops whichever one has no callers.
if(CONFIG_RT_NET_OPENETH)
    set(RT_NET_SRCS "net/eth_mgr.cpp")
else()
    set(RT_NET_SRCS "net/wifi_mgr.cpp" "net/wifi_store.cpp" "net/setup_portal.cpp")
endif()

idf_component_register(
    SRCS "app_main.cpp"
         "io/targets.cpp" "io/audio.cpp" "io/rgb_led.cpp"
         "storage/storage.cpp"
         "repositories/programs.cpp" "repositories/audios.cpp"
         "executor/program_executor.cpp"
         "ota/ota.cpp"
         "diagnostics/partitions.cpp" "console/console.cpp"
         ${RT_NET_SRCS}
         "net/web_server.cpp" "net/sse_hub.cpp"
    INCLUDE_DIRS "." "io" "storage" "repositories" "executor" "net" "diagnostics" "console" "ota"
    REQUIRES rt_logic arduinojson psychic_http
             nvs_flash esp_netif esp_event esp_timer esp_system
             esp_http_server app_update espcoredump
             esp_driver_gpio esp_driver_i2s
             joltwallet__littlefs espressif__led_strip espressif__mdns
             esp_wifi dns_server esp_eth esp_driver_usb_serial_jtag
)

# The tested half (host_test/) builds with -Wall -Wextra -Werror; without this
# the firmware half - the part that actually touches hardware - got no warnings
# at all. Not -Werror here: a toolchain bump raising a new warning in vendored
# or IDF headers should not stop the range device being rebuilt.
target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra)
