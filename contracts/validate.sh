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

# Pinned: an unpinned CLI can turn main red from an upstream rule change with
# no commit of ours behind it. redocly.yaml configures the rules.
# renovate: datasource=npm depName=@redocly/cli
npx --yes @redocly/cli@2.49.0 lint openapi.yaml || status=1

# renovate: datasource=npm depName=@asyncapi/cli
npx --yes @asyncapi/cli@6.0.2 validate asyncapi.yaml || status=1

exit "$status"
