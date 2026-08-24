# Settings

The Settings tab holds two different kinds of thing, and it is worth knowing
which is which before changing anything:

- **Browser settings** live in the browser you are using. Another phone or
  tablet at the same range keeps its own, and clearing site data resets them.
- **Device settings and readouts** come from the board itself, and are the
  same for everyone looking at it.

| Section | Kind | What it is |
|---|---|---|
| Server Base URL | browser | Which device this browser talks to |
| Address | device | The address the device says it is reachable on |
| Admin Mode | device | Whether control is open to everyone or needs a login |
| Start delay | browser | Seconds counted down before a run starts |
| Startup Issues | device | What the device could not read when it booted |
| Storage | device | How much room the flash partitions have |
| Version | device | What firmware and web app this is |

## Server Base URL

Normally there is nothing to do here — the app talks to whatever served it.
It matters when the app is being run from somewhere other than the device
(during development, or from a copy on a laptop) and needs pointing at a board.

## Address

What the device reports as its own address. If it says the device has no
address, it is serving its own access point instead of being on a network —
see [the setup portal](connecting.md#the-setup-portal).

## Admin Mode

Two states:

- **Full public access** — anyone who can reach the page can control the
  device. This is the default, and it is usually what a range wants: no
  password to pass around while people are shooting.
- **View only** — the page still shows what is happening, but starting,
  stopping, uploading and deleting all require a login.

Turning it on asks for a password to set. From then on this browser holds a
token; **Login** on another browser asks for that password again.

The password protects against the accidental rather than the determined: the
device is on the range's own network, and the traffic is plain HTTP.

## Start delay

Covered under [starting a run](running-a-program.md#starting) — it is here as
well because it is a setting, and the two controls write the same value.

## Startup Issues

What the device could not read when it booted: a program file that does not
parse, a clip whose header is not a WAV it can play. The list is bounded and
drops the oldest, so a device with many bad files shows the most recent ones.

An empty list is the normal state and says the boot scan read everything.

## Storage

Partition sizes. Note the note: **size only — the device cannot report what is
used here** for some partitions, so a figure being absent is not a fault.

## Version

**App** is the version of the page you are looking at. **Device** is the
firmware's. One version number covers firmware, web app and shipped content,
so on a device flashed over USB the two match.

They can still come apart, because **a firmware update sent over the network
replaces the firmware only.** The web app and the shipped programs and audio
are stored separately on the device and are left as they were, so a device
updated that way keeps serving the web app it was last flashed with.

If this section reports a mismatch, it means one of two things:

- **The device was updated over the network.** Expected, and the fix is to
  flash it over USB, which brings both back into step.
- **The page came from somewhere other than this device** — a development
  build, or a copy served from a laptop — pointed at a board flashed with a
  different version.

A hard reload will not help with either. The browser is showing the version it
was given; the two really are different.
