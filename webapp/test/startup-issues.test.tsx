// @vitest-environment happy-dom
// Same-origin with the mock, as the app runs for real — the firmware serves
// the bundle. See the note in useControlLockStatus.test.tsx.
// @vitest-environment-options { "url": "http://127.0.0.1:18085" }
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StartupIssue } from '../src/api/types';
import { SettingsProvider } from '../src/context/SettingsContext';
import { StartupIssuesSection } from '../src/components/StartupIssuesSection';
import { createFakeClock } from './mock-server/clock';
import { createMockServer, type MockServer } from './mock-server/server';

// Distinct per suite - vitest runs files in parallel, so a shared port is an
// EADDRINUSE flake (18080 useControlLockStatus, 18081 audios, 18082 programs,
// 18083 program-editor, 18084 run, 18085 here). Pick the next free number for
// a new suite.
const PORT = 18085;

/** What the boot scan reports for a program file it could not parse. */
function malformed(file: string): StartupIssue {
  return {
    code: 'program_invalid',
    message: 'Program file is malformed and was skipped',
    context: { file },
  };
}

let server: MockServer;
let queryClient: QueryClient;

/** A device that came up having hit `issues` during its boot scan. */
async function deviceReporting(issues: StartupIssue[]): Promise<void> {
  server = createMockServer({
    clock: createFakeClock(),
    port: PORT,
    seed: { programs: {}, audios: [], startupIssues: issues },
  });
  await server.listen();
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <StartupIssuesSection />
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

describe('D-25: boot-time issues, served rather than streamed', () => {
  it('says so plainly when the device came up clean', async () => {
    await deviceReporting([]);
    renderSection();

    expect(await screen.findByTestId('startup-issues-empty')).toBeTruthy();
    expect(screen.queryByTestId('startup-issue-0')).toBeNull();
    expect(screen.queryByTestId('startup-issues-truncated')).toBeNull();
  });

  it('names the program that vanished, with the code and the file', async () => {
    // The visible fix for "a program silently disappeared from the list": the
    // boot scan skipped it, and the SSE frame saying so reached nobody because
    // there was no server yet.
    await deviceReporting([malformed('/userdata/programs/103.json')]);
    renderSection();

    const issue = await screen.findByTestId('startup-issue-0');
    expect(within(issue).getByText('program_invalid')).toBeTruthy();
    expect(issue.textContent).toContain('Program file is malformed and was skipped');
    expect(issue.textContent).toContain('file: /userdata/programs/103.json');
    expect(screen.queryByTestId('startup-issues-empty')).toBeNull();
  });

  it('warns that a full list may be a truncated one', async () => {
    // The store is bounded at 8 with the oldest dropped, so exactly 8 cannot be
    // told apart from "there were more". The contract says so rather than
    // papering over it with a count field, and so does the page.
    await deviceReporting(
      Array.from({ length: 8 }, (_, index) => malformed(`/userdata/programs/${index}.json`)),
    );
    renderSection();

    await screen.findByTestId('startup-issue-7');
    expect(screen.getByTestId('startup-issues-truncated').textContent).toContain('may be incomplete');
  });

  it('does not warn about truncation when the list is short', async () => {
    await deviceReporting([malformed('/userdata/programs/7.json')]);
    renderSection();

    await screen.findByTestId('startup-issue-0');
    expect(screen.queryByTestId('startup-issues-truncated')).toBeNull();
  });

  it('re-reads on request, because the list only changes across a reboot', async () => {
    await deviceReporting([]);
    renderSection();
    await screen.findByTestId('startup-issues-empty');

    // Nothing pushes these (D-25), so asking again is the only way to see a
    // list from a device that has restarted since the page was opened.
    await server.close();
    await deviceReporting([malformed('/userdata/programs/103.json')]);

    fireEvent.click(screen.getByTestId('startup-issues-refresh'));
    await waitFor(() => expect(screen.getByTestId('startup-issue-0')).toBeTruthy());
  });

  it('reports a device it cannot reach instead of an empty all-clear', async () => {
    await deviceReporting([]);
    renderSection();
    await screen.findByTestId('startup-issues-empty');

    // The device goes away mid-session - a reboot, or a phone off the WiFi.
    // `afterEach` closing it again is a no-op.
    await server.close();

    fireEvent.click(screen.getByTestId('startup-issues-refresh'));
    await waitFor(() => expect(screen.getByTestId('startup-issues').textContent).toContain('Could not read'));
    expect(screen.queryByTestId('startup-issues-empty')).toBeNull();
  });
});
