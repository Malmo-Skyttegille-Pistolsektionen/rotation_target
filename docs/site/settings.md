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
| Control lock | device | Whether control is open to everyone or needs a login |
| Start delay | browser | Seconds counted down before a run starts |
| Startup Issues | device | What the device could not read when it booted |
| Storage | device | How much room the flash partitions have |
| WiFi | device | Which network it is on, and how good the link is |
| About | device | What firmware and web app this is, and exactly which build |

Nothing on this page can stop the device working. The settings that can —
which network it joins, which pins it drives, and the crash dump download —
are on [Expert mode](expert-mode.md), behind a button press on the board
itself.

## Server Base URL

Normally there is nothing to do here — the app talks to whatever served it.
It matters when the app is being run from somewhere other than the device
(during development, or from a copy on a laptop) and needs pointing at a board.

## Address

What the device reports as its own address. If it says the device has no
address, it is serving its own access point instead of being on a network —
see [the setup portal](connecting.md#the-setup-portal).

## Control lock

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

The one to look at is **`userdata`**. It holds what has been uploaded to the
device — programs and audio clips — and nothing else. Everything that ships
*with* the device is inside the firmware itself, so the shipped set growing can
no longer eat the room for yours, and updating the device cannot touch what you
put on it.

`ota_0` and `ota_1` are the two copies of the firmware. One is running and the
other is where an update is written, which is what lets a bad update be undone.
Seeing one of them nearly empty is normal on a device that has never been
updated.

## WiFi

Which network the device joined, how strong the signal is, the address it is
reachable at, and the MAC address a router lists it under. All of it is a
readout — nothing here changes anything.

**Which network matters, not just that there is one.** A device remembers the
network it was set up on *and* the one its firmware was built for, and joins
whichever it can see. A board that has been to two places may be on either, and
this is where you find out which.

**Signal** is shown as bars and as a number in dBm. The number is negative and
closer to zero is stronger — around −50 is excellent, −70 is workable, and
below about −80 is where a device starts dropping off the network. It is the
figure to watch while moving a board around looking for somewhere to mount it.

If it says **no network has been saved**, nobody has set this device up here.
It is running on whatever network its firmware was built for, which cannot be
read back or changed without rebuilding it — so if it is working, it is working
by luck of being in the right building.

To *change* the network, see [Expert mode](expert-mode.md#wifi). It restarts
the device, which is why it is not on this page.

## About

**App** is the version of the page you are looking at. **Device** is the
firmware's. One version number covers firmware, web app and shipped content,
and the web app is part of the firmware image itself — so a page served *by*
the device always matches it, however the device was updated.

That includes an update sent over the network, which used to be the awkward
case: it replaced the firmware and left the web app behind, so a device could
serve a page older than the firmware running it until somebody flashed it over
USB. That cannot happen any more. The shipped programs and audio are still
stored separately and are still not updated over the network.

So a mismatch now means one thing: **this page did not come from that device.**
A development build, or a copy served from a laptop, pointed at a board built
from a different commit.

A hard reload will not help. The browser is showing the version it was given;
the two really are different.

**Modified build** beside the device version means the firmware was built from
a working copy with uncommitted changes. On a board flashed from a release that
should not appear; on a board somebody has been developing against, it is
normal.

### Build details

**Build details** opens a table naming exactly which build this is: the commit,
when it was built, which branch it came from, the ESP-IDF version, and
fingerprints of the web app and audio it was built with.

None of it is worth reading day to day. It exists for one situation: **a board
that has come back from a range day behaving oddly.** "Which firmware is this"
is answerable from the version alone; "which commit, built where, with which
audio set" is not, and those are the questions that get a fault diagnosed.

**Copy** puts the whole block on the clipboard, ready to paste into a bug
report — which is the only thing it is for. If your browser refuses (some do on
a plain `http://` address, which is what the device serves), the text appears
below instead so you can select it by hand.

## Troubleshooting

The crash dump download has moved to [Expert mode](expert-mode.md#troubleshooting).
It is behind the device's BOOT button because a crash dump can contain the WiFi
password, and everything behind that button is now on one page rather than
appearing and disappearing on this one.

[Sending a fault report](troubleshooting.md#sending-a-fault-report) has the
steps and what it means for who you send it to.
