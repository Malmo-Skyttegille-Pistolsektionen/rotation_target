# Rotation Target

Software for running timed shooting programs on a rotating target system, built
by and for Malmö Skyttegille Pistolsektionen.

An ESP32-S3 board turns the targets face-on and edge-on to a shooting program
and plays the spoken range commands over an amplifier. A React web app — served
by the board itself over WiFi — starts and stops programs, follows the run live
over Server-Sent Events, and manages the stored programs and audio.

## Documentation

- **[Operator documentation](https://malmo-skyttegille-pistolsektionen.github.io/rotation_target/)**
  — wiring, connecting, running a program, and what the status LED is telling
  you. This is the one to send a club member.
- **[Program editor](https://malmo-skyttegille-pistolsektionen.github.io/rotation_target/editor/)**
  — write and edit programs in a browser with **no device attached**, then
  download the file or open a pull request against this repository. Also useful
  for reading a shipped program without a board in front of you.

Developer documentation stays in the repository: see [Layout](#layout) below
and [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Target systems

- **[Eigenbrod TP2](https://www.eigenbrod.de/)** — what this was built against
  and what it runs on.

Nothing in the firmware is specific to that system. The board speaks no
proprietary protocol to the targets: it closes and opens **one circuit**, and
the target system's own electronics do the rest. Any system driven the same way
should work.

**What a target system has to do to work, the DB9 pinout, and the transistor
that does the switching are on the site:
[Hardware and wiring](https://malmo-skyttegille-pistolsektionen.github.io/rotation_target/hardware/).** Kept there rather than here because
somebody setting up a second device needs it while standing at the range, not
while reading a repository.

Today all of this is decided when the firmware is built, so adapting to a
different system means a rebuild. Making it configurable on the device — pins,
polarity, peripherals, and eventually more than one bank — is tracked in
[#144](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target/issues/144).

## Layout

| Directory | Holds |
|---|---|
| [`contracts/`](contracts/README.md) | The canonical API contract: OpenAPI for REST v2, AsyncAPI for SSE v2, the program schema |
| [`firmware/`](firmware/README.md) | The ESP-IDF firmware: target IO, audio, storage, REST + SSE server |
| [`webapp/`](webapp/README.md) | The React front end, bundled into the firmware's LittleFS image |
| [`resources/`](resources/README.md) | Shipped programs and audio clips flashed onto the device |
| [`docs/`](docs/) | Cross-component documentation: the [decision log](docs/DECISIONS.md) and [how releases are cut](docs/RELEASING.md) |

## Building

Each component builds on its own; see the per-directory READMEs. The firmware
build stages `resources/` into the flash image and, if `webapp/dist` exists,
bundles the web app too — so a full device image is:

```bash
cd webapp && npm run build     # produces webapp/dist
cd ../firmware && idf.py build
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how to work on this, and
[`firmware/CONTRIBUTING.md`](firmware/CONTRIBUTING.md) for the firmware in
particular.

## History

This repository was assembled from three separate repositories, whose full
histories are preserved under `firmware/`, `webapp/` and `resources/`.

## License

MIT — see the `LICENSE` file in each component directory.
