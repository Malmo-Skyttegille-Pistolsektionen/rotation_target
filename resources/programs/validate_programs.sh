#!/bin/bash

# The canonical schema lives in contracts/; see contracts/README.md.
SCHEMA="$(dirname "$0")/../../contracts/program.schema.json"

for file in "$(dirname "$0")"/files/*.json; do
    echo "Validating $file..."
    check-jsonschema --schemafile "$SCHEMA" "$file"
    if [ $? -eq 0 ]; then
        echo "$file: VALID"
    else
        echo "$file: INVALID"
    fi
done