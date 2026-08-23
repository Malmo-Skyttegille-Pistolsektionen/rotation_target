// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useAdminStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18088" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsProvider } from '../src/context/SettingsContext';
import { ServerUrlSection } from '../src/components/ServerUrlSection';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake. Pick the next free number for a new suite.
const PORT = 18088;

let server: MockServer;
let queryClient: QueryClient;

async function deviceAt(ipAddress?: string): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: {}, audios: [], ipAddress },
  });
  await server.listen();
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <ServerUrlSection />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  await server.close();
});

// The address used to have a section of its own. It now sits in the Server
// Base URL heading (it is a fact about the device, not a setting), but what it
// has to say is unchanged - hence the same assertions against the section that
// absorbed it.
describe('the device address on Settings', () => {
  it('shows the address the device reports', async () => {
    // Not the URL the browser used: at the range those differed, and the
    // device's own answer is the one worth reading out to someone else.
    await deviceAt('192.168.50.14');
    renderSection();

    expect((await screen.findByTestId('network-address')).textContent).toBe('192.168.50.14');
  });

  it('says the device has no address rather than showing an empty line', async () => {
    // The firmware sends an empty string when it has none - on the setup
    // portal, or after the link dropped. Blank would read as "still loading".
    await deviceAt('');
    renderSection();

    expect(await screen.findByTestId('network-address-missing')).toBeTruthy();
    expect(screen.queryByTestId('network-address')).toBeNull();
  });
});
