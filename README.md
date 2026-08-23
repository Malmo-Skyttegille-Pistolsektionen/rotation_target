# Rotation Target

Software for running timed shooting programs on a rotating target system, built
by and for Malmö Skyttegille Pistolsektionen.

An ESP32-S3 board turns the targets face-on and edge-on to a shooting program
and plays the spoken range commands over an amplifier. A React web app — served
by the board itself over WiFi — starts and stops programs, follows the run live
over Server-Sent Events, and manages the stored programs and audio.

## ⚠️ SAFETY WARNING — READ BEFORE INSTALLING OR OPERATING

**This device moves steel on a live firing range, and it moves it on a timer.**
A target turns because a program said it was time, not because it can see who
is in front of it. It has no idea anyone is downrange.

- **The range's own safety rules and range commands govern the line. This
  software governs nothing.** A program running is not a range that is hot; a
  program stopped is not a range that is safe.
- **NEVER go downrange because the web app says the run has finished.** Confirm
  a cease-fire the way your range already requires — verbally, with firearms
  cleared and benched.
- **NEVER leave the device powered while people are forward of the firing
  line** unless your club has decided that is safe and knows what the targets
  do at power-up.
- **A target turning can injure somebody standing next to it.** Keep clear of
  the mechanism whenever the device is powered.

The targets rest **shown** at boot, deliberately: a target that turns of its own
accord when a board is powered is the failure this project is most concerned
with. That resting state can be changed to suit a target system wired the other
way round, but only over a USB cable, never from the web app — see
[Settings](https://malmo-skyttegille-pistolsektionen.github.io/rotation_target/settings/).

**Do not rely on this software to protect anyone.** It is a convenience for
running programs, not a safety device, and it has no interlock, no sensor, and
no way to know where people are.

**LIABILITY DISCLAIMER:** This project is provided as-is with absolutely no
warranty of any kind. The author(s) accept no responsibility or liability for
any injury, damage, or loss resulting from building, installing, modifying, or
operating this system. You build and use it entirely at your own risk.

---

## Documentation

Everything an operator needs is on the documentation site:

- **[Operator documentation](https://malmo-skyttegille-pistolsektionen.github.io/rotation_target/)**
  — wiring, connecting, running a program, settings, and what the status LED is
  telling you. This is the one to send a club member.
- **[Program editor](https://malmo-skyttegille-pistolsektionen.github.io/rotation_target/editor/)**
  — write and edit programs in a browser with **no device attached**, then
  download the file or open a pull request against this repository. Also useful
  for reading a shipped program without a board in front of you.
- **[Hardware and wiring](https://malmo-skyttegille-pistolsektionen.github.io/rotation_target/hardware/)**
  — what a target system has to do to work, the DB9 pinout, and the transistor
  that does the switching.

## Installing

Releases ship a pre-built firmware image and you do not need a toolchain to put
it on a board — Espressif's web flasher does it from Chrome or Edge.

**[Flashing a board](https://malmo-skyttegille-pistolsektionen.github.io/rotation_target/flashing/)**
→ **[Connecting](https://malmo-skyttegille-pistolsektionen.github.io/rotation_target/connecting/)**
→ **[Settings](https://malmo-skyttegille-pistolsektionen.github.io/rotation_target/settings/)**

The target pin, its polarity, the audio and LED pins and the device's name are
all configurable on the device, so a stock release image adapts to another
club's board without rebuilding it.

## Target systems

- **[Eigenbrod TP2](https://eigenbrod-schiessanlagen.de/en/products?tx_produkt_produkte%5Baction%5D=show&tx_produkt_produkte%5BL%5D=2&tx_produkt_produkte%5Bprodukt%5D=319&cHash=942340d5971be0a0ac3d26ff3c257c0b)**
  — what this was built against and what it runs on.

Nothing in the firmware is specific to that system. The board speaks no
proprietary protocol to the targets: it closes and opens **one circuit**, and
the target system's own electronics do the rest. Any system driven the same way
should work.

## Layout

| Directory | Holds |
|---|---|
| [`contracts/`](contracts/README.md) | The canonical API contract: OpenAPI for REST v2, AsyncAPI for SSE v2, the program schema |
| [`firmware/`](firmware/README.md) | The ESP-IDF firmware: target IO, audio, storage, REST + SSE server |
| [`webapp/`](webapp/README.md) | The React front end, bundled into the firmware's LittleFS image |
| [`resources/`](resources/README.md) | Shipped programs and audio clips flashed onto the device |
| [`docs/`](docs/) | The [decision log](docs/DECISIONS.md), [how releases are cut](docs/RELEASING.md), and the source of the documentation site |

## Contributing

Building, flashing, running it without a device, and the coding standards are
in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT — see the `LICENSE` file in each component directory.
