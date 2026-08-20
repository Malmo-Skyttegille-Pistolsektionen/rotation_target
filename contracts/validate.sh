#!/bin/bash
# Lints the canonical contracts and validates the shipped programs against the
# program schema. Run from anywhere; paths are resolved from this file.
set -uo pipefail

cd "$(dirname "$0")" || exit 1
status=0

# pip install check-jsonschema
check-jsonschema --check-metaschema program.schema.json || status=1

# Every shipped program must validate against the schema.
check-jsonschema --schemafile program.schema.json ../resources/programs/files/*.json || status=1

# npx will use local or global @redocly/cli; redocly.yaml configures the rules.
npx --yes @redocly/cli lint openapi.yaml || status=1

npx --yes @asyncapi/cli validate asyncapi.yaml || status=1

exit "$status"
