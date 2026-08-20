import { useSettings } from '../context/SettingsContext';

import { DEFAULT_BASE_URL, normalizeBaseUrl } from './base-url';

let dynamicBaseUrl = normalizeBaseUrl(DEFAULT_BASE_URL);

export function getApiBaseUrl(): string {
  return `${dynamicBaseUrl}/api/v2`;
}

export function getSseBaseUrl(): string {
  return `${dynamicBaseUrl}/sse/v2`;
}

export function updateBaseUrl(url: string): void {
  dynamicBaseUrl = normalizeBaseUrl(url);
}

export function initializeBaseUrl(url: string): void {
  dynamicBaseUrl = normalizeBaseUrl(url);
}

function getErrorMessageFromPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  if ('error' in payload && typeof payload.error === 'string' && payload.error.length > 0) {
    return payload.error;
  }

  if ('message' in payload && typeof payload.message === 'string' && payload.message.length > 0) {
    return payload.message;
  }

  return null;
}

async function getResponseErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  const fallbackMessage = response.statusText ? `API Error: ${response.statusText}` : `API Error: ${response.status}`;

  if (!text) {
    return fallbackMessage;
  }

  try {
    const payload: unknown = JSON.parse(text);
    return getErrorMessageFromPayload(payload) ?? fallbackMessage;
  } catch {
    // A body over the 1 MiB cap is refused by the HTTP layer with an HTML
    // page rather than the JSON error shape (contract, "Limits") - rendering
    // that markup as the error message is worse than the status line.
    return text.trimStart().startsWith('<') ? fallbackMessage : text;
  }
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

    throw new Error(await getResponseErrorMessage(response));
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
