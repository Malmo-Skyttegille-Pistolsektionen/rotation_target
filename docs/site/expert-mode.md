# Expert mode

Everything that can stop the device working lives here, and nothing else does.

Most clubs never open this page. The settings on it are the ones set once, when
a board is first put together or moved somewhere new — and getting one wrong
does not produce a warning, it produces a device that no longer answers.

## Getting in

**Press the BOOT button on the device three times within ten seconds.** It is
next to the USB sockets and may be marked `FLASH`. An **Expert mode** tab
appears in the web app and stays for five minutes; press three times again for
a fresh five.

Three presses rather than one so it cannot happen by accident, and a button
rather than a password because the thing being established is that **somebody
is standing at the device**. That is not something anyone can do from across
the range, at any distance, with any credential — which is the whole point.

!!! note "It will not open during a run"

    A program that is running holds the window shut. Reconfiguring the machine
    and operating it are different jobs, and these settings only take effect
    when the device restarts anyway. Stop the run first.

If the tab is not there, nobody has pressed the button recently. If it vanishes
while you are typing, the five minutes ran out — press three times again and
carry on.

## WiFi

Which network the device joins. The same form as
[the setup portal](connecting.md#the-setup-portal), because it is the same job:
pick a network from the list, or type the name of one the scan did not find,
and give the password.

**This is the answer to "the network it knows still exists, but I want it
somewhere else."** Before this existed, the only way was to erase everything
the device knew and let it fall back to its setup portal — see
[moving the device](connecting.md#moving-the-device-to-a-different-network),
which is still the route when the board cannot reach *any* network it knows.

!!! warning "Saving restarts the device"

    The page will stop responding, on purpose — you are taking the device off
    the network the page is served over.

    - If it joins the new network, it comes back at the same name. Reload after
      a few seconds.
    - **If it cannot, it raises its own setup network** (`…-setup-XXXX`) and
      waits there, exactly like a board that has never been configured. That is
      the way back, not a fault — [the setup portal](connecting.md#the-setup-portal)
      has the steps.

    Nothing you have uploaded is affected. Programs and clips are a separate
    thing from which network the device is on.

**Rescan networks** runs a fresh scan. It takes a couple of seconds during
which the device's radio is off its own channel, so the page may pause — that
is the scan, not a fault.

**For a hidden network**, leave the list alone and type the name. A hidden
network never appears in a scan, so the list cannot offer it.

## Hardware

Which pins this board uses, what it calls itself, and how it joins the network.
Wrong values here are the ones whose way back is a USB cable:

- A **wrong pin** drives nothing, and one of the pins the device refuses would
  stop it booting at all — which is why it refuses them.
- A **wrong hostname** changes the name the device answers to, so the web app
  stops being reachable at `rotation-target.local`. Worse than a wrong pin,
  which at least leaves the app up to fix it from.

**Nothing here takes effect until the device restarts**, and the page says so
when a saved value is not yet in use. A change that appears to have done
nothing is how somebody ends up reflashing a working device.

**Where the targets rest at boot** is shown but not editable. Which position is
safe at rest is a property of the target system, so it has to be configurable —
but it is also what protects somebody standing downrange when a board is
powered, so it changes only from the serial console with a cable attached.

## Troubleshooting

One zip file holding the device's own details and, if it has crashed, the crash
dump — the thing to attach to a message when a board has come back from a range
day behaving oddly.

!!! warning "A crash dump can contain the WiFi password"

    It is a copy of the device's memory at the moment it failed. Send it to
    somebody you would tell the password to.

That is why it is behind the button press, and it is *only* behind the button
press: [admin mode](settings.md#admin-mode) does not block it. Collecting a
fault report is a read, it interferes with nobody, and the person most likely
to want one during a competition is whoever is not driving.

[Sending a fault report](troubleshooting.md#sending-a-fault-report) has the
steps.
