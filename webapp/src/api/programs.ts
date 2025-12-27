import { client } from './client';
import type { Program, ProgramSummary } from './types';

export const programsApi = {
  list: () => client<ProgramSummary[]>('/programs'),
  get: (id: number) => client<Program>(`/programs/${id}`),
  load: (id: number) => client<void>(`/programs/${id}/load`, { method: 'POST' }),
  start: () => client<void>('/programs/start', { method: 'POST' }),
  stop: () => client<void>('/programs/stop', { method: 'POST' }),
  reset: () => client<void>('/programs/reset', { method: 'POST' }),
  skipToSeries: (index: number) => client<void>(`/programs/series/${index}/skip_to`, { method: 'POST' }),

  // Targets
  showTargets: () => client<void>('/targets/show', { method: 'POST' }),
  hideTargets: () => client<void>('/targets/hide', { method: 'POST' }),
  toggleTargets: () => client<void>('/targets/toggle', { method: 'POST' }),
};
