#!/bin/bash

SCHEMA="../openapi/program.schema.json"

for file in *.json; do
    echo "Validating $file..."
    check-jsonschema --schemafile "$SCHEMA" "$file"
    if [ $? -eq 0 ]; then
        echo "$file: VALID"
    else
        echo "$file: INVALID"
    fi
done