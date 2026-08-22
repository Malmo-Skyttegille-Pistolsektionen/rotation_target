#!/bin/bash
set -uo pipefail

# The canonical schema lives in contracts/; see contracts/README.md.
SCHEMA="$(dirname "$0")/../../contracts/program.schema.json"

# Kept in lock-step with kFirstUploadId in firmware/main/config.h. A shipped
# program numbered at or past this sits inside the range add_uploaded()
# assigns from - that collision is what #129 found: an uploaded program
# silently shadowed a shipped one landed at the same id.
FIRST_UPLOAD_ID=100

status=0

for file in "$(dirname "$0")"/files/*.json; do
    echo "Validating $file..."
    if ! check-jsonschema --schemafile "$SCHEMA" "$file"; then
        echo "$file: INVALID"
        status=1
        continue
    fi

    id=$(python3 -c "import json, sys; print(json.load(open(sys.argv[1]))['id'])" "$file")
    if [ "$id" -ge "$FIRST_UPLOAD_ID" ]; then
        echo "$file: INVALID - id $id is at or past the upload range (kFirstUploadId=$FIRST_UPLOAD_ID)"
        status=1
        continue
    fi

    # Every audio_ids entry must resolve to a clip in audios.json. Nothing
    # checked this, and renumbering a shipped clip for the id-range fix left
    # "Militar Snabbmatch (med signal)" pointing at 38 events' worth of a clip
    # that no longer existed - silently, because a program with a dangling
    # reference still parses, still validates against the schema, and still
    # runs. It just stops making the noise it is named for.
    if ! python3 "$(dirname "$0")/check_audio_refs.py" "$file"; then
        status=1
        continue
    fi

    echo "$file: VALID"
done

exit "$status"
