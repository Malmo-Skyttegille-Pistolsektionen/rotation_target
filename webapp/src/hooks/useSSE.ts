/* eslint-disable @eslint-react/web-api-no-leaked-event-listener --
   The listeners hang off an EventSource the cleanup closes and drops, which
   detaches them; there is no long-lived target to leak from. */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SSETypes } from '../api/types';
import type {
  BackendIssuePayload,
  ConfigWindowPayload,
  HardwareConfigState,
  LibraryChangedPayload,
  StateUpdatePayload,
} from '../api/types';
import { getSseBaseUrl } from '../api/client';
import { useSettings } from '../context/SettingsContext';

/**
 * Which cached queries a `libraryChanged` invalidates, by `kind`. The payload
 * carries the kind precisely so an audio upload does not make every client
 * refetch the program list as well, and the other way round (D-24) — on a
 * device with one HTTP task and 77 shipped clips that is not free.
 *
 * `program` invalidates the list and the individual documents: `['program', id]`
 * is fetched with `staleTime: Infinity` by the run view and the editor, so a
 * replace made from another browser would otherwise never be picked up. Both
 * keys are the program library; nothing audio is touched.
 */
const LIBRARY_QUERY_KEYS: Record<LibraryChangedPayload['kind'], string[][]> = {
  program: [['programs'], ['program']],
  audio: [['audios']],
};

export function useSSE(): void {
  const queryClient = useQueryClient();
  // The settings page writes this; the effect below re-subscribes when it
  // changes. Previously the SSE URL was a module constant, so it ignored the
  // configured server entirely and always pointed at localhost:8080 - the REST
  // calls followed the setting and the event stream did not.
  //
  // That mattered more in v2 than it would have in v1: v2 removed GET /status,
  // so stateUpdate is the only channel run state arrives on. A stream pointed
  // at the wrong host leaves the UI connected-looking but permanently frozen.
  const { settings } = useSettings();

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const sseUrl = getSseBaseUrl();

    const connect = (): void => {
      console.log('[SSE] Connecting to', sseUrl);
      eventSource = new EventSource(sseUrl);

      eventSource.onopen = (): void => {
        console.log('[SSE] Connected');
        queryClient.setQueryData(['sse-status'], 'connected');
        // Anything that changed while the stream was down was published to
        // nobody: this channel carries change notifications and sends no
        // snapshot on connect. For run state the next event is seconds away,
        // but the configuration window can sit unchanged for five minutes -
        // so a press made during a reconnect would leave the tab missing until
        // somebody reloaded the page.
        void queryClient.invalidateQueries({ queryKey: ['hardware-config'] });
      };

      eventSource.onerror = (err): void => {
        console.error('[SSE] Error:', err);
        queryClient.setQueryData(['sse-status'], 'error');
        eventSource?.close();
        reconnectTimer = setTimeout(connect, 5000);
      };

      eventSource.addEventListener(SSETypes.StateUpdate, (event) => {
        try {
          const data = JSON.parse(event.data) as StateUpdatePayload;
          console.log('[SSE] data', data);
          queryClient.setQueryData(['state'], data);
        } catch (error) {
          console.error('[SSE] Failed to parse stateUpdate', error);
        }
      });

      eventSource.addEventListener(SSETypes.Heartbeat, () => {
        queryClient.setQueryData(['sse-status'], 'connected');
      });

      // The device's library is served over REST and published nowhere else, so
      // before this event a client only learned about its own uploads and
      // deletes. With a laptop and a phone both open at the range - the normal
      // case - the second one showed a program that could not be found until
      // somebody reloaded the page (#74).
      eventSource.addEventListener(SSETypes.LibraryChanged, (event) => {
        try {
          const data = JSON.parse(event.data) as LibraryChangedPayload;
          const keys = LIBRARY_QUERY_KEYS[data.kind] as string[][] | undefined;
          if (keys === undefined) {
            // A closed enum this app does not know a member of means a newer
            // contract. Ignoring it is what the contract asks for; refetching
            // everything would be the client inventing a policy.
            console.warn('[SSE] libraryChanged for an unknown kind', data.kind);
            return;
          }
          for (const queryKey of keys) {
            void queryClient.invalidateQueries({ queryKey });
          }
        } catch (error) {
          console.error('[SSE] Failed to parse libraryChanged', error);
        }
      });

      // Whether Expert mode is offered at all (#144). Written straight into the
      // cache the hook reads rather than invalidated: an invalidation would
      // cost a round trip to learn what the event already carried, and the
      // event is the device's own answer.
      eventSource.addEventListener(SSETypes.ConfigWindow, (event) => {
        try {
          const writeWindow = JSON.parse(event.data) as ConfigWindowPayload;
          const previous = queryClient.getQueryData<HardwareConfigState>(['hardware-config']);
          if (previous === undefined) {
            // Nothing cached yet: the event overtook the first fetch, which is
            // ordinary on a page that has only just loaded. Dropping it would
            // lose the transition entirely - the next event might be five
            // minutes away - so refetch instead and take the whole state.
            void queryClient.invalidateQueries({ queryKey: ['hardware-config'] });
            return;
          }
          queryClient.setQueryData(['hardware-config'], { ...previous, writeWindow });
        } catch (error) {
          console.error('[SSE] Failed to parse configWindow', error);
        }
      });

      // Parked in the query cache rather than shown: the toast is a separate
      // task. Until then this at least stops the event being dropped on the
      // floor, which is what happened when the firmware started emitting it.
      // Fire-and-forget by contract - nothing replays it, so a missed issue is
      // gone.
      eventSource.addEventListener(SSETypes.BackendIssue, (event) => {
        try {
          const data = JSON.parse(event.data) as BackendIssuePayload;
          console.warn('[SSE] backend issue', data);
          queryClient.setQueryData(['backend-issue'], data);
        } catch (error) {
          console.error('[SSE] Failed to parse backend_issue', error);
        }
      });
    };

    connect();

    return () => {
      console.log('[SSE] Disconnecting...');
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
    };
  }, [queryClient, settings.serverBaseUrl]);
}
