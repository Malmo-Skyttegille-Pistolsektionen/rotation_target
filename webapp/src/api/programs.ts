import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';
import type { CreatedId, Program, ProgramSummary, ProgramUpdate } from './types';

/**
 * The `PUT` body: the document with no `id` at all. The path is the authority
 * (D-15), so sending one can only mismatch — never rename.
 */
function withoutId({ title, description, readonly, series }: Program): ProgramUpdate {
  return { title, description, readonly, series };
}

export function useProgramsApi() {
  const { adminToken, logoutAdmin } = useSettings();
  const client = createAuthenticatedClient(adminToken, logoutAdmin);

  return {
    list: () => client.request<ProgramSummary[]>('/programs'),
    get: (id: number) => client.request<Program>(`/programs/${id}`),
    load: (id: number) => client.request<void>(`/programs/${id}/load`, { method: 'POST' }),
    // 200 whether something was unloaded or nothing was loaded to begin with;
    // 409 while a run is in progress (D-22). Idempotent, so a retry after a
    // dropped response is safe.
    unload: () => client.request<void>('/programs/unload', { method: 'POST' }),
    // The device assigns the id and ignores the one in the document, so the
    // caller learns it from the response rather than from what it sent.
    create: (program: Program) =>
      client.request<CreatedId>('/programs', { method: 'POST', body: JSON.stringify(program) }),
    update: (id: number, program: Program) =>
      client.request<Program>(`/programs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(withoutId(program)),
      }),
    remove: (id: number) => client.request<void>(`/programs/${id}/delete`, { method: 'DELETE' }),
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
  unload: () => directClient<void>('/programs/unload', { method: 'POST' }),
  create: (program: Program) => directClient<CreatedId>('/programs', { method: 'POST', body: JSON.stringify(program) }),
  update: (id: number, program: Program) =>
    directClient<Program>(`/programs/${id}`, { method: 'PUT', body: JSON.stringify(withoutId(program)) }),
  remove: (id: number) => directClient<void>(`/programs/${id}/delete`, { method: 'DELETE' }),
  start: () => directClient<void>('/programs/start', { method: 'POST' }),
  stop: () => directClient<void>('/programs/stop', { method: 'POST' }),
  reset: () => directClient<void>('/programs/reset', { method: 'POST' }),
  skipToSeries: (index: number) => directClient<void>(`/programs/series/${index}/skip_to`, { method: 'POST' }),

  // Targets
  showTargets: () => directClient<void>('/targets/show', { method: 'POST' }),
  hideTargets: () => directClient<void>('/targets/hide', { method: 'POST' }),
  toggleTargets: () => directClient<void>('/targets/toggle', { method: 'POST' }),
};
