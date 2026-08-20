# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Native **ESP-IDF** firmware (`idf.py`, no Arduino/PlatformIO) for an
**ESP32-S3-DevKitC-1 N16R8** driving Malmö Skyttegille Pistolsektionen's
Eigenbrod TP2 rotation target system. It runs shooting programs — turning the
targets over a GPIO and playing spoken commands over I2S — and serves the React
webapp over REST (`/api/v2`) and SSE (`/sse/v2`).

It is a port of `rotation_target_backend_esp32_micropython` at its API v2
revision. Both backends serve the same contract and are meant to stay
interchangeable from the webapp's point of view.

> ⚠️ **This firmware controls targets on a live shooting range.** The target
> position and the audio commands are what tell shooters when to fire and when
> to stop. Do not weaken the run loop's timing guarantees, and do not change
> what `stop`/`reset` do to the target position without checking
> [`docs/api-v2.md`](docs/api-v2.md).

| Read before touching | Document |
|---|---|
| the executor, locking, storage | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| any route or payload | [`../contracts/`](../contracts/README.md) — canonical; [`docs/api-v2.md`](docs/api-v2.md) for the prose |
| why this port exists at all | [`docs/adr/0001-esp-idf-port.md`](docs/adr/0001-esp-idf-port.md) |

## Hardware

Verified against the board with `esptool flash-id`, not assumed from the
datasheet: **ESP32-S3 (QFN56) rev v0.2, 16 MB quad flash @ 3.3 V, embedded
8 MB PSRAM** — an ESP32-S3-DevKitC-1 **N16R8**.

`sdkconfig.defaults` is written for exactly that. Note the R8's PSRAM is
**octal** (`CONFIG_SPIRAM_MODE_OCT`) even though the flash is quad — the eFuse
"flash type: quad" reading refers to the flash only, and selecting the wrong
PSRAM mode leaves it undetected at boot rather than failing loudly.

Pins live in `main/config.h`, ported from the MicroPython `config.py`: target
GPIO5, I2S BCK 10 / DIN 11 / LCK 12, WS2812 on 48. The two "ESP32-C6" comments
in that MicroPython file are wrong; `RGG_LED_PIN = 48` is the clue that fits.

## Build, flash, test

```bash
idf.py set-target esp32s3   # once, per clone
idf.py menuconfig           # optional WiFi seed, under "Rotation target backend"
idf.py build
```

- **The shipped audio and programs come from the monorepo's `resources/`
  directory**, found via the `RT_RESOURCES_DIR` cache variable (default
  `../resources`); `CMakeLists.txt` fails the build with an explicit message if
  that path holds no `audios/audios.json`.
- **Toolchain:** ESP-IDF **>= 6.0** (`main/idf_component.yml`); CI pins v6.0.2.
  5.x does not build: 6.0 removed `i2s_port_t`, so `i2s_chan_config_t::id` is a
  plain `int` — see `kI2sPort` in `main/config.h`.
- **Editing `sdkconfig.defaults` does nothing on its own.** ESP-IDF seeds
  `sdkconfig` from it only when `sdkconfig` does not exist, and `sdkconfig` is
  gitignored — so in a clone that has already been built, a changed default is
  silently ignored. Delete `sdkconfig` (or `idf.py fullclean`) and rebuild, then
  grep the generated `sdkconfig` to confirm the value landed. This fails quietly
  and looks exactly like the change not working.

### Flashing: use `--no-stub`

**esptool's stub flasher fails on this board.** It dies with `Packet content
transfer stopped` at a specific address — 0xDA000 reproduced 0/3 — while the ROM
loader reads the identical sector 3/3 and handled a 1 MB read in one call that
the stub could not manage in 256 KB pieces.

```bash
python -m esptool --port /dev/ttyACM0 --no-stub write-flash ...   # args printed by `idf.py build`
python -m esptool --port /dev/ttyACM0 --no-stub read-flash 0 0x1000000 backup.bin
```

This presents exactly like a bad flash sector and **is not one**. Chasing it as
failing hardware — or as a cable, port or chunk-size problem — burns a lot of
time. Running the same read with and without `--no-stub` is the test that tells
those apart. `idf.py flash` uses the stub, so prefer the explicit invocation.

### Ports

The DevKitC-1 has two USB-C sockets. The **native USB-Serial/JTAG** one
enumerates as `/dev/ttyACM0` (`lsusb` → `303a:4001`); the UART-bridge socket
appears as `/dev/ttyUSB0` (`10c4`/`1a86`). Work so far has used the native port.

While a board still runs MicroPython, its firmware claims the USB CDC endpoint
after every hard reset, so back-to-back esptool invocations are less reliable
than one long call; `--before no-reset --after no-reset` holds the chip in the
bootloader and avoids it. This firmware does not use native USB, so it does not
do the same thing.

### Back up before reflashing

A board may still hold the MicroPython backend: `factory` (1984K) + `vfs` (14M
FAT), where the FAT partition holds club-uploaded programs, audio and
`wifi_credentials.py`. Flashing this firmware repartitions the device and
destroys all of it — take a full 16 MB image first, it is the only way back.

`idf.py flash` also rewrites the LittleFS image, discarding anything uploaded to
the device. Use `idf.py app-flash` to update only the firmware.

### WiFi

The network this device is deployed on **may be a hidden SSID**, and at least
one site's is. A hidden AP never answers a passive scan, so ESP-IDF's default
`WIFI_FAST_SCAN` will not find it and the device falls through to the setup
portal. `main/net/wifi_mgr.cpp` sets `WIFI_ALL_CHANNEL_SCAN`, which puts the
SSID in the probe request — do not change that back.

Never record an actual SSID or password in this repository, in a commit
message, or anywhere else outside the gitignored `sdkconfig`.

**Credentials go in `sdkconfig` (gitignored), never `sdkconfig.defaults`
(committed).** At runtime they live in NVS via `wifi_store`; Kconfig is only a
first-boot seed, and a failed initial join hands over to `setup_portal::run()`.

### Host tests

The whole run state machine and every parser, deterministically, no hardware:

```bash
cd host_test && cmake -B build && cmake --build build -j && cd build && ctest --output-on-failure
```

`-DRT_SANITIZE=ON` for ASan + UBSan, `-DRT_COVERAGE=ON` for gcov. CI runs plain
and sanitized as separate jobs — the sanitizers force `-O1` and change codegen,
so a clean run of one says nothing about the other. UBSan is what catches the
signed-overflow class in the duration and id arithmetic that `-Wall` cannot see.
Only `IDF_PATH` is needed (for Unity), not the cross toolchain.

### Lint

`pre-commit run --all-files`. The clang-format hook rewrites in place, so a
first run failing and a second passing is normal — re-stage what it changed.

> Beware when scripting edits: clang-format reformats code between runs, so a
> string-replacement anchor that matched yesterday may not match today. Assert
> that an anchor was found rather than letting a replacement silently no-op.

## Architecture

**`lib/rt_logic/` is the tested core; `main/` is the firmware.** Anything that
decides *what should happen* belongs in `rt_logic` — no ESP-IDF or hardware
dependency, compiled unchanged into `host_test/`. `rt::Executor` takes its
`Clock` and `Effects` by reference; the firmware passes `esp_timer_get_time()`
and the real GPIO/I2S/SSE effects, the tests pass a hand-advanced clock and a
recorder.

**When adding behaviour, put the decision in `rt_logic` and the effect in
`main/`.** If a change cannot be tested in `host_test/`, that is usually a sign
the logic ended up on the wrong side of the line.

**Parsers especially: anything turning outside bytes into meaning goes in
`rt_logic`.** WAV headers, URI path ids, program documents, program filenames.
They are the attacker-reachable surface, and in `main/` — behind a `FILE*` or an
HTTP request, in an anonymous namespace — no host test reaches them and no
sanitizer ever sees them. Take an abstraction (`rt::ByteSource`, absolute
unsigned offsets) rather than a `FILE*`: that also made the "chunk size seeks
backwards and loops forever" bug unrepresentable rather than merely fixed.

Load-bearing invariants:

- `rt::Executor::tick()` is one iteration of the run loop and returns how long
  to sleep — at most `rt::kMaxSleepMs` (200 ms), so `stop` lands promptly.
- **SSE sends go through `httpd_queue_work`, i.e. always on the httpd task.**
  That is the only task esp_http_server mutates the client list from, and it
  keeps the blocking send off the run loop. `flush()` serializes *and* enqueues
  under one lock so snapshot order equals send order. `broadcast_issue()` uses
  the same path from any task, and is a no-op before the server exists.
- **`readonly` is a property of the directory a file was loaded from, never of
  the document.** An uploader must not be able to claim its program is shipped.
- Programs live in a `std::map` for reference stability — `ProgramState` holds a
  bare `const rt::Program *` at whatever is loaded.
- The `audios` map is reached from both the httpd and run-loop tasks and has its
  own mutex. Uploads are staged to a temp file and renamed to `<id>.wav`; a
  client-supplied filename never touches disk.
- `PsychicRequest::header()` and `getCookie()` return the *same* per-request
  scratch string. Copy one out before reading the other.

## Conventions

- **Version is derived from git, never hand-maintained.** The root
  `CMakeLists.txt` sets `PROJECT_VER` from `git describe --tags --match
  'firmware-v*'` with the prefix stripped, which lands in
  `esp_app_desc_t.version`; `GET /api/v2/version` splits that. Never add a
  version constant to the source. Tags are `firmware-vX.Y.Z` - the monorepo
  also carries `webapp-v*` and `resources-v*`. See `docs/RELEASING.md`.
- Constants belong in `main/config.h` (firmware) or as `constexpr` in the
  relevant `rt_logic` header — prefer a named constant over a literal in logic.
- **Vendored code is never reformatted.** `lib/psychic_http/`,
  `lib/arduinojson/`, `lib/dns_server/` and the repository's `resources/` tree
  are excluded in the root `.pre-commit-config.yaml` (paths there are
  repo-root-relative) and must stay byte-identical to upstream. Where they
  need a fix (an include order, a `-Wmissing-field-initializers` pragma), it goes
  on our side of the boundary.
- `main/` builds with `-Wall -Wextra` and `host_test/` with `-Werror`. Keep both.
- **`../contracts/` is the canonical API contract** — `openapi.yaml`,
  `asyncapi.yaml`, `program.schema.json`. A route, payload or status code that
  changes here changes there **in the same PR**; the webapp generates its types
  from those files. `docs/api-v2.md` is the prose companion.
