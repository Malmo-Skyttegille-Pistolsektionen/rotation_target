# Running the firmware in QEMU

The firmware boots unmodified in Espressif's QEMU fork, serves the real REST
API, the real SSE stream and the real webapp out of the real LittleFS image,
and answers on `http://localhost:8080`. That makes a browser session or an E2E
suite possible without a board on the desk, against the same code that ships —
not a mock.

```sh
. <esp-idf>/export.sh
firmware/scripts/run-qemu.sh
# then: http://localhost:8080   (Ctrl-A X quits QEMU)
```

The script installs `qemu-xtensa` on first use
(`python "$IDF_PATH/tools/idf_tools.py" install qemu-xtensa`), builds the QEMU
profile into `build-qemu/`, merges the flash image and boots it. `--build-only`
stops after the build; `--headless` boots with no terminal attached;
`--port N` changes the host port.

Boot to serving takes about two seconds of guest time.

## How it differs from the board

QEMU emulates no WiFi radio, so the network comes up over the OpenCores
Ethernet MAC the emulator maps onto the EMAC register window. That is the whole
of `CONFIG_RT_NET_OPENETH`: `main/net/eth_mgr.cpp` is compiled instead of
`main/net/wifi_mgr.cpp`, both implementing `main/net/net_mgr.h`. With the WiFi
translation unit out of the build, the setup portal and the NVS credential
store are not linked in at all — there is nothing to provision, because SLIRP
hands the guest 10.0.2.15 over DHCP.

The rest of the profile is `sdkconfig.defaults.qemu` layered on
`sdkconfig.defaults`: audio and the RGB LED off, PSRAM addressed as quad (see
below), everything else — 16 MB flash, the partition table, the socket
budget — exactly as the board has it.

## What works

| | |
|---|---|
| REST `/api/v2/*` | All of it, including the control lock and `diagnostics/info` |
| SSE `/sse/v2` | `stateUpdate` and `heartbeat`, real timing |
| The webapp | Served from LittleFS at `http://localhost:8080` when `webapp/dist` exists at build time, `.gz` assets included |
| LittleFS | Mounts the flashed image: 7 shipped programs, 77 audio entries, uploads |
| Executor timing | Tracks host wall-clock — `tickerMs` advances once a second and series boundaries land where the program says |
| Watchdogs | Disabled by the runner (`wdt_disable`); nothing feeds them under emulation |

## What does not work

- **Audio is silent.** There is no I2S peripheral to emulate, so
  `RT_AUDIO_ENABLED` is off and `main/io/audio.cpp` takes its no-op path.
  Programs still run, and the API still reports the audio catalogue.
- **The RGB LED does nothing.** No RMT peripheral; `RT_RGB_LED_ENABLED` is off
  and `main/io/rgb_led.cpp` takes its no-op path.
- **GPIO writes are discarded.** The target pin is driven exactly as on the
  board, but nothing in the emulator observes it and a pad readback does not
  reflect a write. Target status as the API reports it comes from the executor,
  not from the pin — `diagnostics/info` shows `targetGpioLevel: 0` throughout.
- **mDNS is not reachable from the host.** The responder runs and answers
  inside the guest, but SLIRP does not carry multicast to the host — use
  `localhost:8080`, never `rotation-target.local`.
- **CORS by device IP does not match.** The allowlist knows
  `rotation-target.local` and the guest's own 10.0.2.15; a browser on
  `http://localhost:8080` sends that origin instead. Same-origin requests need
  no CORS headers, so the bundled webapp is unaffected; a Vite dev server
  against the emulator needs `CONFIG_RT_DEV_ORIGIN`.
- **`GET /api/v2/version` reports `0.0.0`.** The app version is a raw
  `git describe`, which that endpoint's strict parse rejects. Not a QEMU
  artefact — the board does the same until versioning lands.
  `diagnostics/info` reports the describe string verbatim.

Noise that is expected on every boot and safe to ignore:

```
E esp_eth: esp_eth_ioctl(533): add mac address to filter not supported
E esp_netif_lwip: Failed to add multicast filter for IPv4
W opencores.emac: emac_opencores_isr_handler: RX frame dropped (0x14)
W rtcinit: o_code calibration fail
```

The OpenCores MAC has no multicast filter, so lwIP's IGMP setup fails; a frame
or two is dropped while the DMA rings fill; the RTC calibration has nothing to
calibrate. Nothing downstream depends on any of it.

## Two things the emulator gets wrong, and what the runner does about them

**PSRAM is addressed as quad, not octal.** The board is an N16R8 and
`sdkconfig.defaults` says `CONFIG_SPIRAM_MODE_OCT`. Under qemu-xtensa 9.2.2 the
octal model segfaults the emulator inside `psram_transfer()`
(`hw/misc/ssi_psram.c`) during the driver's init transfer — deterministically,
right after `boot: Loaded app from partition` and with no guest output at all,
so it reads as a silent hang. `sdkconfig.defaults.qemu` therefore selects
`CONFIG_SPIRAM_MODE_QUAD` at 40 MHz. The pool is the same 8 MB and nothing
above the driver can tell the difference. Revisit when the emulator's octal
model is fixed.

**PSRAM size must be passed explicitly.** `idf.py qemu` hardcodes `-m 32M`. At
that size the guest's PSRAM claims the entire external-memory virtual address
range:

```
W esp_psram: Virtual address not enough for PSRAM, map as much as we can. 31MB is mapped
E mmap: esp_mmu_map(479): no such vaddr range
E partition: load_partitions returned 0x105
ESP_ERROR_CHECK failed: esp_err_t 0x105 (ESP_ERR_NOT_FOUND)
```

Every flash mmap after PSRAM init fails and the app aborts in
`nvs_flash_init()`. The runner passes `-m 8M`; override with `QEMU_PSRAM_MB`
for a different module.

Because neither of those can be expressed through `idf.py qemu`, the runner
builds with `idf.py` but invokes `qemu-system-xtensa` directly, merging the
flash image with the same `esptool merge-bin` call `idf.py qemu` would have
used. It also omits the eFuse drive `idf.py qemu` always attaches — that image
describes a chip revision v0.3 part, and on v0.3 the PSRAM driver runs MSPI
timing tuning, another path the emulator faults in. Without the drive the eFuse
reads back as v0.0 and the tuning is skipped.

## Running it in CI

`run-qemu.sh --headless` is the CI shape: no TTY needed, serial goes to stdout.

The `firmware boot smoke` job in `.github/workflows/firmware-build.yml` is the
worked example: build, boot, poll, assert `/api/v2/version`, `/api/v2/programs`,
one SSE `stateUpdate` and the API-only `GET /` 404.

```sh
firmware/scripts/run-qemu.sh --build-only
firmware/scripts/run-qemu.sh --no-build --headless > qemu.log 2>&1 &
# poll http://localhost:8080/api/v2/version until it answers, then assert
```

`--no-build` is what keeps the boot half honest: without it the backgrounded
run re-runs a no-op `idf.py build` first, and a boot timeout would be timing
the build. No `idf_tools.py install qemu-xtensa` either - `espressif/idf:v6.0.2`
already ships qemu-xtensa 9.2.2 on `PATH`, so there is nothing to cache; the
runner's install-on-first-use branch is for a bare IDF checkout.

The flag matters: interactive runs get `-serial mon:stdio`, and QEMU quits the
instant that stdin reports EOF — which is exactly what a CI runner or a
backgrounded shell hands it. Headless runs get `-serial file:/dev/stdout` and
`-monitor none` instead, and never read stdin at all.

## Not for real hardware

`CONFIG_ETH_USE_OPENETH` is documented upstream as "for use with QEMU… not
supported when running on a real chip". A build with `CONFIG_RT_NET_OPENETH=y`
will not reach a network on the board; it is a simulator profile and nothing
else. The board build is the default and is untouched by any of this.
