# Status LED

The status LED needs a page of its own, because it is the only thing the
device tells you when nobody has a browser open — and at the range that is the
normal case.

The states as of [#122](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target/issues/122),
in the order a healthy boot passes through them:

| LED | Means | What to do |
|---|---|---|
| **Blinking red** | Trying to join a network | Wait — it blinks once per join attempt, about every 2.4 s |
| **Solid red** | Out of attempts, no network | Check the SSID is in range; the setup portal usually takes over |
| **Yellow** | On the network, not serving yet | Normally invisible (~24 ms). If it *stays* yellow, WiFi is fine and the HTTP server is the fault |
| **Green** | Serving | Normal running state |
| **Blue** | Setup portal on its own access point | Join the device's own WiFi and configure a network |

Two things worth saying in the prose, because neither is guessable:

- **Blinking versus solid red is the important distinction.** Before #122 both
  were solid, so "still coming up" and "never joined" looked identical — which
  is exactly the question you have at the range.
- **Yellow is a fault indicator, not a stage.** It exists to be seen only when
  something is wrong.

The LED is deliberately dim: the device sits on a range in the dark and a
bright indicator is a distraction downrange. Photographs for these docs should
be taken in low light or it will not read as the colours above.

<!-- TODO: low-light photographs of each LED state, per the note above -->
