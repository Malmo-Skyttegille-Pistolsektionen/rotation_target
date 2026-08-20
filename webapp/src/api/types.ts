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
// Hand-written, and kept in lock-step with that document's `StateUpdate`,
// `ProgramState`, `Heartbeat` and `BackendIssue` schemas by hand — nothing
// checks it, so adding a message there means editing here.
export const SSETypes = {
  StateUpdate: 'stateUpdate',
  Heartbeat: 'heartbeat',
  BackendIssue: 'backend_issue',
} as const;

export interface HeartbeatPayload {
  id: number;
}

/**
 * A failure the device noticed on its own — a clip that will not play, a
 * program file that will not parse. Advisory: run state is unaffected.
 *
 * `code` is an OPEN enum. Later firmware may report a failure this app has
 * never heard of, so switch on the codes you know and show `message` for the
 * rest. `context` keys differ per code.
 */
export interface BackendIssuePayload {
  code: 'audio_playback_failed' | 'program_invalid' | (string & {});
  message: string;
  context?: Record<string, string>;
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
