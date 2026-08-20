// V2 SSE event types
export const SSETypes = {
  StateUpdate: 'stateUpdate',
  Heartbeat: 'heartbeat',
} as const;

export interface HeartbeatPayload {
  id: number;
}

export interface ProgramSummary {
  id: number;
  title: string;
  description: string;
  readonly: boolean;
}

export interface Program extends ProgramSummary {
  series: Series[];
}

export interface Series {
  name: string;
  events: Event[];
  optional?: boolean;
}

export interface Event {
  duration: number;
  command: 'show' | 'hide';
  audioIds?: number[];
}

export interface AudioFile {
  id: number;
  title: string;
  readonly: boolean;
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
