> **Superseded:** the canonical API contract lives in
> [`../../contracts/`](../../contracts/) (`openapi.yaml`, `asyncapi.yaml`).
> This document remains as prose background only.

# Mock Server v2 Specification

Canonical machine-readable contract: [`../../contracts/`](../../contracts/README.md).
This document describes the dev-only mock server (`vite-plugins/mock-server-v2.ts`),
not the contract itself.

## Overview

Mock Server v2 is SSE-first. The v1 mock (`/sse/v1`, `/api/v1/*`) was removed with `src_legacy`; the app uses:

- REST base: `/api/v2`
- SSE endpoint: `/sse/v2`

## Auth

- `GET` endpoints stay public, even when the control lock is on.
- Mutating endpoints become protected only while the control lock is on.
- Accepted auth forms for protected requests:
  - `Authorization: Bearer <token>`
  - `Cookie: control_lock=<token>`
- `GET /api/v2/control-lock/status` is public and returns only `{ enabled: boolean }`.
- `POST /api/v2/control-lock/enable` accepts any non-empty `password` string while the control lock is off, and returns `409` if the control lock is already enabled.
- `POST /api/v2/control-lock/login` accepts the password the lock was turned on with while the control lock is on, and returns `409` if the control lock is off.
- Successful enable/login sets `Set-Cookie: control_lock=<token>; Path=/; SameSite=Lax`.
- The mock cookie is not marked `HttpOnly`.
- `POST /api/v2/control-lock/disable` disables the control lock server-side, but does not send a cookie-clearing header.

## Endpoints

### SSE

- `GET /sse/v2`
  - Immediately emits a `stateUpdate` event.
  - Emits `stateUpdate` on every state change.
  - Emits `libraryChanged` when a program or an audio clip is created, replaced
    or deleted — never for load/start/stop/reset/skip_to/unload.
  - Emits `heartbeat` every 10 seconds.

### Public REST

- `GET /api/v2/control-lock/status`
- `POST /api/v2/control-lock/enable`
- `POST /api/v2/control-lock/login`
- `GET /api/v2/programs`
- `GET /api/v2/programs/{id}`
- `GET /api/v2/audios`
- `GET /api/v2/diagnostics/info`

### Conditionally Protected REST

These endpoints are public while the control lock is off, and require auth while the control lock is on:

- `POST /api/v2/control-lock/disable`
- `POST /api/v2/programs/{id}/load`
- `POST /api/v2/programs/start`
- `POST /api/v2/programs/stop`
- `POST /api/v2/programs/reset`
- `POST /api/v2/programs/unload`
- `POST /api/v2/programs/series/{idx}/skip_to`
- `POST /api/v2/targets/show`
- `POST /api/v2/targets/hide`
- `POST /api/v2/targets/toggle`
- `POST /api/v2/audios/{id}/play`

## SSE Events

### `stateUpdate`

Sent on connect and after every state change.

```typescript
interface StateUpdatePayload {
  loadedProgramId: number | null;
  programState: {
    running: boolean;
    currentSeriesIndex: number | null;
    currentEventIndex: number | null;
    tickerMs: number | null;
  } | null;
  targetStatus: 'shown' | 'hidden';
}
```

Rules:

- `loadedProgramId` is `null` when nothing is loaded.
- `programState` is `null` when nothing is loaded.
- `tickerMs` is milliseconds elapsed in the current series — millisecond
  precision at a one-second frame cadence (D-16). Whole seconds are
  `Math.floor(tickerMs / 1000)`.
- `currentEventIndex` is derived from elapsed series time.
- Program structure is fetched separately with `GET /api/v2/programs/{id}`.

### `libraryChanged`

Sent after a REST call changed what the device _stores_ (D-24). A
cache-invalidation signal, not a delta: refetch the list `kind` names.

```typescript
interface LibraryChangedPayload {
  kind: 'audio' | 'program';
}
```

Rules:

- `program` follows `POST /programs`, `PUT /programs/{id}` and
  `DELETE /programs/{id}/delete`; `audio` follows `POST /audios` and
  `DELETE /audios/{id}/delete`.
- Never emitted for run state — that is what `stateUpdate` is for. Deleting the
  loaded program emits both, for its two different reasons.
- Not emitted when a write is refused: a `409` changed nothing.
- `kind` is a closed enum; ignore one you do not recognise rather than
  refetching everything.

### `heartbeat`

Emitted every 10 seconds.

```typescript
interface HeartbeatPayload {
  id: number;
}
```

## REST Payload Shapes

Program payloads are served directly from the stored JSON files.

```typescript
interface Program {
  id: number;
  title: string;
  description: string;
  readonly: boolean;
  series: Series[];
}

interface Series {
  name: string;
  optional: boolean;
  events: Event[];
}

interface Event {
  duration: number; // milliseconds
  command?: 'show' | 'hide';
  audio_ids?: number[];
}
```

Notes:

- REST program payloads use snake_case `audio_ids`.
- `command` is optional in stored mock data.
- `GET /api/v2/audios` returns `{ audios: AudioFile[] }`, not a bare array.

## State Change Rules

- All state mutations broadcast a `stateUpdate` to every connected client.
- `stop` pauses execution and keeps the current position.
- `start` resumes from current `tickerMs` if paused, otherwise starts from 0.
- `reset` resets execution to the start of the current series and sets `tickerMs` to `null`.
- `skip_to` validates the zero-based index; out-of-range returns `400` and does not change state.
- `unload` clears the selection and broadcasts. A run in progress is `409`
  (`A program is running - stop it before unloading`); nothing loaded is `200`
  with the same message as a real unload and **no broadcast**, because the
  payload would repeat the one clients already hold (D-22). The targets stay
  where the run left them.
- A delete refused because the program or clip is read-only is `409`, not `404`
  (D-23): `404` means it is not there.
- `GET /diagnostics/info` carries `startupIssues` — the `backend_issue` payloads
  raised during boot, before the server existed (D-25). At most 8, oldest
  dropped, so exactly 8 may be a truncated list. Seeded per mock server; empty
  by default.
