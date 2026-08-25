// ============================================================================
//  storage/embedded_fs.h
//  A read-only filesystem baked into the application image.
// ============================================================================
#pragma once

#include <cstddef>

// The web app used to live in the `storage` LittleFS partition, which an OTA
// does not write - so a firmware update over the air shipped new firmware
// against the *old* bundle, and the two could only be brought back into step
// with a cable (#223, superseded by #227).
//
// Here it is part of the app image instead: one artifact, one version, one
// OTA, and the A/B rollback the app slots already provide covers it for free.
// Version drift between firmware and web app stops being something a
// convention has to prevent and becomes impossible.
//
// It is exposed as a VFS rather than as a lookup API on purpose. Everything
// that reads shipped content - the vendored static file handler, the SPA
// fallback, and later the audio and program loaders - goes through `fopen`,
// `stat` and `fread`. Registering a filesystem means none of them has to know
// where the bytes came from, and the alternative (an `if embedded ... else
// file ...` at every read site) is the shape that rots.
namespace embedded_fs {

// Registers the read-only filesystem at kEmbeddedMount. Returns false only if
// the VFS table is full, which is a build-time mistake rather than a runtime
// condition.
bool init();

// How much of the app image the embedded content occupies, for diagnostics.
size_t size_bytes();

// How many files it holds.
size_t file_count();

}  // namespace embedded_fs
