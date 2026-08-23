#include "config/hardware_store.h"
#include "audio.h"

#include <cstdio>
#include <cstring>

#include "config.h"
#include "esp_log.h"
#include "sdkconfig.h"

#if CONFIG_RT_AUDIO_ENABLED
#include "backend_issue.h"
#include "driver/i2s_std.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "sse_hub.h"
#endif

namespace audio {

#if !CONFIG_RT_AUDIO_ENABLED

// No DAC on this board. Programs still run and the API still lists audio; the
// clips simply do not play, which is a legitimate configuration for a target
// that only turns.
bool init() {
  return true;
}
void play(const std::vector<std::string> &) {}
bool is_playing(const std::string &) {
  return false;
}
bool probe_wav(const char *, rt::WavInfo &) {
  return false;
}

#else

namespace {

const char *TAG = "audio";

i2s_chan_handle_t s_tx = nullptr;
QueueHandle_t s_queue = nullptr;
// Guards s_tx across the reconfigure/enable/disable a clip does, so a queued
// clip cannot start while the previous one is tearing down.
SemaphoreHandle_t s_i2s_lock = nullptr;
// The clip the audio task has open right now, or empty. Guarded by s_i2s_lock.
std::string s_playing;

// One queued playlist. Sent by pointer through the queue and deleted by the
// playback task.
using Playlist = std::vector<std::string>;

// Adapts a stdio FILE* to rt::ByteSource. All the validation lives in
// lib/rt_logic/wav_header.cpp, where host_test/test_wav_header covers it;
// this is only the I/O.
class FileSource : public rt::ByteSource {
 public:
  explicit FileSource(FILE *f) : f_(f) {
    fseek(f_, 0, SEEK_END);
    const long end = ftell(f_);
    size_ = end > 0 ? static_cast<uint64_t>(end) : 0;
  }

  size_t read_at(uint64_t offset, void *out, size_t len) override {
    if (offset > size_) return 0;
    if (fseek(f_, static_cast<long>(offset), SEEK_SET) != 0) return 0;
    return fread(out, 1, len, f_);
  }

  uint64_t size() const override { return size_; }

 private:
  FILE *f_;
  uint64_t size_ = 0;
};

void play_one(const std::string &path) {
  rt::WavInfo info;
  FILE *f = fopen(path.c_str(), "rb");
  if (f == nullptr) {
    ESP_LOGE(TAG, "Cannot open %s", path.c_str());
    // The run carries on silently either way - the point of the frame is that
    // a shooter at the line otherwise has no way to tell a missing start
    // signal from one that was never scheduled.
    sse_hub::broadcast_issue(rt::issue_code::kAudioPlaybackFailed, "Audio clip could not be opened",
                             {{"clip", path}});
    return;
  }
  FileSource source(f);
  if (!rt::parse_wav_header(source, info) ||
      fseek(f, static_cast<long>(info.data_offset), SEEK_SET) != 0) {
    ESP_LOGE(TAG, "Not a playable WAV: %s", path.c_str());
    sse_hub::broadcast_issue(rt::issue_code::kAudioPlaybackFailed,
                             "Audio clip is not a playable WAV", {{"clip", path}});
    fclose(f);
    return;
  }

  xSemaphoreTake(s_i2s_lock, portMAX_DELAY);
  s_playing = path;

  // Clips are generated at a range of sample rates, so the clock is set per
  // clip rather than once at init.
  i2s_std_clk_config_t clk = I2S_STD_CLK_DEFAULT_CONFIG(info.sample_rate);
  if (i2s_channel_reconfig_std_clock(s_tx, &clk) != ESP_OK || i2s_channel_enable(s_tx) != ESP_OK) {
    ESP_LOGE(TAG, "I2S setup failed for %s", path.c_str());
    sse_hub::broadcast_issue(rt::issue_code::kAudioPlaybackFailed,
                             "Audio output could not be configured for this clip",
                             {{"clip", path}});
    s_playing.clear();
    xSemaphoreGive(s_i2s_lock);
    fclose(f);
    return;
  }

  // static, not stack: together these are 3 KB, which a 4 KB task stack cannot
  // hold alongside its call frames. Safe because play_one() only ever runs on
  // the single playback task.
  static uint8_t chunk[kAudioChunkBytes];
  // Mono is duplicated into both channels, so the write buffer is twice the
  // read buffer - the PCM5102A is wired as a stereo DAC either way.
  static uint8_t stereo[kAudioChunkBytes * 2];
  uint64_t remaining = info.data_bytes;

  while (remaining > 0) {
    const size_t want = remaining < sizeof(chunk) ? static_cast<size_t>(remaining) : sizeof(chunk);
    const size_t got = fread(chunk, 1, want, f);
    if (got == 0) break;
    remaining -= got;

    const uint8_t *out = chunk;
    size_t out_bytes = got;
    if (info.channels == 1) {
      // Whole 16-bit frames only: an odd tail byte is half a sample, and
      // doubling `got` for it would emit two bytes of the previous clip still
      // sitting in the static buffer.
      const size_t pairs = got & ~static_cast<size_t>(1);
      for (size_t i = 0; i < pairs; i += 2) {
        stereo[i * 2 + 0] = chunk[i];
        stereo[i * 2 + 1] = chunk[i + 1];
        stereo[i * 2 + 2] = chunk[i];
        stereo[i * 2 + 3] = chunk[i + 1];
      }
      out = stereo;
      out_bytes = pairs * 2;
    }

    size_t written = 0;
    i2s_channel_write(s_tx, out, out_bytes, &written, portMAX_DELAY);
  }

  i2s_channel_disable(s_tx);
  s_playing.clear();
  xSemaphoreGive(s_i2s_lock);
  fclose(f);
  ESP_LOGD(TAG, "Played %s", path.c_str());
}

void playback_task(void *) {
  Playlist *list = nullptr;
  while (true) {
    if (xQueueReceive(s_queue, &list, portMAX_DELAY) == pdTRUE && list != nullptr) {
      for (const std::string &path : *list) play_one(path);
      delete list;
      list = nullptr;
    }
  }
}

}  // namespace

bool is_playing(const std::string &path) {
  if (s_i2s_lock == nullptr) return false;
  xSemaphoreTake(s_i2s_lock, portMAX_DELAY);
  const bool playing = !s_playing.empty() && s_playing == path;
  xSemaphoreGive(s_i2s_lock);
  return playing;
}

bool probe_wav(const char *path, rt::WavInfo &out) {
  FILE *f = fopen(path, "rb");
  if (f == nullptr) return false;
  FileSource source(f);
  const bool ok = rt::parse_wav_header(source, out);
  fclose(f);
  return ok;
}

bool init() {
  s_i2s_lock = xSemaphoreCreateMutex();
  // Depth 1: a playlist waiting to start is always superseded by a newer one
  // (see play()), so there is never a reason to hold more than one.
  s_queue = xQueueCreate(1, sizeof(Playlist *));
  if (s_i2s_lock == nullptr || s_queue == nullptr) return false;

  // The port and the three pins come from the store (#144); a club whose board
  // wires the DAC differently says so rather than rebuilding.
  const rt::HardwareConfig &hw = hardware_store::current();
  i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(hw.i2s_port, I2S_ROLE_MASTER);
  chan_cfg.auto_clear = true;
  if (i2s_new_channel(&chan_cfg, &s_tx, nullptr) != ESP_OK) {
    ESP_LOGE(TAG, "i2s_new_channel failed");
    return false;
  }

  i2s_std_config_t std_cfg = {
      .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(44100),
      .slot_cfg =
          I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
      .gpio_cfg =
          {
              .mclk = I2S_GPIO_UNUSED,
              .bclk = static_cast<gpio_num_t>(hw.i2s_bck_gpio),
              .ws = static_cast<gpio_num_t>(hw.i2s_ws_gpio),
              .dout = static_cast<gpio_num_t>(hw.i2s_dout_gpio),
              .din = I2S_GPIO_UNUSED,
              .invert_flags = {false, false, false},
          },
  };
  if (i2s_channel_init_std_mode(s_tx, &std_cfg) != ESP_OK) {
    ESP_LOGE(TAG, "i2s_channel_init_std_mode failed");
    return false;
  }

  // Priority 5 keeps it above the httpd and run-loop tasks: an underrun is
  // audible on the range, a few ms of added REST latency is not.
  if (xTaskCreate(playback_task, "audio", 4096, nullptr, 5, nullptr) != pdPASS) {
    ESP_LOGE(TAG, "Failed to start playback task");
    return false;
  }

  ESP_LOGI(TAG, "I2S ready (port=%d BCK=%d WS=%d DIN=%d)", static_cast<int>(hw.i2s_port),
           static_cast<int>(hw.i2s_bck_gpio), static_cast<int>(hw.i2s_ws_gpio),
           static_cast<int>(hw.i2s_dout_gpio));
  return true;
}

void play(const std::vector<std::string> &paths) {
  if (s_queue == nullptr || paths.empty()) return;

  Playlist *list = new Playlist(paths);
  if (xQueueSend(s_queue, &list, 0) == pdTRUE) return;

  // Queue full: drop whatever was waiting and replace it. The newest request
  // is the one that matches where the run actually is.
  Playlist *stale = nullptr;
  if (xQueueReceive(s_queue, &stale, 0) == pdTRUE) delete stale;
  if (xQueueSend(s_queue, &list, 0) != pdTRUE) delete list;
}

#endif  // CONFIG_RT_AUDIO_ENABLED

}  // namespace audio
