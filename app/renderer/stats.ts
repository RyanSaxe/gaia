// Measures frame smoothness over the last ten seconds, JavaScript time per
// frame, and draw calls and triangles across every render pass, for
// `__lab.stats`, `__lab.smoothness` and telemetry. The smoothness probe always
// runs. Passes are counted only after `read` or `count(true)` asks for them.

import type { WebGLRenderer } from "three";

/** The probe's sliding window, in milliseconds. */
const WINDOW = 10_000;
/** A frame interval longer than this multiple of the window's median counts as a stutter. */
const STUTTER = 1.5;

/** How smooth the last ten seconds were. */
export interface Smoothness {
  /** Seconds the window covers and the frames in it. */
  readonly seconds: number;
  readonly frames: number;
  /** Frame interval statistics, in milliseconds. */
  readonly medianMs: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  /** Intervals longer than `STUTTER` times the median. */
  readonly stutters: number;
  /** The count of main-thread tasks over 50 ms, and the longest one in milliseconds. Null where the browser has no long-task timing, such as Safari. */
  readonly longTasks: number | null;
  readonly longestTaskMs: number | null;
}

export interface FrameStats {
  /** Milliseconds between frames, smoothed. */
  readonly frameMs: number;
  /** Milliseconds of JavaScript in the world's frame, smoothed. */
  readonly cpuMs: number;
  /** Draw calls and triangles over every pass of the last frame. */
  readonly calls: number;
  readonly triangles: number;
  readonly smooth: Smoothness;
}

export interface Stats {
  /** Call before the world draws a frame. */
  begin(renderer: WebGLRenderer | undefined): void;
  /** Call after the world draws a frame. `dt` is the seconds since the last frame. */
  end(renderer: WebGLRenderer | undefined, dt: number): void;
  /** Returns the latest readings. From the first call on, every pass of each frame is counted. */
  read(): FrameStats;
  /** The probe's last ten seconds. */
  smoothness(): Smoothness;
  /** The last frame's draw calls and triangles, or null until `read` or `count(true)` turns counting on. */
  passes(): { calls: number; triangles: number } | null;
  /** Turns counting of every pass on or off, for reports. */
  count(on: boolean): void;
}

/** Frame intervals and long tasks over a sliding window. */
function createProbe() {
  // Times and intervals live in parallel ring buffers, so a frame never allocates.
  const size = 4096;
  const at = new Float64Array(size);
  const interval = new Float32Array(size);
  let head = 0;
  let count = 0;
  const long: { at: number; ms: number }[] = [];
  let watchesLongTasks = false;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) long.push({ at: e.startTime + e.duration, ms: e.duration });
    }).observe({ type: "longtask", buffered: false });
    watchesLongTasks = PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false;
  } catch {
    // This browser has no long-task timing, so reports give null.
  }
  const sorted = new Float32Array(size);
  return {
    push(now: number, ms: number): void {
      at[head] = now;
      interval[head] = ms;
      head = (head + 1) % size;
      count = Math.min(size, count + 1);
    },
    read(now: number): Smoothness {
      let n = 0;
      let first = now;
      for (let k = 0; k < count; k++) {
        const i = (head - 1 - k + size) % size;
        if (now - (at[i] as number) > WINDOW) break;
        sorted[n++] = interval[i] as number;
        first = at[i] as number;
      }
      const view = sorted.subarray(0, n).sort();
      const q = (p: number): number => (n === 0 ? 0 : (view[Math.min(n - 1, Math.floor(p * n))] as number));
      const median = q(0.5);
      let stutters = 0;
      for (let k = 0; k < n; k++) if ((view[k] as number) > median * STUTTER) stutters++;
      while (long.length > 0 && now - (long[0] as { at: number }).at > WINDOW) long.shift();
      const round = (v: number): number => Math.round(v * 10) / 10;
      return {
        seconds: round((now - first) / 1000),
        frames: n,
        medianMs: round(median),
        p99Ms: round(q(0.99)),
        maxMs: round(n === 0 ? 0 : (view[n - 1] as number)),
        stutters,
        longTasks: watchesLongTasks ? long.length : null,
        longestTaskMs: watchesLongTasks ? Math.round(long.reduce((m, t) => Math.max(m, t.ms), 0)) : null,
      };
    },
  };
}

export function createStats(): Stats {
  let asked = false;
  let reporting = false;
  let counting = false;
  let start = 0;
  const probe = createProbe();
  const now = { frameMs: 0, cpuMs: 0, calls: 0, triangles: 0 };

  return {
    begin(renderer) {
      start = performance.now();
      counting = asked || reporting;
      if (!counting) {
        if (renderer !== undefined) renderer.info.autoReset = true;
        return;
      }
      // Counts every pass of the frame, shadows included, not just the last render call.
      if (renderer !== undefined) {
        renderer.info.autoReset = false;
        renderer.info.reset();
      }
    },
    end(renderer, dt) {
      const t = performance.now();
      probe.push(t, dt * 1000);
      if (!counting) return;
      const ease = 0.08;
      now.cpuMs += (t - start - now.cpuMs) * ease;
      now.frameMs += (dt * 1000 - now.frameMs) * ease;
      now.calls = renderer?.info.render.calls ?? 0;
      now.triangles = renderer?.info.render.triangles ?? 0;
    },
    read() {
      asked = true;
      return { ...now, smooth: probe.read(performance.now()) };
    },
    smoothness: () => probe.read(performance.now()),
    passes: () => (counting ? { calls: now.calls, triangles: now.triangles } : null),
    count(next) {
      reporting = next;
    },
  };
}
