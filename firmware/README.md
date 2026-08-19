# Rotation Target Backend — ESP32 (ESP-IDF)

Native ESP-IDF firmware for Malmö Skyttegille Pistolsektionen's
[Eigenbrod TP2 rotation target system](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_backend_resources).
It runs shooting programs — turning the targets and playing the commands — and
serves the React webapp over REST and Server-Sent Events.

This is the ESP-IDF port of
[`rotation_target_backend_esp32_micropython`](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_backend_esp32_micropython)
at its API v2 revision. Both speak the same contract; see
[`docs/adr/0001-esp-idf-port.md`](docs/adr/0001-esp-idf-port.md) for why the
port exists.

## Hardware

**ESP32-S3-DevKitC-1 N16R8** — 16 MB flash, 8 MB octal PSRAM.

| ESP32 pin | Connects to | Function |
|---|---|---|
| GPIO5 | DB9 pin 2, via a 1 kΩ resistor and a BC547B NPN transistor | Target control |
| GND | DB9 pin 5 | Common ground |
| GPIO10 / GPIO12 / GPIO11 | PCM5102A BCK / LRCK / DIN | I2S audio |
| GPIO48 | onboard WS2812 | Status LED (red joining, yellow joined, green serving) |

```
ESP32 GPIO5 ----[1kΩ]----|B  BC547B  C|---- DB9 pin 2 (target control)
                              E
ESP32 GND --------------------+--------- DB9 pin 5 (ground)
```

Pins are in [`main/config.h`](main/config.h).

## Build, flash, test

```bash
git clone --recursive https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_backend_esp32_espidf.git
cd rotation_target_backend_esp32_espidf

idf.py set-target esp32s3          # once, per clone
idf.py menuconfig                  # set WiFi SSID/password under "Rotation target backend"
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
```

The shipped audio and programs live in the `resources/` submodule — a clone
without `--recursive` fails the build with a message telling you to run
`git submodule update --init --recursive`.

`idf.py flash` writes the LittleFS image too, which **replaces anything
uploaded to the device**. Use `idf.py app-flash` to update only the firmware.

WiFi credentials are `sdkconfig` values and `sdkconfig` is gitignored, the same
way the MicroPython backend kept `wifi_credentials.py` out of git.

Once up, the device is at `http://rotation-target.local` (mDNS) or whatever
address it logs on boot.

### Host tests

The run state machine, the program JSON contract, the `stateUpdate` serializer
and admin mode all run on the build machine — no hardware, no sleeps:

```bash
cd host_test && cmake -B build && cmake --build build -j && cd build && ctest --output-on-failure
```

Add `-DRT_COVERAGE=ON` to the `cmake -B build` step for gcov/gcovr coverage.
Only `IDF_PATH` is needed (for ESP-IDF's copy of Unity), not the cross
toolchain.

### Lint

```bash
pre-commit run --all-files
```

`.clang-format` covers `main/`, `lib/rt_logic/` and `host_test/`. Vendored code
(`lib/psychic_http/`, `lib/arduinojson/`) and the `resources/` submodule are
excluded and must stay byte-identical to upstream — never reformat them.

## API

[`docs/api-v2.md`](docs/api-v2.md) — REST under `/api/v2`, SSE at `/sse/v2`.
The canonical machine-readable contract lives with the webapp, in
`docs/mock-api-v2.openapi.json` in the
[frontend repository](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_frontend_webapp).

## Layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the task model, the
locking rules and the storage layout.

| Path | Holds |
|---|---|
| `lib/rt_logic/` | Hardware-independent logic — the tested core |
| `lib/psychic_http/`, `lib/arduinojson/` | Vendored third-party |
| `main/` | The firmware: `io/`, `storage/`, `repositories/`, `executor/`, `net/` |
| `host_test/` | Unity suites for `lib/rt_logic/`, plus the CMake + CTest harness |
| `resources/` | Submodule: the shipped audio and programs |

## Related

- [Frontend webapp](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_frontend_webapp)
- [MicroPython backend](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_backend_esp32_micropython)
- [Resources](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_backend_resources) — programs, audio, API specs

## License

MIT. See [LICENSE](LICENSE).
