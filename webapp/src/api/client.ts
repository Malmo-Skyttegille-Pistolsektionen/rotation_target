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

/**
 * A non-2xx response, carrying the status alongside the device's message.
 *
 * The status is load-bearing for the programs view: `PUT /programs/{id}` uses
 * `409` for two different refusals (shipped, and loaded) that need different
 * explanations, and neither is distinguishable from a transport failure by
 * message alone.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
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
    return text;
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

    throw new ApiError(response.status, await getResponseErrorMessage(response));
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
