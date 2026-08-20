# Historical contracts — API v1

These two files describe **API v1**: the MicroPython backend
(`rotation_target_backend_esp32_micropython`) and the app-era clients that
spoke to it. They are kept as a record of what the system used to promise, and
for the occasional archaeology question — "did v1 have this endpoint, and what
did it answer?" Nothing in this repository implements them.

| File | Describes |
|---|---|
| `openapi.yaml` | REST under `/api/v1` |
| `asyncapi.yaml` | SSE at `/sse/v1`, with the discrete `program_added` / `program_updated` / … lifecycle events |

**They are not maintained.** They were already stale against v1 before being
moved here, and nothing checks them. The canonical contracts are one directory
up; see [`../README.md`](../README.md).

## What v2 changed

- `/api/v1` → `/api/v2`, `/sse/v1` → `/sse/v2`.
- SSE went from discrete lifecycle events to a single `stateUpdate` carrying
  the full run state, plus a `heartbeat`. `GET /status` went away with them:
  the state on connect replaces it.
- `POST /programs/{id}/update` does not exist in v2. There is no update path
  at all — posting a program always creates a new one.
- `backend_issue` (v1's error event) has no v2 equivalent yet.
- Admin mode gained `login` and `logout` alongside `enable`/`disable`, and
  bearer-token authentication alongside the cookie.
- `GET /diagnostics/info` is new in v2.

## The one edit made on the way in

The three `$ref`s in `openapi.yaml` pointed at `./program.schema.json`, which
now lives at `../program.schema.json` — the program document schema is still
current, so it was promoted rather than copied. The references were repointed
so the file still resolves; nothing else was touched.
