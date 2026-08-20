# Rotation Target

Software for Malmö Skyttegille Pistolsektionen's [Eigenbrod
TP2](https://www.eigenbrod.de/) rotation target system.

An ESP32-S3 board turns the targets face-on and edge-on to a shooting program
and plays the spoken range commands over an amplifier. A React web app — served
by the board itself over WiFi — starts and stops programs, follows the run live
over Server-Sent Events, and manages the stored programs and audio.

## Layout

| Directory | Holds |
|---|---|
| [`firmware/`](firmware/README.md) | The ESP-IDF firmware: target IO, audio, storage, REST + SSE server |
| [`webapp/`](webapp/README.md) | The React front end, bundled into the firmware's LittleFS image |
| [`resources/`](resources/README.md) | Shipped programs and audio clips flashed onto the device |
| [`docs/`](docs/) | Cross-component documentation: the [decision log](docs/DECISIONS.md) and [how releases are cut](docs/RELEASING.md) |

`contracts/` — the canonical OpenAPI and AsyncAPI v2 specifications — lands in a
later change; until then the implemented contract is described in
[`firmware/docs/api-v2.md`](firmware/docs/api-v2.md).

## Building

Each component builds on its own; see the per-directory READMEs. The firmware
build stages `resources/` into the flash image and, if `webapp/dist` exists,
bundles the web app too — so a full device image is:

```bash
cd webapp && npm run build     # produces webapp/dist
cd ../firmware && idf.py build
```

## History

This repository was assembled from three separate repositories, whose full
histories are preserved under `firmware/`, `webapp/` and `resources/`.

## License

MIT — see the `LICENSE` file in each component directory.
