import { useClient, getApiBaseUrl } from './client';

export interface AdminStatusResponse {
  enabled: boolean;
}

export interface AdminEnableResponse {
  token: string;
}

export function useAdminApi() {
  const { request } = useClient();

  return {
    fetchStatus: (): Promise<AdminStatusResponse> => {
      return request<AdminStatusResponse>('/admin-mode/status');
    },

    enable: (password: string): Promise<AdminEnableResponse> => {
      return request<AdminEnableResponse>('/admin-mode/enable', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
    },

    login: (password: string): Promise<AdminEnableResponse> => {
      return request<AdminEnableResponse>('/admin-mode/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
    },

    disable: (): Promise<void> => {
      return request<void>('/admin-mode/disable', {
        method: 'POST',
      });
    },
  };
}

export async function fetchAdminStatus(): Promise<AdminStatusResponse> {
  const response = await fetch(`${getApiBaseUrl()}/admin-mode/status`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch admin status: ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : { enabled: false };
}

export async function enableAdmin(password: string): Promise<AdminEnableResponse> {
  const response = await fetch(`${getApiBaseUrl()}/admin-mode/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to enable admin mode: ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : { token: '' };
}

export async function loginAdmin(password: string): Promise<AdminEnableResponse> {
  const response = await fetch(`${getApiBaseUrl()}/admin-mode/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to login admin mode: ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : { token: '' };
}

export async function disableAdmin(token: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/admin-mode/disable`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to disable admin mode: ${response.statusText}`);
  }
}
