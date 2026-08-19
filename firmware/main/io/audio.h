#pragma once

#include <string>
#include <vector>

// WAV playback over I2S to a PCM5102A.
//
// Playback runs on its own task: the run loop enters an event and moves on, and
// `POST /audios/{id}/play` acknowledges immediately rather than holding the
// HTTP response open for the length of the clip.
namespace audio {

bool init();

// Queue `paths` to play back to back. Replaces anything already queued but not
// yet started, so entering a new event does not stack up behind the last one.
void play(const std::vector<std::string> &paths);

// Describes a WAV this firmware can play: PCM, 16-bit, mono or stereo.
struct WavInfo {
  uint32_t sample_rate = 0;
  uint16_t channels = 0;
  uint32_t data_offset = 0;  // byte offset of the samples
  uint32_t data_bytes = 0;
};

// Parses and validates the header. False for anything not PCM/16-bit/1-2ch.
bool probe_wav(const char *path, WavInfo &out);

}  // namespace audio
