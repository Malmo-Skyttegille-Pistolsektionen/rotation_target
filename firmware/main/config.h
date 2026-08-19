// ============================================================================
//  main/config.h
//  Pins and tuning constants. Ported from src/backend/config.py of the
//  MicroPython backend, which is the authority on the wiring in place.
// ============================================================================
#pragma once

#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "driver/i2s_types.h"

// --- Target control --------------------------------------------------------

// Drives a BC547B NPN transistor into DB9 pin 2 (see README's wiring table).
// The pin powers up LOW, which is the *shown* position - app_main() drives it
// high at boot so the hardware matches the "hidden" state clients are told
// about on connect.
constexpr gpio_num_t kTargetPin = GPIO_NUM_5;
// Low opens the connection (targets shown), high closes it (targets hidden).
constexpr int kTargetLevelShown = 0;
constexpr int kTargetLevelHidden = 1;

// --- Status LED ------------------------------------------------------------

// The ESP32-S3-DevKitC-1's onboard addressable WS2812.
constexpr gpio_num_t kRgbLedPin = GPIO_NUM_48;

// --- Audio (PCM5102A over I2S) --------------------------------------------

// ESP-IDF 6.0 dropped i2s_port_t; i2s_chan_config_t::id is a plain int.
constexpr int kI2sPort = I2S_NUM_0;
constexpr gpio_num_t kI2sBckPin = GPIO_NUM_10;  // Bit clock
constexpr gpio_num_t kI2sDinPin = GPIO_NUM_11;  // Data in
constexpr gpio_num_t kI2sLckPin = GPIO_NUM_12;  // Word select (LRCK)

// Read this much of a WAV at a time. Mono clips are duplicated to both
// channels on the way out, so the I2S write can be twice this.
constexpr size_t kAudioChunkBytes = 1024;

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

constexpr uint16_t kHttpPort = 80;
// Heartbeat cadence on /sse/v2, per docs/api-v2.md.
constexpr int kSseHeartbeatSeconds = 10;
// Ceiling on an uploaded program document or audio file.
constexpr size_t kMaxUploadBytes = 1024 * 1024;
