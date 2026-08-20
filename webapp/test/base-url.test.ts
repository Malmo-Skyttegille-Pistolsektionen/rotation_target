// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The hardcoded-localhost bug class. `http://localhost:8080` was baked into
 * the client, so an app served *by the device* asked the browser itself for
 * `/api/v2` and every call failed. These lock the replacement in.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function importBaseUrl(): Promise<typeof import('../src/api/base-url')> {
  vi.resetModules();
  return import('../src/api/base-url');
}

async function importClient(): Promise<typeof import('../src/api/client')> {
  vi.resetModules();
  return import('../src/api/client');
}

describe('DEFAULT_BASE_URL', () => {
  it('defaults to the origin the app was served from', async () => {
    // Served by the firmware on the range network.
    vi.stubGlobal('window', { location: { origin: 'http://rotation-target.local' } });
    expect((await importBaseUrl()).DEFAULT_BASE_URL).toBe('http://rotation-target.local');
  });

  it('follows a non-default port, rather than assuming 8080', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://192.168.4.1:8081' } });
    expect((await importBaseUrl()).DEFAULT_BASE_URL).toBe('http://192.168.4.1:8081');
  });

  it('falls back to localhost:8080 only when there is no window at all', async () => {
    vi.stubGlobal('window', undefined);
    expect((await importBaseUrl()).DEFAULT_BASE_URL).toBe('http://localhost:8080');
  });
});

describe('normalizeBaseUrl', () => {
  it('strips trailing slashes so the API path concatenates cleanly', async () => {
    const { normalizeBaseUrl } = await importBaseUrl();
    expect(normalizeBaseUrl('http://rotation-target.local/')).toBe('http://rotation-target.local');
    expect(normalizeBaseUrl('http://rotation-target.local///')).toBe('http://rotation-target.local');
  });

  it('leaves a clean URL and a path prefix alone', async () => {
    const { normalizeBaseUrl } = await importBaseUrl();
    expect(normalizeBaseUrl('http://192.168.4.1:8080')).toBe('http://192.168.4.1:8080');
    expect(normalizeBaseUrl('http://proxy.local/target')).toBe('http://proxy.local/target');
  });
});

describe('the client base URL', () => {
  it('starts same-origin', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://rotation-target.local' } });
    const { getApiBaseUrl, getSseBaseUrl } = await importClient();

    expect(getApiBaseUrl()).toBe('http://rotation-target.local/api/v2');
    expect(getSseBaseUrl()).toBe('http://rotation-target.local/sse/v2');
  });

  it('takes an explicit override, and REST and SSE move together', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://rotation-target.local' } });
    const { updateBaseUrl, getApiBaseUrl, getSseBaseUrl } = await importClient();

    // The settings page saving a URL used to move only the REST calls; the SSE
    // URL was a module constant pointing at localhost.
    updateBaseUrl('http://10.0.0.9:8080');
    expect(getApiBaseUrl()).toBe('http://10.0.0.9:8080/api/v2');
    expect(getSseBaseUrl()).toBe('http://10.0.0.9:8080/sse/v2');
  });

  it('never emits a double slash from a pasted trailing slash', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://rotation-target.local' } });
    const { updateBaseUrl, getApiBaseUrl, getSseBaseUrl } = await importClient();

    updateBaseUrl('http://10.0.0.9:8080/');
    expect(getApiBaseUrl()).toBe('http://10.0.0.9:8080/api/v2');
    expect(getSseBaseUrl()).toBe('http://10.0.0.9:8080/sse/v2');
  });
});
