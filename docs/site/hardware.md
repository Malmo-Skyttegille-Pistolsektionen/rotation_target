# Hardware and wiring

This is what a target system has to be, electrically, before a board can drive
it — the thing a club member setting up a second device needs before anything
else on this site is useful.

## The interface: one circuit

The board does not speak any target system's proprietary protocol. It closes
and opens **one circuit**, over a DB9 connector, and the target system's own
electronics do the rest.

| DB9 pin | Function |
|---|---|
| 2 | Target control — shorted to ground to actuate the target system |
| 5 | Ground — the common return for pin 2 |

Electrically, the board does not close that circuit itself — a GPIO pin
supplies only tens of milliamps and should not meet the target system's
voltage directly. A transistor does the switching instead:

```mermaid
flowchart LR
    subgraph ESP["ESP32-S3"]
        GPIO["GPIO5"]
        GND["GND"]
    end

    R["1 kΩ"]
    Q["BC547B<br/>NPN · 45 V · 100 mA"]

    subgraph TS["Target system (DB9)"]
        P2["pin 2 — target control"]
        P5["pin 5 — ground"]
    end

    GPIO --> R --> Q
    Q -- collector --> P2
    Q -- emitter --> GND
    GND --- P5
```

A GPIO pin drives a 1 kΩ resistor into the base of a **BC547B** NPN
transistor, which does the actual switching. That transistor is rated
**45 V and 100 mA**, and it offers no galvanic isolation. Anything a target
system asks for beyond those limits — a mains-level signal, or an inductive
load like a relay coil — needs a relay or an opto-isolator of its own between
the DB9 connector and the load; it cannot be wired to pin 2 directly.

## What a target system has to do to work

Nothing in the firmware is specific to any one target system — it was built
against the [Eigenbrod TP2](https://www.eigenbrod.de/), but anything driven
the same way should work.

| Requirement | Why |
|---|---|
| Be actuated by a **contact closure** — two terminals shorted together | That is the entire interface. A system expecting a serial protocol, a proprietary bus or a mains signal needs hardware in between |
| Be **level-driven**, not pulse-driven | The firmware holds the line in one state for the length of an event. A system that toggles on each pulse would move on both edges |
| Have **two positions** — face-on and edge-on | The program vocabulary is show and hide. There is no intermediate angle to command |
| Take **one control line for all targets** | One line drives every target together. Independently controlled banks are not supported yet ([#144](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target/issues/144)) |
| Be safe sitting **face-on** with no power | The targets rest face-on and stay there at boot, deliberately: somebody may be downrange when a board is powered, and a target that turns on its own can injure them |

Which level *shows* the targets — and the rest of the pin assignment — is a
firmware build setting, not something the web app or this page can change; it
is decided when a device is set up, not per range day. Full wiring detail,
including the supported boards and their `menuconfig` options, is in
[`firmware/docs/HARDWARE.md`](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target/blob/main/firmware/docs/HARDWARE.md)
in the repository.

**Optional peripherals**, each independently switchable off at build time: the
audio DAC that plays the range commands, and the [status LED](status-led.md).
A target that only turns, with no audio, is a supported configuration.

<!-- TODO: a photograph of the DB9 connector and the transistor as actually wired -->
