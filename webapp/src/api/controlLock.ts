import { useClient, getApiBaseUrl } from './client';

export interface ControlLockStatusResponse {
  enabled: boolean;
}

export interface ControlLockEnableResponse {
  token: string;
}

export function useControlLockApi() {
  const { request } = useClient();

  return {
    fetchStatus: (): Promise<ControlLockStatusResponse> => {
      return request<ControlLockStatusResponse>('/control-lock/status');
    },

    enable: (password: string): Promise<ControlLockEnableResponse> => {
      return request<ControlLockEnableResponse>('/control-lock/enable', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
    },

    login: (password: string): Promise<ControlLockEnableResponse> => {
      return request<ControlLockEnableResponse>('/control-lock/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
    },

    disable: (): Promise<void> => {
      return request<void>('/control-lock/disable', {
        method: 'POST',
      });
    },
  };
}

export async function fetchControlLockStatus(): Promise<ControlLockStatusResponse> {
  const response = await fetch(`${getApiBaseUrl()}/control-lock/status`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch the control lock's state: ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : { enabled: false };
}

export async function enableControlLock(password: string): Promise<ControlLockEnableResponse> {
  const response = await fetch(`${getApiBaseUrl()}/control-lock/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to turn the control lock on: ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : { token: '' };
}

export async function loginControlLock(password: string): Promise<ControlLockEnableResponse> {
  const response = await fetch(`${getApiBaseUrl()}/control-lock/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to log in: ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : { token: '' };
}

export async function disableControlLock(token: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/control-lock/disable`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to turn the control lock off: ${response.statusText}`);
  }
}
