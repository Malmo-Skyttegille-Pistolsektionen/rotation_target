# Rotation Target

Software for running timed shooting programs on a rotating target system, built
by and for Malmö Skyttegille Pistolsektionen.

An ESP32-S3 board turns the targets face-on and edge-on to a shooting program
and plays the spoken range commands over an amplifier. A React web app — served
by the board itself over WiFi — starts and stops programs, follows the run live,
and manages the stored programs and audio.

The board does not speak any target system's proprietary protocol: it closes
and opens one circuit, and the target system's own electronics do the rest.
It was built against the [Eigenbrod TP2](https://www.eigenbrod.de/), but
anything driven the same way — a contact closure, level-driven, two positions —
should work.

The targets rest face-on and stay there at boot by design: somebody may be
downrange when a board is powered, and a target that turns on its own can
injure them.

## Where to start

- [Connecting](connecting.md) — join the device's network and open the web app.
- [Running a program](running-a-program.md) — start, follow, and stop a run.
- [Status LED](status-led.md) — what the device is telling you when nobody has
  a browser open.
- [Troubleshooting](troubleshooting.md) — common problems and what to check.

## Source

Full technical documentation — hardware wiring, the API contract, and the
firmware and web app internals — lives in the
[repository](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target).
