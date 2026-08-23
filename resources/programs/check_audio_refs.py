#!/usr/bin/env python3
"""Every `audio_ids` entry in a program must name a clip that exists.

A program with a dangling reference parses, validates against the schema and
runs - it simply plays nothing where the clip should have been. That is the
worst kind of failure for a range command, so it is checked here rather than
discovered at the firing line.
"""

import json
import sys
from pathlib import Path

program_path = Path(sys.argv[1])
audios_path = program_path.parent.parent.parent / "audios" / "audios.json"

known = {int(key) for key in json.loads(audios_path.read_text())}
program = json.loads(program_path.read_text())

referenced = {
    audio_id
    for series in program.get("series", [])
    for event in series.get("events", [])
    for audio_id in (event.get("audio_ids") or [])
}

missing = sorted(referenced - known)
if missing:
    print(f"{program_path}: INVALID - audio ids not in {audios_path.name}: {missing}")
    sys.exit(1)
