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

**Recorded exceptions, D-16 and D-23:** `tickerSeconds` was replaced by
`tickerMs` in the `stateUpdate` payload without moving to `/sse/v3`, and
`DELETE` on a read-only program or clip changed from `404` to `409` without
moving to `/api/v3`. The webapp ships inside the firmware image, so client and
server are deployed atomically and there is no deployed client to break; no
`firmware-vX.Y.Z` tag has ever been cut. See `docs/DECISIONS.md`. The rule
stands for everything after this — the exceptions exist because the only client
is in this repository, and they stop being available the moment a firmware is
released.

`GET /api/v2/version` reports the *firmware* version, not this one. A client
that needs to know whether a firmware is new enough for a particular endpoint
uses that.

## How the webapp consumes it

The webapp generates its types from `openapi.yaml` rather than hand-writing
them:

```jsonc
// webapp/package.json
"scripts": {
  "generate:api": "openapi-typescript ../contracts/openapi.yaml -o src/api/generated.d.ts"
}
```

`src/api/generated.d.ts` is committed, and CI re-runs the generator and fails
on `git diff` — so a merged contract change the webapp has not caught up with
is a red build, not a silent runtime mismatch. `src/api/types.ts` is
hand-written and re-exports the shapes the app actually uses by name; SSE
payloads live there too, since `asyncapi.yaml` is not fed to the generator.
Either way the types carry **zero runtime bytes**, and spec drift becomes a
`tsc` failure rather than a broken range.

## Validating

```bash
cd contracts && ./validate.sh
```

Needs `check-jsonschema` (`pip install check-jsonschema`) and `npx`. The
OpenAPI and AsyncAPI documents are linted, the JSON Schema is checked against
its metaschema, and every shipped program in `resources/programs/files/` is
validated against it.
