#!/bin/bash
# pip install check-jsonschema
check-jsonschema --check-metaschema program.schema.json

# npx will use local or global @redocly/cli
npx @redocly/cli lint --skip-rule no-server-example.com openapi.yaml