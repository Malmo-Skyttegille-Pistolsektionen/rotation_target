# Mock Server v2 Specification

## Overview

Mock Server v2 is SSE-first. Clients render server state with minimal local logic. The legacy server (`/sse/v1`, `/api/v1/*`) remains unchanged.

## Auth

- Admin auth uses token flow: POST `/admin-mode/enable` with password returns token.
- Token is set as `admin` cookie automatically on successful enable.
- Auth can be provided via:
  - `Authorization: Bearer <token>` header
  - `Cookie: admin=<token>`
- All `/api/v2/*` endpoints require admin auth (except `/admin-mode/enable`).
- `GET /admin-mode/status` returns `{ enabled: true }` only if admin mode is on AND request has valid auth.

## Endpoints

### SSE

- `GET /sse/v2`
  - Immediately emits a `stateUpdate` event.
  - Emits `stateUpdate` on every state change.
  - Emits `heartbeat` every 10 seconds.

### REST (admin only)

- `GET /api/v2/admin-mode/status` - Check admin auth status
- `POST /api/v2/admin-mode/enable` - Enable admin (password)
- `POST /api/v2/admin-mode/disable` - Disable admin
- `GET /api/v2/programs` - List programs
- `GET /api/v2/programs/{id}` - Get program
- `POST /api/v2/programs/{id}/load` - Load program
- `POST /api/v2/programs/start` - Start execution
- `POST /api/v2/programs/stop` - Pause execution
- `POST /api/v2/programs/reset` - Reset execution
- `POST /api/v2/programs/series/{idx}/skip_to` - Skip to series
- `POST /api/v2/targets/show` - Show targets
- `POST /api/v2/targets/hide` - Hide targets
- `POST /api/v2/targets/toggle` - Toggle targets
- `GET /api/v2/audios` - List audios
- `POST /api/v2/audios/{id}/play` - Play audio

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
- `tickerSeconds` is total seconds elapsed in the current series (0 to series total duration in seconds). `null` when not running.
- `currentEventIndex` is derived from `tickerSeconds` based on cumulative event durations.
- Program structure is fetched via `GET /api/v2/programs/{id}` when needed.

### `heartbeat`

Emitted every 10 seconds.

```typescript
interface HeartbeatPayload {
  id: number;
}
```

## Data Models

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
  events: Event[];
  optional?: boolean;
}

interface Event {
  duration: number; // milliseconds
  command: 'show' | 'hide';
  audioIds?: number[];
}
```

## State Change Rules

- All state mutations broadcast a `stateUpdate` to every connected client.
- `stop` pauses execution, keeps series/event position and `tickerSeconds` value.
- `start` resumes from current `tickerSeconds` if paused, otherwise starts from 0.
- `reset` resets execution state to the start of the current series and sets `tickerSeconds` to `null`.
- `skip_to` uses `idx` bounds validation; out-of-range returns `400` and no state change.
