#!/usr/bin/env python3
"""Fail the build if the application image, or the shipped audio inside it, has outgrown its budget.

    check_image_budget.py <partitions.csv> <app.bin> <embedded_index.generated.h>

The partition table becomes effectively write-once at the first release tag:
changing it costs a cable pass over every device in the field and wipes NVS
(see firmware/CONTRIBUTING.md). So the moment to notice the app slot filling up
is long before it is full, and the only thing that reliably notices is a check
that runs on every build.

Two ceilings, because they fail differently:

  * **The app image against its slot.** Over this and nothing boots, and the
    OTA endpoint refuses the upload. The ceiling is deliberately well under
    100%: an image that fits today with no headroom is an image that stops
    fitting on the next feature, at which point the fix is a cable pass.

  * **The shipped audio against its share.** Audio is the only content here
    that grows by somebody adding a file rather than by somebody writing code,
    so it is the one that can quietly eat the growth room. Failing separately
    says which of the two happened.
"""

import os
import re
import sys

# 80% of the slot. The measured image is around 3.3 MB of 4.5 MB (74%), so this
# is roughly one more feature's worth of warning - enough to plan, not so tight
# that ordinary work trips it.
APP_CEILING = 0.80

# The audio is 1.96 MB of a 4.5 MB slot today. 2.5 MB leaves room for the
# corpus to grow by a quarter before anybody has to think about it.
AUDIO_CEILING_BYTES = 2_500_000


def slot_size(partitions_csv: str, name: str) -> int:
    with open(partitions_csv, encoding="utf-8") as handle:
        for line in handle:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            fields = [f.strip() for f in line.split(",")]
            if len(fields) >= 5 and fields[0] == name:
                return int(fields[4], 0)
    raise SystemExit(f"{partitions_csv}: no partition named {name}")


def mount_sizes(index_header: str) -> dict[str, int]:
    """Bytes per top-level mount, from the generated index the packer emits."""
    sizes: dict[str, int] = {}
    pattern = re.compile(r'\{"(/[^"]*)",\s*(\d+),\s*(\d+)\}')
    with open(index_header, encoding="utf-8") as handle:
        for path, _offset, size in pattern.findall(handle.read()):
            parts = path.split("/")
            if len(parts) < 2 or not parts[1]:
                continue
            sizes[parts[1]] = sizes.get(parts[1], 0) + int(size)
    return sizes


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    partitions_csv, app_bin, index_header = sys.argv[1:4]

    slot = slot_size(partitions_csv, "ota_0")
    app = os.path.getsize(app_bin)
    mounts = mount_sizes(index_header)
    audio = mounts.get("audio", 0)

    print(f"app image   {app:>9,} B of {slot:,} B slot ({app / slot:.0%})")
    for mount in sorted(mounts):
        print(f"  {mount:<10}{mounts[mount]:>9,} B")

    failed = False
    if app > slot * APP_CEILING:
        print(
            f"::error::The app image is {app / slot:.0%} of the {slot // 1024 // 1024} MB slot, "
            f"over the {APP_CEILING:.0%} ceiling. The partition table cannot be changed over the "
            "air - growing the slot costs a cable pass over every device and wipes NVS.",
            file=sys.stderr,
        )
        failed = True
    if audio > AUDIO_CEILING_BYTES:
        print(
            f"::error::The shipped audio is {audio:,} B, over its {AUDIO_CEILING_BYTES:,} B share. "
            "Every clip added rides in the app image and in every OTA.",
            file=sys.stderr,
        )
        failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
