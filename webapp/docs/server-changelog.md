# Mock Server v2 Changelog (vs v1)

## Summary

This document lists behavioral deltas to port into the production server.

## Breaking / Behavioral Changes

- SSE uses `/sse/v2` and emits only `stateUpdate` + `heartbeat`.
- `stateUpdate` payload is camelCase and includes `loadedProgramId` (not full program), `programState`, and `targetStatus`.
- Program structure is no longer sent over SSE; clients fetch via `GET /api/v2/programs/{id}`.
- `programState.tickerSeconds` = total seconds elapsed in series (not event). Replaces per-event chrono updates.
- `programState.currentEventIndex` is derived from `tickerSeconds` based on cumulative event durations.
- SSE no longer includes admin mode status, program lists, or audio lists.
- REST `GET /api/v1/status` removed; state comes from SSE only.
- REST `GET /api/v1/admin-mode/status` remains REST-only.

## REST API Changes

- New `/api/v2/*` prefix for the new app.
- All `/api/v2/*` endpoints require admin auth.
- New `POST /api/v2/programs/reset` endpoint.
- `stop` now pauses execution and preserves `tickerSeconds` value.
- `start` resumes from paused `tickerSeconds` position.
- `skip_to` index bounds are validated; out-of-range returns `400`.

## Auth Changes

- Admin auth token flow unchanged from v1.
- Token automatically set as `admin` cookie on successful enable.
- Auth accepts both `Authorization: Bearer <token>` header and `Cookie: admin=<token>`.
- New `GET /api/v2/admin-mode/status` endpoint returns `{ enabled: true/false }` based on request auth.

## Naming Changes

- SSE event: `stateUpdate` (single event type).
- Payload fields camelCase: `loadedProgram`, `programState`, `currentSeriesIndex`, `currentEventIndex`, `targetStatus`, `audioIds`.
- Heartbeat payload: `{ id: number }`.
