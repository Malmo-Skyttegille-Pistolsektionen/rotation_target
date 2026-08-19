# 1. Port the rotation target backend to native ESP-IDF

Date: 2026-08-19

## Status

Accepted

## Context

The rotation target backend runs on an ESP32-S3-DevKitC-1 N16R8 and is
currently MicroPython + Microdot. That stack has served the club well, but the
device is on a live range and a few properties of it have become limits:

- **No OTA and no rollback.** Updating means `mpremote` over USB, per device.
- **Failure is silent.** An unhandled exception drops to a REPL or reboots with
  nothing recorded; there is no core dump and no watchdog.
- **Timing is coarse.** The run loop's accuracy is bounded by the interpreter,
  and audio playback shares the same asyncio loop as the HTTP server.
- **The test suite could not reach the hardware boundary.** Firmware modules
  had to be stubbed wholesale in `conftest.py`, and the executor tests drove
  real `asyncio.sleep`s, which made timing assertions loose.

`AutoLee` — the club's other ESP32 firmware — had already moved from
Arduino/PlatformIO to native ESP-IDF and established a working shape: pure
logic in a component shared by the firmware and host tests, vendored
PsychicHttp for REST + SSE, Unity suites under `host_test/`.

## Decision

Port the backend to native ESP-IDF (C++17, `idf.py`), following AutoLee's
structure:

- Hardware-independent logic in `lib/rt_logic/`, registered as an ESP-IDF
  component and compiled unchanged into the host tests.
- `rt::Executor` takes its clock and side effects by reference, so the run
  state machine is driven deterministically on the host.
- PsychicHttp (vendored, MIT) for REST and `PsychicEventSource` for `/sse/v2`.
- ArduinoJson vendored as the single-header release rather than pulled from the
  component registry, so `host_test/` parses with the same code the firmware
  does without needing the Component Manager.
- The shipped audio and programs come from the `rotation_target_backend_resources`
  repository as a submodule and are flashed as a LittleFS image, rather than
  being copied into this repo as the MicroPython backend did.

The API contract (`docs/api-v2.md`) is unchanged: this is a reimplementation
behind the same wire format, not a redesign.

## Consequences

**Gained:** dual OTA slots with rollback, task and interrupt watchdogs with
panic, core dump to flash, brownout detection, a run loop that wakes on event
and second boundaries within 200 ms, audio on its own task at its own priority,
and a host test suite that exercises the real executor with no sleeps.

**Cost:** C++ instead of Python, a toolchain to install, and a second backend
implementing the same contract — the two can drift. `docs/api-v2.md` is the
shared contract that has to stay true of both, and the deviations section is
where any divergence must be recorded.

**Not carried over:** the `wifi_credentials.py` multi-network list. Credentials
are `sdkconfig` values (`CONFIG_RT_WIFI_SSID`/`_PASSWORD`), still out of git,
but only one network. If the club needs the fallback list back, it should be
NVS-backed and settable over the API rather than compiled in.
