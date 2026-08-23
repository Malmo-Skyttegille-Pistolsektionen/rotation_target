# Troubleshooting

Start with the [status LED](status-led.md) — it is the only feedback the
device gives when no browser is open, and it distinguishes "still connecting"
from "never connected" at a glance. Most of what follows starts by reading it.

## Device not found

| LED | Meaning | What to do |
|---|---|---|
| Blinking red | Still trying to join a network | Wait — nothing to fix yet |
| Solid red | Gave up joining; the setup portal should be up | See [Connecting](connecting.md#the-setup-portal) |
| Blue | On the setup portal's own network | It has no range network yet — go through setup |
| Yellow, and staying that way | On the network, but the web server has not come up | The network side is fine; this is a device fault, not a connection one |
| Green | Serving | The device is reachable — if the browser still cannot reach it, see below |

If the LED is green but `http://rotation-target.local` will not load, the
network is not resolving the mDNS name for you — try the device's IP address
directly instead (see [Connecting](connecting.md#finding-the-device)). Confirm
the browser is actually on the same network as the device, not still on
mobile data or a previous WiFi.

## Targets not moving

- Try **Toggle Targets** on the Run page. If that does not move the targets
  either, the problem is not the loaded program — check power to the target
  system and the DB9 connection (see [Hardware](hardware.md)).
- If Toggle Targets works but a program does not move them, check the
  program's timeline: an event with no show/hide command is a timed pause by
  design, not a fault.
- If the targets move, but the wrong way — showing when they should hide, or
  the reverse — that is a build-time wiring setting, not something fixable
  from the web app. Report it rather than rewiring anything.

## No audio

- Confirm the amplifier is powered and connected — the device has no way to
  detect that on its own.
- Some devices are built with audio hardware disabled entirely; a target that
  only turns, with no sound, is a supported configuration on those. If that is
  the case for this device, there is nothing to fix.
- A clip that fails to play (missing, or not a playable file) is reported by
  the device as a **backend issue** banner — currently surfaced on the Audios
  page, not the Run page, so check there if a run went quiet. <!-- TODO: confirm whether this should also surface on the Run page -->
- The run itself is unaffected by a clip failing to play: it carries on
  silently through that event rather than stopping.

## "Stop" says the program is not running (400)

`POST /programs/stop` — the Pause action — answers `400` when nothing is
running. This is expected, not a fault, and shows up in one case an operator
will actually hit: **pressing Pause after a series has already finished on its
own** — a series that runs to the end stops itself, so there is nothing left
to pause. If another series follows, the device has already selected it and
is waiting at its first event; press Start to run it. If that was the last
series, the program has finished — Start would replay it from the beginning,
or Unload to pick something else.
