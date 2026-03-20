# Mock Server v2 Changelog (vs v1)

## Summary

This document lists behavioral deltas to port into the production server.

Canonical contract: `docs/mock-api-v2.openapi.json`.

## Breaking / Behavioral Changes

- SSE uses `/sse/v2` and emits only `stateUpdate` + `heartbeat`.
- `stateUpdate` payload is camelCase and includes `loadedProgramId` (not full program), `programState`, and `targetStatus`.
- Program structure is no longer sent over SSE; clients fetch via `GET /api/v2/programs/{id}`.
- `programState.tickerSeconds` = total seconds elapsed in series (not event). Replaces per-event chrono updates.
- `programState.currentEventIndex` is derived from `tickerSeconds` based on cumulative event durations.
- SSE no longer includes admin mode status, program lists, or audio lists.
- REST `GET /api/v1/status` removed; state comes from SSE only.
- REST program payloads are served from stored JSON and still expose snake_case `audio_ids`.
- Stored mock program events may omit `command`.

## REST API Changes

- New `/api/v2/*` prefix for the new app.
- `GET /api/v2/programs`, `GET /api/v2/programs/{id}`, `GET /api/v2/audios`, and `GET /api/v2/admin-mode/status` stay public.
- Mutating endpoints require auth only while admin mode is enabled.
- New `POST /api/v2/programs/reset` endpoint.
- `stop` now pauses execution and preserves `tickerSeconds` value.
- `start` resumes from paused `tickerSeconds` position.
- `skip_to` index bounds are validated; out-of-range returns `400`.

## Auth Changes

- `POST /api/v2/admin-mode/enable` accepts any non-empty password string.
- Token automatically set as `admin` cookie on successful enable.
- Auth accepts both `Authorization: Bearer <token>` header and `Cookie: admin=<token>`.
- New `GET /api/v2/admin-mode/status` endpoint returns only the global `{ enabled: true/false }` state and ignores request auth.
- Enable response cookie is `SameSite=Lax` but not `HttpOnly`.
- Disable does not clear the cookie in the response.

## Naming Changes

- SSE event: `stateUpdate` (single state event type).
- SSE payload fields camelCase: `loadedProgramId`, `programState`, `currentSeriesIndex`, `currentEventIndex`, `targetStatus`.
- Program REST payloads are not camelized; they keep stored `audio_ids`.
- Heartbeat payload: `{ id: number }`.
