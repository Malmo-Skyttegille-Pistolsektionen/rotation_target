# System Architecture

## Overview

Rotation Target is a system for controlling rotation targets at a shooting club. The system consists of:

1. **ESP32 Backend** - Hardware controller with REST API + SSE
2. **Frontend SPA** - React app for tablets/mobile devices
3. **Mock Server** - Development server simulating ESP32 behavior

```
┌─────────────────────────────────────────────────────────────────┐
│                        ESP32 BACKEND                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    STATE (source of truth)              │    │
│  │  - loadedProgram (id, series, events)                   │    │
│  │  - programState (running, seriesIdx, eventIdx, ticker)  │    │
│  │  - targetStatus (shown/hidden)                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                            │                                    │
│         ┌──────────────────┼──────────────────┐                 │
│         ▼                  ▼                  ▼                 │
│  ┌────────────┐    ┌────────────┐     ┌────────────┐            │
│  │  REST API  │    │  REST API  │     │    SSE     │            │
│  │  /api/v2/* │    │  /api/v2/* │     │  /sse/v2   │            │
│  │  (POST)    │    │  (GET)     │     │  (stream)  │            │
│  │ mutations  │    │ large data │     │ live state │            │
│  └────────────┘    └────────────┘     └────────────┘            │
└─────────────────────────────────────────────────────────────────┘
        ▲                  │                   │
        │ POST             │ GET               │ stateUpdate event
        │                  │ programs,         │
        │                  │ program/{id}      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React SPA)                       │
│                                                                 │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│   │   useSSE     │───►│ TanStack     │◄───│  Components  │      │
│   │   hook       │    │   Query      │    │  (useQuery)  │      │
│   └──────────────┘    │   Cache      │    └──────────────┘      │
│                       └──────────────┘           │              │
│                          ▲       ▲               │              │
│                          │       │               │              │
│                   ┌──────┘       └──────┐        │              │
│            ┌───────────────┐   ┌─────────────────┐              │
│            │  Mutations    │   │  REST Queries   │              │
│            │  (useMutation)│   │  (useQuery+GET) │              │
│            └───────────────┘   └─────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### SSE → Components

```
1. SSE connection established to /sse/v2
2. Server sends stateUpdate event (on connect + every state change)
3. useSSE hook receives event
4. Hook calls queryClient.setQueryData(['state'], data)
5. Components using useQuery(['state']) re-render
```

### Program Loading

SSE sends only `loadedProgramId`, not the full program structure. Client fetches program data via REST when needed:

```
1. User selects program from dropdown
2. Mutation sends POST /api/v2/programs/{id}/load
3. Server loads program internally, broadcasts stateUpdate with loadedProgramId
4. SSE updates ['state'] with new loadedProgramId
5. Component detects loadedProgramId changed
6. useQuery(['program', id]) fetches GET /api/v2/programs/{id}
7. Program structure cached with staleTime: Infinity (never refetched during run)
8. Timeline and series selector render from cached program data
```

This design minimizes SSE payload size (~80 bytes vs ~2KB) since program structure is static during execution.

### User Action → Server

```
1. User clicks button (e.g., Start)
2. Component calls mutation (e.g., startMutation.mutate())
3. Mutation sends POST to /api/v2/programs/start
4. Server updates state
5. Server broadcasts stateUpdate to all SSE clients
6. All connected clients update via SSE flow above
```

## Key Design Decisions

| Decision                                             | Rationale                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| SSE for live state, REST for mutations + large reads | Real-time updates without polling; REST for large/static data       |
| Server as source of truth                            | No client-side state logic; all clients stay in sync                |
| TanStack Query as cache                              | SSE updates cache directly; components read from cache              |
| A lock on writing, held by one operator               | Prevent accidental/unauthorized changes                             |
| SSE sends ID only, REST for structure                | Minimizes bandwidth; program structure is static during run         |
| REST for large data                                  | Data too large for SSE (programs, lists) fetched via REST on demand |

## State Management

| State Type        | Solution                      | Example                      |
| ----------------- | ----------------------------- | ---------------------------- |
| Server state      | TanStack Query (SSE-fed)      | Program state, target status |
| Program structure | TanStack Query (REST, cached) | Loaded program series/events |
| Program list      | TanStack Query (REST)         | Available programs           |
| URL state         | TanStack Router               | Current route, search params |
| Local UI state    | useState                      | Timeline mode toggle         |

## Mock Server

For development, `vite-plugins/mock-server-v2.ts` simulates the ESP32 backend:

- Loads programs from `test/data/programs/`
- Simulates program execution with 1-second ticks
- Broadcasts SSE updates to all connected clients
- Implements same REST API as production

**Important:** Keep mock server behavior in sync with `docs/server-spec.md`.

## Authentication

The control lock is required for all mutations:

1. First API call returns 401
2. `client.ts` automatically calls `/control-lock/enable` with password
3. Token stored as cookie
4. Subsequent requests include token
5. Token not persisted across page reloads

## File Reference

| File                             | Purpose                              |
| -------------------------------- | ------------------------------------ |
| `src/api/client.ts`              | Fetch wrapper carrying the control lock token |
| `src/api/programs.ts`            | Program API functions                |
| `src/api/types.ts`               | TypeScript types for API             |
| `src/hooks/useSSE.ts`            | SSE connection and cache updates     |
| `vite-plugins/mock-server-v2.ts` | Development mock server              |
| `docs/server-spec.md`            | API specification                    |
