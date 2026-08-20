// REST shapes come from the canonical contract: `contracts/openapi.yaml`,
// generated into `./generated.d.ts` by `npm run generate:api` (committed,
// with a CI drift check — see webapp/README.md). Re-exported by name here so
// call sites don't reach into `components['schemas'][...]` directly, and so
// a shape this app doesn't actually consume the way the spec defines it
// becomes a visible type alias rather than a silent divergence.
import type { components } from './generated';

export type ProgramSummary = components['schemas']['ProgramSummary'];
export type Program = components['schemas']['Program'];
export type Series = components['schemas']['Series'];
export type Event = components['schemas']['Event'];
export type AudioFile = components['schemas']['Audio'];

// SSE shapes are specified in `contracts/asyncapi.yaml`, which
// openapi-typescript does not read (it only generates from `openapi.yaml`).
// Hand-written and kept in lock-step with the AsyncAPI document's
// `StateUpdate`, `ProgramState` and `Heartbeat` schemas.
export const SSETypes = {
  StateUpdate: 'stateUpdate',
  Heartbeat: 'heartbeat',
} as const;

export interface HeartbeatPayload {
  id: number;
}

export interface ProgramState {
  running: boolean;
  currentSeriesIndex: number | null;
  currentEventIndex: number | null;
  tickerSeconds: number | null;
}

export interface StateUpdatePayload {
  loadedProgramId: number | null;
  programState: ProgramState | null;
  targetStatus: 'shown' | 'hidden';
}
