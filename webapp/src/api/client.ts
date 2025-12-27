// Using localhost:8080 as default for dev
const BASE_URL = 'http://localhost:8080/api/v2';
const ADMIN_PASSWORD = 'admin';

let adminEnabled = false;
let adminEnabling: Promise<void> | null = null;

async function enableAdminMode(): Promise<void> {
  if (adminEnabled) return;
  if (!adminEnabling) {
    adminEnabling = fetch(`${BASE_URL}/admin-mode/enable`, {
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

async function request<T>(endpoint: string, options?: RequestInit, hasRetried = false): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401 && !hasRetried && !endpoint.startsWith('/admin-mode')) {
      adminEnabled = false;
      await enableAdminMode();
      return request<T>(endpoint, options, true);
    }
    throw new Error(`API Error: ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : ({} as T);
}

export async function client<T>(endpoint: string, options?: RequestInit): Promise<T> {
  return request<T>(endpoint, options);
}
