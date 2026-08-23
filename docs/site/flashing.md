# Flashing a board

Getting the firmware onto an ESP32-S3. You do not need a toolchain for this —
releases ship a pre-built image.

Two files are published with each release:

| File | Use it when |
|---|---|
| `rotation_target-<version>-factory.bin` | **A new board**, or one you want back in a known state. Everything in one file. **It replaces the programs and audio on the device**, because the storage image is part of it. |
| `rotation_target-<version>-ota.bin` | **An already-working device.** The firmware only — it leaves the network settings, the hardware configuration and the uploaded programs and audio alone. |

!!! warning "The factory image replaces uploaded programs and audio"

    If the device has programs or clips a club uploaded, use the OTA route
    instead — either the **Firmware** page in the web app, or
    `rotation_target-<version>-ota.bin`. The factory image is for a board that
    has nothing on it worth keeping.

## From a browser (no software to install)

Espressif's own flasher runs in the browser and is the easiest route on a
machine you do not want to install tools on.

1. Connect the board to your computer with a **USB-C data cable**. A charge-only
   cable will not work, and is the most common reason a board does not appear.
2. Open the [**Espressif web flasher**](https://espressif.github.io/esptool-js/)
   in **Chrome or Edge**. Firefox and Safari do not implement Web Serial and
   cannot do this.
3. Click **Connect** and pick the board's serial port.
4. In the **Program** section, set the flash address to **`0x0`** and choose
   `rotation_target-<version>-factory.bin`.
5. Click **Program** and wait. The factory image is about 16 MB, so this takes a
   few minutes — the console at the bottom shows progress.

When it finishes, the device restarts and comes up in setup mode. Continue at
[Connecting](connecting.md).

## From the command line

If you already have ESP-IDF, or you would rather use `esptool`:

```bash
python -m esptool --chip esp32s3 -p <port> \
  write-flash 0x0 rotation_target-<version>-factory.bin
```

`<port>` is `/dev/ttyACM0` or similar on Linux, `/dev/cu.usbmodem*` on macOS,
`COM5` or similar on Windows.

## Updating an existing device

Do not reflash. Open the web app, go to **Settings → Firmware**, and upload
`rotation_target-<version>-ota.bin`. The device verifies the image before it
switches to it, and keeps everything else.

## If it goes wrong

- **The board does not appear as a serial port.** Almost always the cable —
  try a different USB-C cable, one you know carries data.
- **The browser cannot see the port.** Chrome or Edge only, and on Linux your
  user may need to be in the `dialout` group.
- **Reading a backup image fails partway** with
  `Packet content transfer stopped`. That is a known quirk of this board and
  not a fault: reads over about 256 KB need `--no-stub`. Writing is unaffected.
  See [Hardware](hardware.md).
