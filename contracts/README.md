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
that is the only version clients need to look at.

`info.version` in each document is **pinned at `1.0.0` and does not move.** It
had been tracking the shape history of the documents themselves, which produced
two numbers nobody consumes and one of them — AsyncAPI's `3.1.1` — a digit away
from the AsyncAPI spec version on the line above it. Nothing reads either field:
clients branch on the path prefix, and the product ships under one bare-semver
tag covering firmware, webapp and resources (D-29). A number that no consumer
reads and no rule governs is a number that goes stale.

So: do not bump `info.version` when the contract changes. If a change is
breaking, it moves the path prefix, which is the version that means something.

Within a major version, changes must be **additive**: a new endpoint, a new
optional field, a new enum member a client can ignore. Anything a deployed
client could break on — a removed field, a narrowed type, a changed status code
— is a new `/api/v3` prefix, which means a deliberate migration for the webapp
and every other client, not a quiet edit here.

**Recorded exceptions, D-16, D-23, D-27 and D-19:** `tickerSeconds` was
replaced by `tickerMs` in the `stateUpdate` payload without moving to
`/sse/v3`; `DELETE` on a read-only program or clip changed from `404` to `409`;
`POST /programs/start` grew a **required** body; and every error body changed
from `{"error": "prose"}` to an RFC 9457 problem detail served as
`application/problem+json` — the last three without moving to `/api/v3`
The webapp ships inside the firmware
image, so client and server are deployed atomically and there is no deployed
client to break; no release has ever been cut. See
`docs/DECISIONS.md`. The rule stands for everything after this — the exceptions
exist because the only client is in this repository, and they stop being
available the moment a firmware is released.

D-19 is the last of them by design: it is the closer of the work programme
these exceptions were opened for.

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

Error handling is the reason this matters most: `Problem.type` is an `enum`,
so the generator turns it into a TypeScript union of every problem type. The
webapp compares against members of that union instead of string-matching the
device's English, and a renamed slug becomes a `tsc` failure at every
comparison site.

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
