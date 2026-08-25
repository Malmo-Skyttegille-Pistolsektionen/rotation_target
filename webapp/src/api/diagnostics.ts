import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient, type DownloadedFile } from './client';
import type { DiagnosticsInfo } from './types';

/**
 * `GET /diagnostics/info` is public — it carries the firmware's own identity
 * and health and no program data. Routed through the authenticated client
 * anyway, so a browser that *is* signed in keeps sending its token and the
 * 401-logout path stays in one place.
 *
 * `GET /diagnostics/bundle` is the opposite (#201): it carries a RAM snapshot
 * that can hold the WiFi password, so it needs admin credentials *and* the
 * configuration window — three presses of the device's BOOT button. Refusals
 * arrive as problem details like any other; the caller shows the device's
 * sentence.
 */
export function useDiagnosticsApi() {
  const { adminToken, logoutAdmin } = useSettings();
  const client = createAuthenticatedClient(adminToken, logoutAdmin);

  return {
    info: () => client.request<DiagnosticsInfo>('/diagnostics/info'),
    bundle: (): Promise<DownloadedFile> => client.requestFile('/diagnostics/bundle'),
  };
}
