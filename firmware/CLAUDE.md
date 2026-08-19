# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Native **ESP-IDF** firmware (`idf.py`, no Arduino/PlatformIO) for an
**ESP32-S3-DevKitC-1 N16R8** (16 MB flash, 8 MB octal PSRAM) driving Malmö
Skyttegille Pistolsektionen's Eigenbrod TP2 rotation target system. It runs
shooting programs — turning the targets over a GPIO and playing spoken commands
over I2S — and serves the React webapp over REST (`/api/v2`) and SSE
(`/sse/v2`).

It is a port of `rotation_target_backend_esp32_micropython` at its API v2
revision. Both backends serve the same contract and are meant to stay
interchangeable from the webapp's point of view.

⚠️ This firmware controls targets on a live shooting range. The target position
and the audio commands are what tell shooters when to fire and when to stop.
Do not weaken the run loop's timing guarantees, and do not change what
`stop`/`reset` do to the target position without checking `docs/api-v2.md`.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before touching the
executor, the locking, or storage; [`docs/api-v2.md`](docs/api-v2.md) before
touching any route; and
[`docs/adr/0001-esp-idf-port.md`](docs/adr/0001-esp-idf-port.md) for why this
port exists at all.

## Build, flash, test

```bash
idf.py set-target esp32s3   # once, per clone
idf.py menuconfig           # WiFi credentials, under "Rotation target backend"
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
```

- **Toolchain:** ESP-IDF >= 5.3 per `main/idf_component.yml`; built and tested
  against **v6.0.2**. Note 6.0 removed `i2s_port_t` — `i2s_chan_config_t::id`
  is a plain `int`, which is why `main/config.h` declares `kI2sPort` that way.
- **Clone with `--recursive`.** The shipped audio and programs come from the
  `resources/` submodule; the root `CMakeLists.txt` fails the build with an
  explicit message if it is empty.
- **`idf.py flash` rewrites the LittleFS image**, discarding anything uploaded
  to the device. Use `idf.py app-flash` to update only the firmware.
- **Editing `sdkconfig.defaults` does nothing on its own.** ESP-IDF seeds
  `sdkconfig` from it only when `sdkconfig` does not exist, and `sdkconfig` is
  gitignored — so in a clone that has already been built, a changed default is
  silently ignored. Delete `sdkconfig` (or `idf.py fullclean`) and rebuild,
  then grep the generated `sdkconfig` to confirm the value landed. This fails
  quietly and looks exactly like the change not working.
- **Host tests** — the whole run state machine, deterministically, no hardware:
  ```bash
  cd host_test && cmake -B build && cmake --build build -j && cd build && ctest --output-on-failure
  ```
  Add `-DRT_COVERAGE=ON` for coverage. Only `IDF_PATH` is needed (for Unity),
  not the cross toolchain — so these run in CI without installing xtensa.
- **Lint** — `pre-commit run --all-files`. The clang-format hook rewrites in
  place, so a first run failing and a second passing is normal; re-stage what
  it changed.

## Architecture

**`lib/rt_logic/` is the tested core; `main/` is the firmware.** Anything that
decides *what should happen* belongs in `rt_logic` — it has no ESP-IDF or
hardware dependency and is compiled unchanged into `host_test/`. `rt::Executor`
takes its `Clock` and `Effects` by reference; the firmware passes
`esp_timer_get_time()` and the real GPIO/I2S/SSE effects, the tests pass a
hand-advanced clock and a recorder.

**When adding behaviour, put the decision in `rt_logic` and the effect in
`main/`.** If a change cannot be tested in `host_test/`, that is usually a sign
the logic ended up on the wrong side of the line.

- `rt::Executor::tick()` is one iteration of the run loop and returns how long
  to sleep — at most `rt::kMaxSleepMs` (200 ms), so `stop` lands promptly.
- **SSE broadcasts must stay outside the state lock.** `Effects::state_changed()`
  only sets a flag; the payload is serialized under the lock and sent after
  releasing it. See `flush()` in `main/executor/program_executor.cpp`.
- **`readonly` is a property of the directory a file was loaded from, never of
  the document.** An uploader must not be able to claim its program is shipped.
- Programs live in a `std::map` for reference stability — `ProgramState` holds a
  bare `const rt::Program *` at whatever is loaded.
- `PsychicRequest::header()` and `getCookie()` both return the same per-request
  scratch string. Copy a value out before reading another, or the first turns
  into the second.

## Conventions

- **Version is derived from git, never hand-maintained.** ESP-IDF populates
  `esp_app_desc_t.version` from `git describe --always --tags --dirty`;
  `GET /api/v2/version` splits that. Never add a version constant to the
  source. Tags are bare three-part semver (`2.0.0`, not `v2.0.0`).
- Constants belong in `main/config.h` (firmware) or as `constexpr` in the
  relevant `rt_logic` header — prefer a named constant over a literal in logic.
- **Vendored code is never reformatted.** `lib/psychic_http/`,
  `lib/arduinojson/` and `resources/` are excluded in
  `.pre-commit-config.yaml` and must stay byte-identical to upstream.
- `docs/api-v2.md` is the contract shared with the MicroPython backend and the
  webapp. Changing a payload shape means changing it there too, and recording
  any divergence in its "Deviations" section.
