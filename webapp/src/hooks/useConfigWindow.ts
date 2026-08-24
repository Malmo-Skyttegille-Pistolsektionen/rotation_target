import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHardwareConfigApi } from '../api/hardwareConfig';

/**
 * Whether the device is currently accepting hardware configuration (#144), and
 * for how much longer.
 *
 * Drives whether Expert mode is *offered at all*, rather than letting somebody
 * fill in a form that cannot be submitted. The window opens on a press of the
 * device's BOOT button and lasts five minutes.
 *
 * Fetched once and then kept current by the `configWindow` SSE event, which
 * `useSSE` writes straight into this query's cache. Not polled: the window
 * changes a handful of times in a device's life, and asking every few seconds
 * forever — on every open browser, including during a run — to catch it is the
 * wrong shape.
 *
 * The device publishes the transition, including the one nothing else would
 * notice: the five minutes simply lapsing.
 */
export function useConfigWindow(): { open: boolean; remainingSeconds: number } {
  const api = useHardwareConfigApi();

  const { data, dataUpdatedAt } = useQuery({
    queryKey: ['hardware-config'],
    queryFn: api.get,
  });

  const serverOpen = data?.writeWindow.open ?? false;
  const serverRemaining = data?.writeWindow.remainingSeconds ?? 0;

  // Polling alone makes a "countdown" that jumps five seconds at a time and
  // reads as a broken clock. This re-renders once a second; the value below is
  // derived rather than stored, so there is no second copy of the truth to fall
  // out of step with the device.
  // The clock is sampled in the interval rather than during render: reading
  // `Date.now()` while rendering makes the output depend on when React happened
  // to render, which is neither pure nor reproducible in a test.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!serverOpen) return;
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [serverOpen]);

  // Counted from when the device last told us, so a slow poll, a sleeping tab
  // or a second press all correct themselves on the next response instead of
  // accumulating drift. Zero until the first tick, which simply shows what the
  // device said.
  const elapsedSeconds =
    nowMs > 0 && dataUpdatedAt > 0 ? Math.max(0, Math.floor((nowMs - dataUpdatedAt) / 1000)) : 0;

  return {
    // The device decides whether the window is open — never the local clock.
    // Showing the form as usable because a browser-side counter has not run out
    // yet would be a form that looks fine and cannot save.
    open: serverOpen,
    remainingSeconds: Math.max(0, serverRemaining - elapsedSeconds),
  };
}
