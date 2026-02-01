import { useSettings } from '../context/SettingsContext';

const DEFAULT_BASE_URL = 'http://localhost:8080';
const ADMIN_PASSWORD = 'admin';

let dynamicBaseUrl = DEFAULT_BASE_URL;
let adminEnabled = false;
let adminEnabling: Promise<void> | null = null;

export function getApiBaseUrl(): string {
  return `${dynamicBaseUrl}/api/v2`;
}

export function getSseBaseUrl(): string {
  return `${dynamicBaseUrl}/sse/v2`;
}

export function updateBaseUrl(url: string): void {
  dynamicBaseUrl = url;
  adminEnabled = false;
  adminEnabling = null;
}

export function initializeBaseUrl(url: string): void {
  dynamicBaseUrl = url;
}

async function enableAdminMode(): Promise<void> {
  if (adminEnabled) return;
  if (!adminEnabling) {
    adminEnabling = fetch(`${getApiBaseUrl()}/admin-mode/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
      credentials: 'include',
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`Admin enable failed: ${response.statusText}`);
      }
      adminEnabled = true;
    });
  }
  await adminEnabling;
}

async function request<T>(
  endpoint: string,
  options?: RequestInit,
  hasRetried = false,
  adminToken?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {};

  if (adminToken) {
    headers['Authorization'] = `Bearer ${adminToken}`;
  }

  if (options?.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...headers,
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401 && !hasRetried && !endpoint.startsWith('/admin-mode')) {
      adminEnabled = false;
      await enableAdminMode();
      return request<T>(endpoint, options, true, adminToken);
    }
    throw new Error(`API Error: ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : ({} as T);
}

export async function client<T>(endpoint: string, options?: RequestInit): Promise<T> {
  return request<T>(endpoint, options);
}

export function useClient() {
  const { adminToken } = useSettings();

  return {
    request: async <T>(endpoint: string, options?: RequestInit): Promise<T> => {
      return request<T>(endpoint, options, false, adminToken);
    },
  };
}
