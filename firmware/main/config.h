// ============================================================================
//  main/config.h
//  Board configuration, derived from Kconfig.
//
//  Nothing here is hardcoded: every pin, polarity and optional peripheral is a
//  `menuconfig` setting under "Rotation target backend -> Hardware", so a
//  different board is a different `sdkconfig`, not a source edit.
//
//  The defaults are the REVOLVENOW Rev 1 board (ESP32-S3-WROOM-1 N16R8), taken
//  from the MicroPython backend's `src/backend/config.py`, which ran on this
//  same hardware. Note that file's "ESP32-C6" comments are stale - the pin
//  numbers next to them are right, the chip name is not.
// ============================================================================
#pragma once

#include "driver/gpio.h"
#include "sdkconfig.h"

#if CONFIG_RT_AUDIO_ENABLED
#include "driver/i2s_std.h"
#include "driver/i2s_types.h"
#endif

// --- Target control --------------------------------------------------------

constexpr gpio_num_t kTargetPin = static_cast<gpio_num_t>(CONFIG_RT_TARGET_GPIO);

// Which level shows the targets. On the prototype the GPIO drives a BC547B
// whose low state opens the connection; a board that inverts or buffers the
// signal sets CONFIG_RT_TARGET_ACTIVE_LOW=n instead of patching this.
#if CONFIG_RT_TARGET_ACTIVE_LOW
constexpr int kTargetLevelShown = 0;
constexpr int kTargetLevelHidden = 1;
#else
constexpr int kTargetLevelShown = 1;
constexpr int kTargetLevelHidden = 0;
#endif

// --- Status LED ------------------------------------------------------------

#if CONFIG_RT_RGB_LED_ENABLED
constexpr gpio_num_t kRgbLedPin = static_cast<gpio_num_t>(CONFIG_RT_RGB_LED_GPIO);
#endif

// --- Audio (I2S DAC, e.g. PCM5102A) ---------------------------------------

#if CONFIG_RT_AUDIO_ENABLED
// ESP-IDF 6.0 dropped i2s_port_t; i2s_chan_config_t::id is a plain int.
constexpr int kI2sPort = CONFIG_RT_I2S_PORT;
constexpr gpio_num_t kI2sBckPin = static_cast<gpio_num_t>(CONFIG_RT_I2S_BCK_GPIO);
constexpr gpio_num_t kI2sLckPin = static_cast<gpio_num_t>(CONFIG_RT_I2S_WS_GPIO);
constexpr gpio_num_t kI2sDinPin = static_cast<gpio_num_t>(CONFIG_RT_I2S_DOUT_GPIO);

// Read this much of a WAV at a time. Mono clips are duplicated to both
// channels on the way out, so the I2S write can be twice this.
constexpr size_t kAudioChunkBytes = 1024;
#endif

// --- Storage ---------------------------------------------------------------

// LittleFS mount point for the `storage` partition (see partitions.csv).
constexpr const char *kStorageMount = "/storage";
// Flashed with the firmware, never written to at runtime.
constexpr const char *kShippedAudioDir = "/storage/shipped/audio";
constexpr const char *kShippedProgramDir = "/storage/shipped/programs";
// Created on first upload.
constexpr const char *kUploadAudioDir = "/storage/uploads/audio";
constexpr const char *kUploadProgramDir = "/storage/uploads/programs";

// Uploaded programs and audio are numbered from here, keeping them clear of
// the shipped ids.
constexpr int32_t kFirstUploadId = 100;

// --- HTTP ------------------------------------------------------------------

constexpr uint16_t kHttpPort = CONFIG_RT_HTTP_PORT;
// Heartbeat cadence on /sse/v2, per docs/api-v2.md.
constexpr int kSseHeartbeatSeconds = 10;
// Ceiling on an uploaded program document or audio file.
constexpr size_t kMaxUploadBytes = 1024 * 1024;
