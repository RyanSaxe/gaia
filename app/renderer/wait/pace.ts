// The wait's pace. Answers arrive in bursts, a slice of Jev's at a time and
// seconds apart, but the sheet is drawn as a hand draws: one stroke after
// another, never all at once and never stopping while work is still coming.
// Each kind of stroke keeps its own queue and is drawn at its own calm pace,
// faster only so that a burst is drawn by about when the next one is due,
// judged by how far apart they have come so far. Nothing is drawn before it
// has happened; the pen follows the work by at most one burst. Once the world
// is ready, whatever is left is drawn quickly, so the pace never holds it back.

/** One kind of stroke's pace: the time between two strokes when nothing presses, and the most it may lag, ms. */
export interface Pace {
  readonly everyMs: number;
  /** The least and the most time a burst is spread over, ms. */
  readonly spreadMs: readonly [number, number];
}

/**
 * How much longer than the gap since the last burst a burst is spread over: the work's bursts come unevenly, so a
 * burst spread over just that gap would often be drawn before the next arrives, and the sheet would stop.
 */
const AHEAD = 1.6;
/** How fast whatever is still queued is drawn once the world is ready: all of it within this long, ms. */
export const FLUSH_MS = 1500;

export interface Pacer<T> {
  /** Items that have just happened, to draw one after another. */
  add(items: readonly T[], now: number): void;
  /** The items due by `now`, in the order they came, taken from the queue. */
  due(now: number): T[];
  /** When the next item is due, or null when the queue is empty. */
  next(): number | null;
  /** Draw what is left within `FLUSH_MS` from `now`. */
  flush(now: number): void;
  readonly size: number;
}

/**
 * A queue drawn at `pace`: an item at least `everyMs` after the one before, unless the queue would then take longer
 * than the gap the next burst is expected after (the larger of the last gap and the average of those before it, a
 * little longer, within `spreadMs`), when it is drawn faster to finish by then.
 */
export function pacer<T>(pace: Pace): Pacer<T> {
  const queue: T[] = [];
  /** When the next item may be drawn, and when the queue is to be done by. */
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
