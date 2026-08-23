# Status LED

The status LED needs a page of its own, because it is the only thing the
device tells you when nobody has a browser open — and at the range that is the
normal case.

There are **two sequences**, not one, and which you are watching is the first
thing to work out: a device that knows a network, and a device that does not.

## A device that knows a network

The ordinary startup, every time the board is powered on at the range:

| LED | Means | What to do |
|---|---|---|
| **Blinking red** | Trying to join the stored network | Wait — it blinks once per join attempt, about every 2.4 s |
| **Yellow** | On the network, not serving yet | Normally invisible (~24 ms). If it *stays* yellow, WiFi is fine and the HTTP server is the fault |
| **Green** | Serving | Normal running state — [go and find it](connecting.md#finding-the-device) |

Blinking red for a few seconds on every boot is expected; joining a network is
not instant. It is only a problem if it does not end.

## A device that does not

A board that has never been configured, or that has been moved somewhere its
stored network does not exist, runs out of attempts and offers a network of its
own instead:

| LED | Means | What to do |
|---|---|---|
| **Blinking red** | Trying, and failing, to join | Wait for it to give up — it will |
| **Blue** | Setup portal on its own access point | [Join it and configure a network](connecting.md#the-setup-portal) |

After the portal saves a network, the device restarts and runs the first
sequence instead: blinking red, then green.

**Solid red** belongs to neither: it means the device gave up *and* did not
raise the portal. That is a fault rather than a state to act on — see
[Troubleshooting](troubleshooting.md).

## Two things worth saying, because neither is guessable

- **Blinking versus solid red is the important distinction.** Before
  [#122](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target/issues/122)
  both were solid, so "still coming up" and "never joined" looked identical —
  which is exactly the question you have at the range.
- **Yellow is a fault indicator, not a stage.** It exists to be seen only when
  something is wrong.

The LED is deliberately dim: the device sits on a range in the dark and a
bright indicator is a distraction downrange. Photographs for these docs should
be taken in low light or it will not read as the colours above.

<!-- TODO: low-light photographs of each LED state, per the note above -->
