/**
 * The mock server's only source of time, so a test can run a 40-second series
 * in microseconds. `realClock` is what the dev server uses; `createFakeClock`
 * is what tests drive by hand.
 */
export interface Clock {
  now(): number;
  /** Returns a cancel function rather than a handle — the only thing callers do with one. */
  setInterval(callback: () => void, intervalMs: number): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setInterval: (callback, intervalMs) => {
    const timer = setInterval(callback, intervalMs);
    return () => clearInterval(timer);
  },
};

export interface FakeClock extends Clock {
  /** Advance simulated time, firing every interval that comes due, in order. */
  advance(ms: number): void;
}

export function createFakeClock(startMs = 0): FakeClock {
  let now = startMs;
  let nextId = 1;
  const intervals = new Map<number, { intervalMs: number; nextDueAt: number; callback: () => void }>();

  return {
    now: () => now,

    setInterval(callback, intervalMs) {
      const id = nextId++;
      intervals.set(id, { intervalMs, nextDueAt: now + intervalMs, callback });
      return () => intervals.delete(id);
    },

    advance(ms) {
      const target = now + ms;

      for (;;) {
        // Earliest due interval first, so callbacks observe a monotonic clock
        // even when several are registered at different cadences.
        let due: { id: number; at: number } | null = null;
        for (const [id, entry] of intervals) {
          if (entry.nextDueAt <= target && (due === null || entry.nextDueAt < due.at)) {
            due = { id, at: entry.nextDueAt };
          }
        }
        if (due === null) break;

        const entry = intervals.get(due.id)!;
        now = due.at;
        entry.nextDueAt = due.at + entry.intervalMs;
        entry.callback();
      }

      now = target;
    },
  };
}
