// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { updateBaseUrl } from '../src/api/client';
import type { StateUpdatePayload } from '../src/api/types';
import { SettingsProvider, useSettings } from '../src/context/SettingsContext';
import { useSSE } from '../src/hooks/useSSE';
import { FakeEventSource } from './fake-event-source';

const RUNNING_STATE: StateUpdatePayload = {
  loadedProgramId: 40,
  programState: { running: true, currentSeriesIndex: 0, currentEventIndex: 3, tickerMs: 17480 },
  targetStatus: 'shown',
};

let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>{children}</SettingsProvider>
    </QueryClientProvider>
  );
}

/** Renders the hook and hands back the settings API, so a test can move the server URL. */
function renderSSE() {
  return renderHook(
    () => {
      const settings = useSettings();
      useSSE();
      return settings;
    },
    { wrapper },
  );
}

beforeEach(() => {
  FakeEventSource.reset();
  localStorage.clear();
  updateBaseUrl(window.location.origin);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('connection', () => {
  it('subscribes to the same-origin stream', () => {
    renderSSE();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest.url).toBe(`${window.location.origin}/sse/v2`);
  });

  it('closes the stream when the component unmounts', () => {
    const { unmount } = renderSSE();
    const source = FakeEventSource.latest;
    unmount();
    expect(source.closed).toBe(true);
  });

  it('reports connection status on open and on error', () => {
    renderSSE();
    act(() => FakeEventSource.latest.open());
    expect(queryClient.getQueryData(['sse-status'])).toBe('connected');

    act(() => FakeEventSource.latest.error());
    expect(queryClient.getQueryData(['sse-status'])).toBe('error');
  });

  it('reconnects five seconds after an error, having closed the dead stream', () => {
    vi.useFakeTimers();
    renderSSE();

    const first = FakeEventSource.latest;
    act(() => first.error());
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => vi.advanceTimersByTime(4999));
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.latest.closed).toBe(false);
  });
});

describe('following the configured server', () => {
  it('re-subscribes to the new host when the setting changes', () => {
    // The regression: the SSE URL was a module constant, so saving a server on
    // the settings page moved the REST calls and left the stream on localhost.
    const { result } = renderSSE();
    const first = FakeEventSource.latest;

    act(() => {
      result.current.setServerBaseUrl('http://10.0.0.9:8080');
      updateBaseUrl('http://10.0.0.9:8080');
    });

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.latest.url).toBe('http://10.0.0.9:8080/sse/v2');
  });
});

describe('frames', () => {
  it('publishes a stateUpdate payload to the query cache', () => {
    renderSSE();
    act(() => {
      FakeEventSource.latest.emit('stateUpdate', RUNNING_STATE);
    });
    expect(queryClient.getQueryData(['state'])).toEqual(RUNNING_STATE);
  });

  it('survives a malformed stateUpdate and keeps the last good one', () => {
    renderSSE();
    act(() => {
      FakeEventSource.latest.emit('stateUpdate', RUNNING_STATE);
    });
    act(() => {
      FakeEventSource.latest.emit('stateUpdate', '{not json');
    });
    expect(queryClient.getQueryData(['state'])).toEqual(RUNNING_STATE);
  });

  it('treats a heartbeat as proof the stream is alive', () => {
    renderSSE();
    act(() => FakeEventSource.latest.error());
    expect(queryClient.getQueryData(['sse-status'])).toBe('error');

    act(() => {
      FakeEventSource.latest.emit('heartbeat', { id: 3 });
    });
    expect(queryClient.getQueryData(['sse-status'])).toBe('connected');
  });

  it('delivers a backend_issue instead of dropping it, and keeps running', () => {
    // The firmware emits this; before the listener existed the frame reached
    // nothing at all. The toast UI is still a later task - this only asserts
    // the event is received and parked where that task can pick it up.
    renderSSE();

    const issue = {
      code: 'audio_playback_failed',
      message: 'Audio clip could not be opened',
      context: { clip: '/userdata/audio/103.wav' },
    };

    act(() => {
      expect(FakeEventSource.latest.emit('backend_issue', issue)).toBe(true);
    });
    expect(queryClient.getQueryData(['backend-issue'])).toEqual(issue);

    // An unknown code is a client's problem to tolerate, not the hook's.
    act(() => {
      FakeEventSource.latest.emit('backend_issue', { code: 'something_new_in_v3', message: 'Unheard of' });
    });
    expect(queryClient.getQueryData(['backend-issue'])).toMatchObject({ code: 'something_new_in_v3' });

    // And the stream still works afterwards.
    act(() => {
      FakeEventSource.latest.emit('stateUpdate', RUNNING_STATE);
    });
    expect(queryClient.getQueryData(['state'])).toEqual(RUNNING_STATE);
  });

  it('refetches the library the device says changed, and only that one', () => {
    // #74: the list is fetched over REST and published nowhere, so before this
    // event a client only learned about its own uploads. `kind` is what keeps
    // an audio upload from making every client refetch the program list too.
    renderSSE();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => {
      expect(FakeEventSource.latest.emit('libraryChanged', { kind: 'audio' })).toBe(true);
    });
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['audios']]);

    invalidate.mockClear();
    act(() => {
      FakeEventSource.latest.emit('libraryChanged', { kind: 'program' });
    });
    // The list, and the documents the run view and the editor hold with
    // `staleTime: Infinity` - both the program library, nothing audio.
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['programs'], ['program']]);
  });

  it('ignores a kind it does not know rather than refetching everything', () => {
    // A closed enum this app does not know a member of means a newer contract.
    renderSSE();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => {
      FakeEventSource.latest.emit('libraryChanged', { kind: 'targetBank' });
    });
    expect(invalidate).not.toHaveBeenCalled();

    // And a malformed frame does not take the stream down with it.
    act(() => {
      FakeEventSource.latest.emit('libraryChanged', '{not json');
      FakeEventSource.latest.emit('stateUpdate', RUNNING_STATE);
    });
    expect(queryClient.getQueryData(['state'])).toEqual(RUNNING_STATE);
  });

  it('refetches nothing when the device only changes what it is doing', () => {
    // Run state is not library state (D-24): load, start, stop, reset, skip_to
    // and unload arrive as stateUpdate and touch no cached list.
    renderSSE();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => {
      FakeEventSource.latest.emit('stateUpdate', RUNNING_STATE);
      FakeEventSource.latest.emit('stateUpdate', { ...RUNNING_STATE, loadedProgramId: null, programState: null });
      FakeEventSource.latest.emit('heartbeat', { id: 1 });
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('ignores an event type it has no listener for', () => {
    renderSSE();
    act(() => {
      expect(FakeEventSource.latest.emit('somethingElse', { a: 1 })).toBe(false);
    });
    expect(queryClient.getQueryData(['state'])).toBeUndefined();
    expect(FakeEventSource.latest.closed).toBe(false);
  });
});
