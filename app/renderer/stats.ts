// The dev readout in the status bar: how smooth the last ten seconds were
// (frame-interval median, 99th percentile and worst, stutters and long
// tasks), the JavaScript time a frame takes, and the draw calls and triangles
// of every pass the open lab renders. The smoothness probe always runs, so a
// report can carry it; the readout is off by default, and the Stats button or
// the backquote key toggles it, remembered in this browser.

import type { WebGLRenderer } from "three";

const KEY = "gaia.lab.stats";
/** The probe's window, milliseconds. */
const WINDOW = 10_000;
/** A frame interval this many times the window's median shows as a stutter. */
const STUTTER = 1.5;

/** How smooth the last ten seconds were. */
export interface Smoothness {
  /** Seconds the window covers and the frames in it. */
  readonly seconds: number;
  readonly frames: number;
  /** Frame intervals, milliseconds. */
  readonly medianMs: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  /** Intervals longer than 1.5 times the median. */
  readonly stutters: number;
  /** Main-thread tasks over 50 ms, and the longest, milliseconds; null where the browser cannot tell (Safari). */
  readonly longTasks: number | null;
  readonly longestTaskMs: number | null;
}

export interface FrameStats {
  /** Milliseconds between frames, smoothed. */
  readonly frameMs: number;
  /** Milliseconds of JavaScript in the lab's frame, smoothed. */
  readonly cpuMs: number;
  /** Draw calls and triangles over every pass of the last frame. */
  readonly calls: number;
  readonly triangles: number;
  readonly smooth: Smoothness;
}

export interface Stats {
  /** Call before the lab draws a frame. */
  begin(renderer: WebGLRenderer | undefined): void;
  /** Call after it; `dt` is seconds since the last frame. */
  end(renderer: WebGLRenderer | undefined, dt: number): void;
  /** The latest readings, or null while the readout is off. */
  read(): FrameStats | null;
  /** The probe's last ten seconds, whether or not the readout shows. */
  smoothness(): Smoothness;
  /** The last frame's draw calls and triangles, counted while the readout shows or `count(true)` asks for them. */
  passes(): { calls: number; triangles: number } | null;
  /** Counts every pass of each frame even while the readout is off, for reports. */
  count(on: boolean): void;
}

function remembered(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

function remember(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Storage may be blocked; the readout still toggles for this visit.
  }
}

/** Frame intervals and long tasks over a sliding window. */
function createProbe() {
  // Times and intervals as parallel rings, so a frame never allocates.
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
    // No long-task timing here; reports say so with null.
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

export function createStats(toggle: HTMLButtonElement, readout: HTMLElement): Stats {
  let on = false;
  let reporting = false;
  let counting = false;
  let start = 0;
  let shown = 0;
  const probe = createProbe();
  const now = { frameMs: 0, cpuMs: 0, calls: 0, triangles: 0 };

  const set = (next: boolean): void => {
    on = next;
    toggle.setAttribute("aria-pressed", String(on));
    toggle.classList.toggle("on", on);
    readout.hidden = !on;
    if (!on) readout.textContent = "";
    remember(on);
  };
  set(remembered());
  toggle.addEventListener("click", () => set(!on));
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Backquote" || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    set(!on);
  });

  return {
    begin(renderer) {
      start = performance.now();
      counting = on || reporting;
      if (!counting) {
        if (renderer !== undefined) renderer.info.autoReset = true;
        return;
      }
      // Count every pass of the frame (shadows too), not just the last render call.
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
      if (!on || t - shown < 250) return;
      shown = t;
      const s = probe.read(t);
      const long = s.longTasks === null ? "" : ` · ${s.longTasks} long tasks`;
      readout.textContent =
        `${s.seconds.toFixed(0)} s: median ${s.medianMs.toFixed(1)} · p99 ${s.p99Ms.toFixed(1)} · max ${s.maxMs.toFixed(1)} ms · ${s.stutters} stutters${long} · ` +
        `${Math.round(1000 / Math.max(now.frameMs, 1e-3))} fps · js ${now.cpuMs.toFixed(1)} ms · ${now.calls} draws · ${(now.triangles / 1e6).toFixed(2)} M tris`;
    },
    read: () => (on ? { ...now, smooth: probe.read(performance.now()) } : null),
    smoothness: () => probe.read(performance.now()),
    passes: () => (counting ? { calls: now.calls, triangles: now.triangles } : null),
    count(next) {
      reporting = next;
    },
  };
}
