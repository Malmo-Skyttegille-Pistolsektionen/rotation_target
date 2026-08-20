# Mock Server v2 Specification

Canonical machine-readable contract: [`../../contracts/`](../../contracts/README.md).
`docs/mock-api-v2.openapi.json` is a drifted fork of it that predates this
document and is on its way out; do not treat it as authoritative.

## Overview

Mock Server v2 is SSE-first. The legacy server (`/sse/v1`, `/api/v1/*`) still exists, but the current React app uses:

- REST base: `/api/v2`
- SSE endpoint: `/sse/v2`

## Auth

- `GET` endpoints stay public, even when admin mode is enabled.
- Mutating endpoints become protected only while admin mode is enabled.
- Accepted auth forms for protected requests:
  - `Authorization: Bearer <token>`
  - `Cookie: admin=<token>`
- `GET /api/v2/admin-mode/status` is public and returns only `{ enabled: boolean }`.
- `POST /api/v2/admin-mode/enable` accepts any non-empty `password` string while admin mode is off, and returns `409` if admin mode is already enabled.
- `POST /api/v2/admin-mode/login` accepts the active admin password while admin mode is on, and returns `409` if admin mode is off.
- Successful enable/login sets `Set-Cookie: admin=<token>; Path=/; SameSite=Lax`.
- The mock cookie is not marked `HttpOnly`.
- `POST /api/v2/admin-mode/disable` disables admin mode server-side, but does not send a cookie-clearing header.

## Endpoints

### SSE

- `GET /sse/v2`
  - Immediately emits a `stateUpdate` event.
  - Emits `stateUpdate` on every state change.
  - Emits `heartbeat` every 10 seconds.

### Public REST

- `GET /api/v2/admin-mode/status`
- `POST /api/v2/admin-mode/enable`
- `POST /api/v2/admin-mode/login`
- `GET /api/v2/programs`
- `GET /api/v2/programs/{id}`
- `GET /api/v2/audios`

### Conditionally Protected REST

These endpoints are public while admin mode is off, and require auth while admin mode is on:

- `POST /api/v2/admin-mode/disable`
- `POST /api/v2/programs/{id}/load`
- `POST /api/v2/programs/start`
- `POST /api/v2/programs/stop`
- `POST /api/v2/programs/reset`
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
    tickerSeconds: number | null;
  } | null;
  targetStatus: 'shown' | 'hidden';
}
```

Rules:

- `loadedProgramId` is `null` when nothing is loaded.
- `programState` is `null` when nothing is loaded.
- `tickerSeconds` is whole seconds elapsed in the current series.
- `currentEventIndex` is derived from elapsed series time.
- Program structure is fetched separately with `GET /api/v2/programs/{id}`.

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
- `start` resumes from current `tickerSeconds` if paused, otherwise starts from 0.
- `reset` resets execution to the start of the current series and sets `tickerSeconds` to `null`.
- `skip_to` validates the zero-based index; out-of-range returns `400` and does not change state.
