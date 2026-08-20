# Mock API v2 Gap Analysis

## Scope

This compares `docs/mock-api-v2.openapi.json` against the best available signals for the current real backend contract in this repo:

- `src_legacy/apis/rest-client.js`
- `src_legacy/apis/sse-client.js`
- `src_legacy/common/sse-types.js`
- `vite-plugins/mock-server.ts`
- `README.md`
- `docs/architecture.md`

The actual ESP32 backend source is not present here, so this is a contract-gap analysis, not a source-code verification.

## High-Confidence, Frontend-Critical Gaps

### 1. SSE model is completely different

Current real/v1 signals:

- Many SSE event types: `program_loaded`, `program_started`, `series_started`, `series_completed`, `series_stopped`, `series_next`, `event_started`, `event_completed`, `target_status`, `target_status_changed`, `audio_playback`, `admin_mode_status`, `chrono`, `heartbeat`
- No single canonical state event
- No immediate full-state event on connect

Mock API v2 spec:

- Only `stateUpdate` + `heartbeat`
- `stateUpdate` is sent immediately on connect
- `stateUpdate` is the single source for run state

Real API change needed:

- Add `/sse/v2`
- Emit immediate `stateUpdate`
- Emit `stateUpdate` after every state mutation
- Move frontend state sync from many event-specific payloads to one canonical payload

### 2. State transport moved from REST + event fragments to SSE-first state

Current real/v1 signals:

- `GET /api/v1/status` exists and is part of the contract
- Status payload shape is `{ running, next_event, target_status }`
- `chrono` SSE event carries elapsed/remaining timing

Mock API v2 spec:

- `GET /api/v1/status` equivalent is removed
- Current state comes from SSE only
- Timing is represented by `programState.tickerSeconds`

Real API change needed:

- Add SSE-first state model
- Stop relying on `/status` for current execution state
- Derive UI from `StateUpdatePayload`

### 3. Program execution semantics changed

Current real/v1 signals:

- `POST /programs/stop` resets current event index to `0`
- `start` restarts execution from series start after stop
- No explicit `reset` endpoint
- `skip_to` emits `series_next` and does not clearly pause execution state

Mock API v2 spec:

- `stop` pauses and keeps position
- `start` resumes from paused `tickerSeconds`
- `reset` is a new explicit endpoint
- `skip_to` pauses and resets series position cleanly

Real API change needed:

- Change `stop` from stop-and-reset to pause
- Add `POST /api/v2/programs/reset`
- Add resume semantics to `start`
- Make `skip_to` set deterministic paused state

### 4. SSE/REST naming changed to new v2 payload contract

Current real/v1 signals:

- SSE payload fields are snake_case-ish/event-specific (`program_id`, `series_index`, `event_index`, `target_status_shown`)
- Audio playback response uses `audio_id`

Mock API v2 spec:

- SSE state payload is camelCase: `loadedProgramId`, `currentSeriesIndex`, `currentEventIndex`, `targetStatus`
- Audio play response uses `audioId`

Real API change needed:

- Standardize new v2 payload shapes and field names
- Keep v1 and v2 separate if backward compatibility is needed

## High-Confidence REST Contract Gaps

### New in mock v2, not present in current real/v1 signals

- `POST /api/v2/programs/reset`
- `GET /sse/v2` canonical state stream

### Present in current real/v1 signals, but intentionally absent from mock v2 spec

- `GET /api/v1/status`
- `POST /api/v1/programs`
- `PUT /api/v1/programs/{id}/update`
- `DELETE /api/v1/programs/{id}/delete`
- `POST /api/v1/audios`
- `DELETE /api/v1/audios/{id}/delete`

Decision needed in real API:

- Either keep these as v1-only endpoints outside the new v2 contract
- Or define a v2 CRUD story explicitly and extend the spec

## High-Confidence Auth Gaps

### 1. Cookie support vs bearer-only legacy flow

Current real/v1 signals:

- Legacy client stores bearer token in localStorage
- Requests authenticate with `Authorization: Bearer <token>`
- No cookie contract is visible in the legacy client or v1 mock

Mock API v2 spec:

- Protected endpoints accept bearer token or `admin` cookie
- Enable sets `Set-Cookie: admin=<token>; Path=/; SameSite=Lax`

Real API change needed:

- Add cookie-based auth support if v2 clients should work exactly like the mock
- Or keep bearer-only auth and intentionally diverge from the mock spec

### 2. Admin enable semantics changed

Current real/v1 signals:

- v1 mock requires an exact password match

Mock API v2 spec:

- Any non-empty password succeeds

Decision needed in real API:

- If parity with the mock is the goal, production behavior must loosen
- If production should stay stricter, this should be an intentional spec deviation, not an accidental one

## High-Confidence Response/Behavior Gaps

### Program load/start/stop responses

Current real/v1 signals:

- `load` and `start` often return empty bodies
- `stop` returns `Series stopped and reset to the first event`

Mock API v2 spec:

- `load`, `start`, `stop`, `reset`, `skip_to` all return JSON message bodies

### Audio playback behavior

Current real/v1 signals:

- `POST /audios/{id}/play` emits `audio_playback` SSE events with `started` and `finished`
- Response uses `audio_id`

Mock API v2 spec:

- Playback is only acknowledged over REST
- No SSE playback lifecycle events
- Response uses `audioId`

### Target control behavior

Current real/v1 signals:

- Target changes emit `target_status_changed`
- Response messages are `Target is now shown/hidden`

Mock API v2 spec:

- Target changes appear via `stateUpdate`
- Response messages are `Targets shown/hidden`

## Mock-Only Quirks To Decide Before Production Port

These are accurately captured in the spec because they exist in the mock, but they may be poor production behavior:

- `POST /api/v2/admin-mode/enable` accepts any non-empty password while admin mode is off, and `POST /api/v2/admin-mode/login` reuses that password while admin mode is on
- Enable cookie is not `HttpOnly`
- Disable does not send a cookie-clearing header

Recommendation:

- Treat these as explicit product/security decisions before porting to ESP32
- If production should be stricter, version the deviation clearly instead of silently changing behavior

## Suggested Implementation Order For The Real API

1. Implement `/sse/v2` with immediate `stateUpdate`
2. Implement v2 execution state model (`loadedProgramId`, `programState`, `targetStatus`)
3. Change `stop/start/skip_to` semantics and add `reset`
4. Add `/api/v2/*` REST endpoints matching the spec
5. Decide whether auth stays bearer-only or follows mock cookie behavior
6. Decide whether program/audio CRUD stays v1-only or gets a v2 contract

## Bottom Line

The biggest real API work is not endpoint renaming. It is the state model rewrite:

- SSE becomes the primary state channel
- execution control semantics change
- `/status` and event-fragment SSE stop being the frontend contract
- auth behavior needs an explicit production decision
