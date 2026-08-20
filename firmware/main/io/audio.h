#pragma once

#include <string>
#include <vector>

#include "wav_header.h"

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

// Parses and validates the header; see lib/rt_logic/wav_header.h.
bool probe_wav(const char *path, rt::WavInfo &out);

// Whether `path` is the clip the audio task currently has open. LittleFS has
// no POSIX unlink-while-open semantics, so deleting a playing clip corrupts
// the read rather than deferring - callers check first and refuse.
bool is_playing(const std::string &path);

}  // namespace audio
