/* eslint-disable @eslint-react/web-api-no-leaked-event-listener --
   The listeners hang off an EventSource the cleanup closes and drops, which
   detaches them; there is no long-lived target to leak from. */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SSETypes } from '../api/types';
import type { BackendIssuePayload, StateUpdatePayload } from '../api/types';
import { getSseBaseUrl } from '../api/client';
import { useSettings } from '../context/SettingsContext';

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
