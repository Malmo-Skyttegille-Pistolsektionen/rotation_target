# Connecting

The board serves its own web app — there is nothing to install. Join the same
WiFi network the device is on, then open the device's address in a browser.

## Finding the device

The device advertises itself over mDNS, so on most phones, tablets and
laptops its address is just its hostname:

```
http://rotation-target.local
```

If that name does not resolve — some routers or guest networks block mDNS —
find the device's IP address instead, for example from the router's client
list, and open `http://<that address>` directly. The [status LED](status-led.md)
turns **green** once the device is on the network and serving the web app; if
it is not green yet, the app is not reachable regardless of address.

## The setup portal

A device that has never joined a network — or has lost the one it was
configured with — falls back to a network of its own, signalled by a **blue**
status LED. Its name follows the pattern `rotation-target-setup-XXXX`, where
`XXXX` is unique to that device, so two boards on the same site can be told
apart.

That network is normally password-protected; ask whoever set the device up for
its password if joining does not prompt for one automatically. Once joined, a
captive-portal page should open on its own; if it does not, browse to
`http://192.168.4.1`. The page asks for the network name (SSID) and password
the device should use, saves them, and restarts — the device then joins that
network the normal way.

<!-- TODO: screenshots -->
