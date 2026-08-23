# Rotation Target

Software for running timed shooting programs on a rotating target system, built
by and for Malmö Skyttegille Pistolsektionen.

An ESP32-S3 board turns the targets face-on and edge-on to a shooting program
and plays the spoken range commands over an amplifier. A React web app — served
by the board itself over WiFi — starts and stops programs, follows the run live,
and manages the stored programs and audio.

The board does not speak any target system's proprietary protocol: it closes
and opens one circuit, and the target system's own electronics do the rest.
It was built against the [Eigenbrod TP2](https://eigenbrod-schiessanlagen.de/en/products?tx_produkt_produkte%5Baction%5D=show&tx_produkt_produkte%5BL%5D=2&tx_produkt_produkte%5Bprodukt%5D=319&cHash=942340d5971be0a0ac3d26ff3c257c0b), but
anything driven the same way — a contact closure, level-driven, two positions —
should work.

!!! danger "Safety warning — read before installing or operating"

    **This device moves steel on a live firing range, and it moves it on a
    timer.** A target turns because a program said it was time, not because it
    can see who is in front of it. It has no idea anyone is downrange.

    - **The range's own safety rules and range commands govern the line. This
      software governs nothing.** A program running is not a range that is hot;
      a program stopped is not a range that is safe.
    - **Never go downrange because the web app says the run has finished.**
      Confirm a cease-fire the way your range already requires — verbally, with
      firearms cleared and benched.
    - **A target turning can injure somebody standing next to it.** Keep clear
      of the mechanism whenever the device is powered.

    **Do not rely on this software to protect anyone.** It is a convenience for
    running programs, not a safety device: no interlock, no sensor, and no way
    to know where people are.

    This project is provided as-is with no warranty of any kind. The authors
    accept no responsibility or liability for any injury, damage or loss
    resulting from building, installing, modifying or operating this system.

The targets rest face-on and stay there at boot by design: somebody may be
downrange when a board is powered, and a target that turns on its own can
injure them. That resting state can be changed to suit a target system wired
the other way round, but only over a serial cable — see [Settings](settings.md).

## Where to start

- [Hardware and wiring](hardware.md) — the DB9 connector and what a target
  system has to be to work with the board.
- [Connecting](connecting.md) — join the device's network and open the web app.
- [Running a program](running-a-program.md) — start, follow, and stop a run.
- [Status LED](status-led.md) — what the device is telling you when nobody has
  a browser open.
- [Troubleshooting](troubleshooting.md) — common problems and what to check.

## Program editor

[**Open the program editor**](editor/){ .md-button } — write and edit programs
in a browser with **no device attached**, then download the file or open a pull
request. Also the easiest way to read a shipped program without a board in
front of you.

## Write a program without a device

The **[program editor](https://malmo-skyttegille-pistolsektionen.github.io/rotation_target/editor/)** runs entirely in a browser tab, with no board
attached. Open a program from this repository, edit it, and either download the
file or open a pull request with it. [Writing your own
program](writing-a-program.md) walks through building one from nothing.

## Source

Full technical documentation — hardware wiring, the API contract, and the
firmware and web app internals — lives in the
[repository](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target).
