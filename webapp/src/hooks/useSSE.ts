import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SSETypes } from '../api/types';
import type { StateUpdatePayload } from '../api/types';

const SERVER_BASE_URL = 'http://localhost:8080';
const SERVER_SSE_URL = `${SERVER_BASE_URL}/sse/v2`;

export function useSSE(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connect = (): void => {
      console.log('[SSE] Connecting...');
      eventSource = new EventSource(SERVER_SSE_URL);

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
  }, [queryClient]);
}
