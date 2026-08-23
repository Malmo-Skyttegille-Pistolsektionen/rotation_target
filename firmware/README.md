# Rotation Target Backend — ESP32 (ESP-IDF)

Native ESP-IDF firmware for Malmö Skyttegille Pistolsektionen's
[Eigenbrod TP2 rotation target system](https://eigenbrod-schiessanlagen.de/en/products?tx_produkt_produkte%5Baction%5D=show&tx_produkt_produkte%5BL%5D=2&tx_produkt_produkte%5Bprodukt%5D=319&cHash=942340d5971be0a0ac3d26ff3c257c0b).
It runs shooting programs — turning the targets and playing the commands — and
serves the React webapp over REST and Server-Sent Events.

This is the ESP-IDF port of
[`rotation_target_backend_esp32_micropython`](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_backend_esp32_micropython)
at its API v2 revision. Both speak the same contract; see
[`docs/adr/0001-esp-idf-port.md`](docs/adr/0001-esp-idf-port.md) for why the
port exists.

## Hardware

**ESP32-S3** with 16 MB flash and 8 MB PSRAM — an ESP32-S3-DevKitC-1 N16R8, or
the club's own REVOLVENOW Rev 1 board.

No pin is hardcoded: the target GPIO **and its polarity**, the status LED, and
the I2S pins are all `menuconfig` options, so a different board is a different
`sdkconfig` rather than a source edit.

See [`docs/HARDWARE.md`](docs/HARDWARE.md) for the wiring, the full option list,
the partition layout, and the esptool `--no-stub` quirk you will hit when
flashing these boards.

## Build, flash, test

```bash
git clone https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target.git
cd rotation_target/firmware

idf.py set-target esp32s3          # FIRST clone only - see the warning below
idf.py menuconfig                  # optional: seed WiFi under "Rotation target backend"
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
```

> ⚠️ **`idf.py set-target` regenerates `sdkconfig`**, which is where the WiFi
> credentials live and is gitignored — so there is no other copy, and nothing
> says they are gone until the device cannot join a network. On a clone you
> have already built, use **`idf.py reconfigure`**.
>
> Keeping the credentials outside the tree removes the hazard entirely:
>
> ```bash
> idf.py -D SDKCONFIG=$HOME/agents/rotation_target/sdkconfig build
> ```

> **`idf.py flash` uses esptool's stub loader, which fails on this board** and
> fails in a way that looks like bad flash. See
> [`docs/HARDWARE.md`](docs/HARDWARE.md) for the `--no-stub` invocation.

The shipped audio and programs live in the monorepo's sibling `resources/`
directory. The build reads them from there by default; point `RT_RESOURCES_DIR`
elsewhere to override.

The webapp is bundled into the same image when `../webapp/dist` exists — run
`npm run build` in `webapp/` first, or point `RT_WEBAPP_DIR` at a `dist` built
elsewhere. Without one the device serves the API only.

`idf.py flash` writes the LittleFS image too, which **replaces anything
uploaded to the device**. Use `idf.py app-flash` to update only the firmware.

### WiFi

Credentials live in **NVS**, not in the firmware, so moving the device to a new
network does not need a rebuild. `idf.py flash` leaves the `nvs` partition
alone, so they also survive a firmware update.

If the device cannot join a network — out of the box, or because the range's
WiFi password changed — it brings up a **setup access point** and a captive
portal instead of sitting there unreachable:

1. Join `rotation-target-setup-XXXX` (password: `CONFIG_RT_SETUP_AP_PASSWORD`,
   default `rotationtarget`).
2. A setup page should open automatically; if not, browse to
   `http://192.168.4.1`.
3. Enter the network details. The device saves them and restarts.

The Kconfig `RT_WIFI_SSID`/`RT_WIFI_PASSWORD` values are only a first-boot
seed — leave them at the defaults and use the portal, or set them to skip it.
`sdkconfig` is gitignored either way, the same way the MicroPython backend kept
`wifi_credentials.py` out of git.

Once up, the device is at `http://rotation-target.local` (mDNS) or whatever
address it logs on boot.

### Host tests

The run state machine, the program JSON contract, the `stateUpdate` serializer
and admin mode all run on the build machine — no hardware, no sleeps:

```bash
cd host_test && cmake -B build && cmake --build build -j && cd build && ctest --output-on-failure
```

Add `-DRT_COVERAGE=ON` for gcov/gcovr coverage, or `-DRT_SANITIZE=ON` to build
the suites with ASan + UBSan:

```bash
cd host_test && cmake -B build-san -DRT_SANITIZE=ON && cmake --build build-san -j \
  && cd build-san && ctest --output-on-failure
```

CI runs both the plain and the sanitized build — the sanitizers force `-O1` and
change codegen, so a clean run of one is not evidence about the other. UBSan is
what catches signed-overflow in the duration and id arithmetic, which `-Wall`
cannot see.

Only `IDF_PATH` is needed (for ESP-IDF's copy of Unity), not the cross
toolchain.

### Lint

```bash
pre-commit run --all-files
```

`.clang-format` covers `main/`, `lib/rt_logic/` and `host_test/`. Vendored code
(`lib/psychic_http/`, `lib/arduinojson/`) and the repository's `resources/`
tree are excluded and must stay byte-identical to upstream — never reformat
them.

## API

[`docs/api-v2.md`](docs/api-v2.md) — REST under `/api/v2`, SSE at `/sse/v2`,
plus `GET /api/v2/diagnostics/info` for post-incident triage without a cable.
The canonical machine-readable contract is
[`../contracts/`](../contracts/README.md) — `openapi.yaml` for REST,
`asyncapi.yaml` for SSE, `program.schema.json` for the program document. A
change to any of them lands in the same PR as the firmware change it
describes.

## Layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the task model, the
locking rules and the storage layout.

| Path | Holds |
|---|---|
| `lib/rt_logic/` | Hardware-independent logic — the tested core |
| `lib/psychic_http/`, `lib/arduinojson/` | Vendored third-party |
| `main/` | The firmware: `io/`, `storage/`, `repositories/`, `executor/`, `net/` |
| `host_test/` | Unity suites for `lib/rt_logic/`, plus the CMake + CTest harness |
| `../resources/` | The shipped audio and programs (sibling directory) |

## Documentation

| Document | Covers |
|---|---|
| [`docs/api-v2.md`](docs/api-v2.md) | The REST + SSE contract, shared with the MicroPython backend |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Boards, pin configuration, flashing, partitions |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Task model, locking, storage layout |
| [`docs/QEMU.md`](docs/QEMU.md) | Running the firmware in the emulator, and what it does not emulate |
| [`docs/adr/0001-esp-idf-port.md`](docs/adr/0001-esp-idf-port.md) | Why this port exists |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Workflow, tests, commit conventions |
| [`SECURITY.md`](SECURITY.md) | Threat model and reporting |

## Related

- [Frontend webapp](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_frontend_webapp)
- [MicroPython backend](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_backend_esp32_micropython)
- [Resources](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_backend_resources) — programs, audio, API specs

## License

MIT. See [LICENSE](LICENSE).
