import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';
import type { DiagnosticsInfo } from './types';

/**
 * `GET /diagnostics/info` is public — it carries the firmware's own identity
 * and health and no program data. Routed through the authenticated client
 * anyway, so a browser that *is* signed in keeps sending its token and the
 * 401-logout path stays in one place.
 */
export function useDiagnosticsApi() {
  const { adminToken, logoutAdmin } = useSettings();
  const client = createAuthenticatedClient(adminToken, logoutAdmin);

  return {
    info: () => client.request<DiagnosticsInfo>('/diagnostics/info'),
  };
}
