// Paces the wait's strokes. Answers arrive in bursts seconds apart, so each
// kind of stroke has a queue that draws one item at a time at a steady pace,
// and speeds up only to finish a burst by about when the next is expected.
// Nothing is drawn before it happens, so the sheet trails the work by at most
// one burst, and `flush` draws the rest quickly once the world is ready.

/** One kind of stroke's pace. `everyMs` is the gap between strokes when the queue has time to spare, and the longest gap. */
export interface Pace {
  readonly everyMs: number;
  /** The least and the most time a burst is spread over, ms. */
  readonly spreadMs: readonly [number, number];
}

/**
 * How much longer than the expected gap a burst is spread over. Bursts arrive unevenly, so a burst spread over exactly
 * the gap would often finish before the next arrives, and the sheet would stop changing.
 */
const AHEAD = 1.6;
/** Once the world is ready, everything still queued is drawn within this many milliseconds. */
export const FLUSH_MS = 1500;

export interface Pacer<T> {
  /** Queues items that just happened, to draw one after another. */
  add(items: readonly T[], now: number): void;
  /** Removes and returns the items due by `now`, in arrival order. */
  due(now: number): T[];
  /** When the next item is due, or null when the queue is empty. */
  next(): number | null;
  /** Draws everything left within `FLUSH_MS` of `now`. */
  flush(now: number): void;
  readonly size: number;
}

/**
 * A queue drawn at `pace`. Items are drawn `everyMs` apart, or faster when the queue would otherwise finish after the
 * next burst is expected. The expected gap is the larger of the last gap and its average with the previous expected
 * gap, times `AHEAD`, clamped to `spreadMs`.
 */
export function pacer<T>(pace: Pace): Pacer<T> {
  const queue: T[] = [];
  /** When the next item may be drawn, and when the queue should be empty. */
  let at: number | null = null;
  let by = 0;
  let last: number | null = null;
  let gap = pace.spreadMs[0];
  let flushing = false;
  const step = (): number => Math.min(pace.everyMs, Math.max(0, by - (at ?? 0)) / Math.max(1, queue.length));
  return {
    add(items, now) {
      if (items.length === 0) return;
      if (last !== null) {
        const since = now - last;
        gap = Math.max(pace.spreadMs[0], Math.min(pace.spreadMs[1], Math.max(since, (gap + since) / 2) * AHEAD));
      }
      last = now;
      if (queue.length === 0) at = Math.max(at ?? now, now);
      queue.push(...items);
      by = Math.max(by, now + (flushing ? FLUSH_MS : gap));
    },
    due(now) {
      const out: T[] = [];
      while (queue.length > 0 && at !== null && at <= now) {
        out.push(queue.shift() as T);
        at += step();
      }
      if (queue.length === 0 && at !== null) at = Math.max(at, now);
      return out;
    },
    next: () => (queue.length === 0 ? null : at),
    flush(now) {
      flushing = true;
      by = Math.min(by, now + FLUSH_MS);
      if (queue.length > 0) at = Math.min(at ?? now, now);
    },
    get size() {
      return queue.length;
    },
  };
}
