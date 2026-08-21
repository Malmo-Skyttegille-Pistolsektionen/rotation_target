#!/usr/bin/env python3
"""Read the esp_app_desc_t header out of an ESP-IDF application image.

The version a device reports is the one baked into this header at build time
(from `git describe` at CMake-configure time), not the one in a filename or a
tag. The release workflow reads it back out of the built image, and again out
of the *published* asset, so a release can never advertise a version the
firmware does not answer with.

Usage:
    app_desc.py IMAGE [--field version|project_name|idf_ver|date|time]
    app_desc.py IMAGE            # prints every field as `name: value`
"""

from __future__ import annotations

import argparse
import struct
import sys

# esp_image_header_t (24 bytes) + the first esp_image_segment_header_t (8 bytes)
# precede the description, per components/esp_app_format/include/esp_app_desc.h.
APP_DESC_OFFSET = 0x20
APP_DESC_MAGIC = 0xABCD5432

# magic, secure_version, reserv1[2], version[32], project_name[32],
# time[16], date[16], idf_ver[32]
_HEADER = struct.Struct("<II8s32s32s16s16s32s")

FIELDS = ("version", "project_name", "time", "date", "idf_ver")


def _text(raw: bytes) -> str:
    return raw.split(b"\0", 1)[0].decode("utf-8", "replace")


def read_app_desc(path: str) -> dict[str, str]:
    with open(path, "rb") as handle:
        blob = handle.read(APP_DESC_OFFSET + _HEADER.size)
    if len(blob) < APP_DESC_OFFSET + _HEADER.size:
        raise SystemExit(f"{path}: too short to be an application image")

    magic, _secure, _reserved, version, project, time_, date, idf = _HEADER.unpack_from(
        blob, APP_DESC_OFFSET
    )
    if magic != APP_DESC_MAGIC:
        raise SystemExit(
            f"{path}: no esp_app_desc_t at offset {APP_DESC_OFFSET:#x} "
            f"(magic {magic:#010x}, expected {APP_DESC_MAGIC:#010x})"
        )
    return dict(
        zip(FIELDS, (_text(version), _text(project), _text(time_), _text(date), _text(idf)))
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", help="path to the application .bin")
    parser.add_argument("--field", choices=FIELDS, help="print just this field")
    args = parser.parse_args()

    desc = read_app_desc(args.image)
    if args.field:
        print(desc[args.field])
    else:
        for name in FIELDS:
            print(f"{name}: {desc[name]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
