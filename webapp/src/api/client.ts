import { useSettings } from '../context/SettingsContext';

import { DEFAULT_BASE_URL, normalizeBaseUrl } from './base-url';
import type { Problem, ProblemType } from './types';

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
 * A non-2xx response.
 *
 * `problem` is the device's RFC 9457 problem detail (D-19) when the body was
 * one, and `null` when it was not — a transport failure, an intermediary, or
 * the one endpoint that answers `text/html` (a body over the 1 MiB ceiling,
 * refused above every handler). Branch on `problem.type`; `message` is
 * `problem.detail` and is for display only.
 *
 * `status` is kept alongside it because it is the only thing left to go on
 * when `problem` is null.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | null;

  constructor(status: number, message: string, problem: Problem | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

/**
 * The problem type this error carries, or `null` for a body that was not a
 * problem detail. Narrowed to `ProblemType` so a comparison against a slug the
 * contract does not define fails to compile.
 */
export function problemType(err: unknown): ProblemType | null {
  if (!(err instanceof ApiError) || err.problem === null) {
    return null;
  }
  // The cast is the widening in `Problem['type']` being taken back: an
  // unrecognised type simply matches none of the callers' comparisons.
  return err.problem.type as ProblemType;
}

/**
 * A parsed body, if it is a problem detail. Every member is required, and a
 * body missing one is not treated as a problem at all rather than half-read —
 * the caller's fallback is better than a `detail` of `undefined`.
 */
function asProblem(payload: unknown): Problem | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate.type !== 'string' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.status !== 'number' ||
    typeof candidate.detail !== 'string'
  ) {
    return null;
  }
  return {
    type: candidate.type,
    title: candidate.title,
    status: candidate.status,
    detail: candidate.detail,
  };
}

async function getResponseError(response: Response): Promise<{ message: string; problem: Problem | null }> {
  const text = await response.text();
  const fallbackMessage = response.statusText ? `API Error: ${response.statusText}` : `API Error: ${response.status}`;

  if (!text) {
    return { message: fallbackMessage, problem: null };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    // Not JSON at all — the `text/html` oversize refusal lands here, and its
    // sentence is the most useful thing there is to show.
    return { message: text, problem: null };
  }

  // Parsed by shape, not by `Content-Type`: an intermediary that rewrites the
  // header should not cost the client the discriminator.
  const problem = asProblem(payload);
  if (problem !== null) {
    return { message: problem.detail || fallbackMessage, problem };
  }

  // A JSON body that is not a problem detail. Nothing in this API produces one
  // for a failure, so this is a proxy or a captive portal rather than the
  // device; `message` is still worth surfacing if it carries one.
  const message =
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string' &&
    payload.message.length > 0
      ? payload.message
      : fallbackMessage;
  return { message, problem: null };
}

/**
 * A response with a file in it: the troubleshooting bundle (#201) is the only
 * one, and it is bytes rather than JSON.
 *
 * `filename` is what the device asked for in `Content-Disposition`. Null when
 * the header is absent or unparseable, which is a caller's cue to name the
 * download itself rather than to treat the response as broken.
 */
export interface DownloadedFile {
  blob: Blob;
  filename: string | null;
}

/**
 * The `filename="..."` of a `Content-Disposition`, if there is one.
 *
 * Deliberately only the quoted form: it is the only one the device emits, and
 * the rest of RFC 6266 — `filename*`, percent-encoding, continuations — is a
 * parser this app has no second producer to need.
 */
function filenameFrom(disposition: string | null): string | null {
  const match = disposition === null ? null : /filename="([^"]+)"/.exec(disposition);
  return match ? match[1] : null;
}

async function send(
  endpoint: string,
  options?: RequestInit,
  adminToken?: string | null,
  onAuthError?: () => void,
): Promise<Response> {
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

    const { message, problem } = await getResponseError(response);
    throw new ApiError(response.status, message, problem);
  }

  return response;
}

async function request<T>(
  endpoint: string,
  options?: RequestInit,
  adminToken?: string | null,
  onAuthError?: () => void,
): Promise<T> {
  const response = await send(endpoint, options, adminToken, onAuthError);
  const text = await response.text();
  return text ? JSON.parse(text) : ({} as T);
}

async function requestFile(
  endpoint: string,
  options?: RequestInit,
  adminToken?: string | null,
  onAuthError?: () => void,
): Promise<DownloadedFile> {
  const response = await send(endpoint, options, adminToken, onAuthError);
  return {
    blob: await response.blob(),
    filename: filenameFrom(response.headers.get('Content-Disposition')),
  };
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
    requestFile: async (endpoint: string, options?: RequestInit): Promise<DownloadedFile> => {
      return requestFile(endpoint, options, adminToken, onAuthError);
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
