#pragma once

#include <PsychicHttp.h>

// Firmware update over the air: the inactive app slot is written from an HTTP
// upload, verified, and made the boot partition.
//
// Rollback is the safety net and it already exists - the bootloader has
// CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE and app_main() calls
// esp_ota_mark_app_valid_cancel_rollback() once it is up. An image that boots
// but cannot get that far is rolled back to the slot this one came from, with
// no cable involved.
//
// What is NOT covered: the LittleFS image. The web app, the shipped programs
// and the audio live there, and this replaces only the app. A device updated
// this way serves the bundle it already had - see #142.
namespace ota {

// Registers POST /api/v2/ota on `server`. Admin-gated like the other writes.
void register_routes(PsychicHttpServer &server);

// True from the first byte of an upload until it finishes or is abandoned.
// The run loop refuses to start a program while this is true: a reboot is
// moments away and a program that begins now would be cut off mid-sequence.
bool in_progress();

}  // namespace ota
