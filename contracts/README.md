# Contracts

The canonical API contract for the rotation target. Everything here describes
**what the firmware in `firmware/` actually does** — these files are written
from the implementation, and where prose documentation disagreed with the code,
the code won.

| File | Covers |
|---|---|
| `openapi.yaml` | The REST API under `/api/v2` — OpenAPI 3.1 |
| `asyncapi.yaml` | The SSE stream at `/sse/v2` — AsyncAPI 3.1 |
| `program.schema.json` | The program document, as stored and as served |
| `redocly.yaml` | Lint configuration for `openapi.yaml` |
| `validate.sh` | Lints all three |
| `history/` | The API v1 specs, kept as a record only |

`firmware/docs/api-v2.md` remains the prose companion: the *why* behind the
contract — execution semantics, the auth model, the upload rules — with this
directory as the machine-readable authority on shapes and status codes.

## The rule

**A contract change lands in `contracts/` in the same PR as the implementation
change.** Not before, not after, not in a follow-up. A spec that describes a
plan rather than the running firmware is worse than no spec, because clients
generate code from it.

That is the whole reason these files moved out of `resources/` and out of the
webapp: there were three drifting copies of the API description and no rule
about which one was true.

## Versioning

The contract is versioned by its **path prefix** — `/api/v2`, `/sse/v2` — and
that is the only version clients need to look at. `info.version` in each
document tracks the contract itself, not the firmware: it moves when the shapes
move, and it is unrelated to the `firmware-vX.Y.Z` tags.

Within a major version, changes must be **additive**: a new endpoint, a new
optional field, a new enum member a client can ignore. Anything a deployed
client could break on — a removed field, a narrowed type, a changed status code
— is a new `/api/v3` prefix, which means a deliberate migration for the webapp
and every other client, not a quiet edit here.

`GET /api/v2/version` reports the *firmware* version, not this one. A client
that needs to know whether a firmware is new enough for a particular endpoint
uses that.

## How the webapp consumes it

The webapp generates its types from `openapi.yaml` rather than hand-writing
them:

```jsonc
// webapp/package.json
"scripts": {
  "generate:api": "openapi-typescript ../contracts/openapi.yaml -o src/api/types.ts"
}
```

`src/api/types.ts` is generated at build time and carries **zero runtime
bytes** — it is types only. The point is that spec drift becomes a `tsc`
failure: if the firmware and this document change a shape and the webapp still
uses the old one, the build breaks rather than the range does.

Wiring that up is task 3.4 of the implementation plan, which also deletes
`webapp/docs/mock-api-v2.openapi.json` — a drifted fork of this contract that
predates it.

## Validating

```bash
cd contracts && ./validate.sh
```

Needs `check-jsonschema` (`pip install check-jsonschema`) and `npx`. The
OpenAPI and AsyncAPI documents are linted, the JSON Schema is checked against
its metaschema, and every shipped program in `resources/programs/files/` is
validated against it.
