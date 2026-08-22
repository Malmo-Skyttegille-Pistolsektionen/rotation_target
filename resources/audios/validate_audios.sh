#!/bin/bash
# The audio-side counterpart to ../programs/validate_programs.sh.
#
# The firmware allocates uploaded clips from kFirstUploadId just as it does
# programs, so a shipped clip at or past that id is shadowed by an upload the
# same way (#129). Nothing checked the audio side.
set -uo pipefail

cd "$(dirname "$0")" || exit 1

# Kept in lock-step with kFirstUploadId in firmware/main/config.h, and with
# FIRST_UPLOAD_ID in ../programs/validate_programs.sh.
FIRST_UPLOAD_ID=1000

python3 - "$FIRST_UPLOAD_ID" <<'PY'
import json
import sys
from pathlib import Path

first_upload_id = int(sys.argv[1])
index = json.loads(Path("audios.json").read_text())

status = 0
for key, entry in sorted(index.items(), key=lambda kv: int(kv[0])):
    audio_id = int(key)

    if audio_id >= first_upload_id:
        print(f"audios.json: INVALID - id {audio_id} is at or past the upload "
              f"range (kFirstUploadId={first_upload_id})")
        status = 1

    # A clip whose file is missing plays silence, and a range command nobody
    # hears is the failure this exists to prevent.
    filename = entry.get("filename")
    if not filename:
        print(f"audios.json: INVALID - id {audio_id} has no filename")
        status = 1
    elif not (Path("files") / filename).is_file():
        print(f"audios.json: INVALID - id {audio_id} names {filename}, which is "
              f"not in files/")
        status = 1

if status == 0:
    print(f"audios.json: VALID - {len(index)} clips, all below {first_upload_id}")
sys.exit(status)
PY
