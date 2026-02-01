import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';
import type { Program, ProgramSummary } from './types';

export function useProgramsApi() {
  const { adminToken, logoutAdmin } = useSettings();
  const client = createAuthenticatedClient(adminToken, logoutAdmin);

  return {
    list: () => client.request<ProgramSummary[]>('/programs'),
    get: (id: number) => client.request<Program>(`/programs/${id}`),
    load: (id: number) => client.request<void>(`/programs/${id}/load`, { method: 'POST' }),
    start: () => client.request<void>('/programs/start', { method: 'POST' }),
    stop: () => client.request<void>('/programs/stop', { method: 'POST' }),
    reset: () => client.request<void>('/programs/reset', { method: 'POST' }),
    skipToSeries: (index: number) => client.request<void>(`/programs/series/${index}/skip_to`, { method: 'POST' }),

    // Targets
    showTargets: () => client.request<void>('/targets/show', { method: 'POST' }),
    hideTargets: () => client.request<void>('/targets/hide', { method: 'POST' }),
    toggleTargets: () => client.request<void>('/targets/toggle', { method: 'POST' }),
  };
}

// Keep the old API for non-React contexts (should not be used in components)
import { client as directClient } from './client';
export const programsApi = {
  list: () => directClient<ProgramSummary[]>('/programs'),
  get: (id: number) => directClient<Program>(`/programs/${id}`),
  load: (id: number) => directClient<void>(`/programs/${id}/load`, { method: 'POST' }),
  start: () => directClient<void>('/programs/start', { method: 'POST' }),
  stop: () => directClient<void>('/programs/stop', { method: 'POST' }),
  reset: () => directClient<void>('/programs/reset', { method: 'POST' }),
  skipToSeries: (index: number) => directClient<void>(`/programs/series/${index}/skip_to`, { method: 'POST' }),

  // Targets
  showTargets: () => directClient<void>('/targets/show', { method: 'POST' }),
  hideTargets: () => directClient<void>('/targets/hide', { method: 'POST' }),
  toggleTargets: () => directClient<void>('/targets/toggle', { method: 'POST' }),
};
