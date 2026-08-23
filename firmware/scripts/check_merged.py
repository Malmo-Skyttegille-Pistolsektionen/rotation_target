#!/usr/bin/env python3
"""Assert a merged factory image carries the app at its partition offset.

`esptool merge-bin` exiting 0 means it wrote a file, not that the file is
flashable: a wrong offset, a truncated input or a stale build directory all
produce a plausible image that boots whatever was on the board before. The
release publishes this image as the one-file way to flash a device, so the
claim is checked against the bytes rather than assumed.
"""

import argparse
import hashlib
import sys


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("factory", help="the merged image")
    ap.add_argument("app", help="the application binary that should be inside it")
    ap.add_argument(
        "--offset",
        default="0x20000",
        help="where the app partition starts (default: %(default)s)",
    )
    args = ap.parse_args()

    offset = int(args.offset, 0)
    with open(args.app, "rb") as handle:
        app = handle.read()

    with open(args.factory, "rb") as handle:
        handle.seek(offset)
        got = handle.read(len(app))

    if got != app:
        print(
            f"::error::{args.factory} does not carry {args.app} at {args.offset}",
            file=sys.stderr,
        )
        return 1

    digest = hashlib.sha256(app).hexdigest()
    print(f"{args.factory} carries the app at {args.offset} (sha256 {digest[:16]}…)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
