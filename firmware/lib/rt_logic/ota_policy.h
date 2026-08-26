#pragma once

#include <cstdint>
#include <cstring>

// Whether a firmware image may be accepted, and why not.
//
// In rt_logic rather than main/ because these are decisions, not effects: the
// ESP-IDF calls that write flash live in main/net/ota.cpp, and everything that
// says *no* lives here where a host test reaches it. Two of the three refusals
// are safety rules rather than plumbing, and a safety rule that only exists
// inside an HTTP handler is one nobody can test.
namespace rt::ota {

enum class Refusal {
  kNone,
  // A program is running. Not "stop it for them": the targets are mid-sequence
  // and somebody may be downrange acting on what the sequence is doing.
  // Rebooting into a new image underneath that is not ours to decide.
  kProgramRunning,
  // The image is for a different project. Secure boot is off, so this is the
  // only thing standing between a held lock and arbitrary firmware.
  kProjectMismatch,
  // Nothing arrived, or not enough to be an image.
  kEmptyImage,
};

// Checked when the upload starts, before a byte is written to the inactive
// slot.
constexpr Refusal check_start(bool program_running) {
  return program_running ? Refusal::kProgramRunning : Refusal::kNone;
}

// Checked once the image has landed but *before* it is finalised, so a bad one
// can be aborted rather than finished and then disowned. `image_project` comes
// from the written partition's app description, `running_project` from ours.
inline Refusal check_image(const char *image_project, const char *running_project,
                           uint64_t bytes_written) {
  // An esp_app_desc_t header alone is 256 bytes; anything at or under that is
  // not an image, whatever it claims.
  if (bytes_written <= 256) return Refusal::kEmptyImage;
  if (image_project == nullptr || running_project == nullptr) return Refusal::kProjectMismatch;
  // Bounded: the field is a fixed-width char array in the header, not
  // necessarily terminated.
  if (std::strncmp(image_project, running_project, 32) != 0) return Refusal::kProjectMismatch;
  return Refusal::kNone;
}

// The sentence a client is given. Written for somebody standing at a range with
// a phone, not for a log.
constexpr const char *message(Refusal refusal) {
  switch (refusal) {
    case Refusal::kNone:
      return "";
    case Refusal::kProgramRunning:
      return "A program is running - stop it before updating the firmware";
    case Refusal::kProjectMismatch:
      return "That firmware is for a different device - upload refused";
    case Refusal::kEmptyImage:
      return "The upload was empty or too small to be a firmware image";
  }
  return "";
}

}  // namespace rt::ota
