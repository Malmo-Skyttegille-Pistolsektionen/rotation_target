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
// The state the firmware puts the targets in at boot. Reported to clients as
// well as driven onto the pin, so the two cannot disagree.
#ifdef CONFIG_RT_TARGETS_HIDE_AT_BOOT
constexpr bool kTargetsShownAtBoot = false;
#else
constexpr bool kTargetsShownAtBoot = true;
#endif

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

// The read-only filesystem baked into the app image (#227). Not a partition:
// it is .rodata in the application, so an OTA replaces it along with the
// firmware and nothing can write to it at all. See storage/embedded_fs.h.
constexpr const char *kEmbeddedMount = "/embedded";
// The built web app, served from there. Text assets are pre-compressed and only
// the `.gz` is shipped; the vendored static handler probes for it.
constexpr const char *kWebappDir = "/embedded/webapp/";
constexpr const char *kWebappIndex = "/embedded/webapp/index.html";
// Flashed with the firmware, never written to at runtime.
constexpr const char *kShippedAudioDir = "/storage/shipped/audio";
constexpr const char *kShippedProgramDir = "/storage/shipped/programs";
// Created on first upload.
constexpr const char *kUploadAudioDir = "/storage/uploads/audio";
constexpr const char *kUploadProgramDir = "/storage/uploads/programs";

// The id ranges: below this is shipped, at or above it is uploaded. A shipped
// resource landing inside the upload range is shadowed by an upload at the same
// id, which #129 found - so the boundary sits well clear of the shipped set
// rather than just above it. Kept in lock-step with FIRST_UPLOAD_ID in
// resources/programs/validate_programs.sh, which enforces it.
constexpr int32_t kFirstUploadId = 1000;

// --- HTTP ------------------------------------------------------------------

constexpr uint16_t kHttpPort = CONFIG_RT_HTTP_PORT;
// Heartbeat cadence on /sse/v2, per docs/api-v2.md.
constexpr int kSseHeartbeatSeconds = 10;
// Ceiling on an uploaded program document or audio file.
constexpr size_t kMaxUploadBytes = 1024 * 1024;

// Firmware is the one upload that legitimately exceeds the ceiling above: the
// app image is already past 1 MB and the slot it goes into is 3 MB. Sized to
// the slot, so the limit that rejects an oversized upload is the same limit
// that would have run out of flash anyway.
constexpr size_t kMaxFirmwareUploadBytes = 3 * 1024 * 1024;
// How many boot-time backend_issues GET /api/v2/diagnostics/info keeps. They
// are raised before the SSE hub has a server and would otherwise be dropped;
// beyond this many the oldest is discarded. Sized for "a handful of stored
// programs went bad", which is what the boot scan can actually produce -
// enough to name them, small enough that a corrupt directory cannot grow the
// heap without bound.
constexpr size_t kMaxStartupIssues = 8;
