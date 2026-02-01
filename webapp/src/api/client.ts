import { useSettings } from '../context/SettingsContext';

const DEFAULT_BASE_URL = 'http://localhost:8080';

let dynamicBaseUrl = DEFAULT_BASE_URL;

export function getApiBaseUrl(): string {
  return `${dynamicBaseUrl}/api/v2`;
}

export function getSseBaseUrl(): string {
  return `${dynamicBaseUrl}/sse/v2`;
}

export function updateBaseUrl(url: string): void {
  dynamicBaseUrl = url;
}

export function initializeBaseUrl(url: string): void {
  dynamicBaseUrl = url;
}

async function request<T>(
  endpoint: string,
  options?: RequestInit,
  adminToken?: string | null,
  onAuthError?: () => void,
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
    // If 401 and we have a token, the token is invalid (password changed)
    if (response.status === 401 && adminToken && onAuthError) {
      onAuthError();
    }
    throw new Error(`API Error: ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : ({} as T);
}

// For use outside of React components (no auth error handling)
export async function client<T>(endpoint: string, options?: RequestInit): Promise<T> {
  return request<T>(endpoint, options, undefined, undefined);
}

// For use inside React components with proper auth error handling
export function createAuthenticatedClient(adminToken: string | null, onAuthError: () => void) {
  return {
    request: async <T>(endpoint: string, options?: RequestInit): Promise<T> => {
      return request<T>(endpoint, options, adminToken, onAuthError);
    },
  };
}

export function useClient() {
  const { adminToken, logoutAdmin } = useSettings();

  return {
    request: async <T>(endpoint: string, options?: RequestInit): Promise<T> => {
      return request<T>(endpoint, options, adminToken, logoutAdmin);
    },
  };
}
