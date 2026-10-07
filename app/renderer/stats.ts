// The dev readout in the status bar: frame time, the JavaScript time a frame
// takes, and the draw calls and triangles of every pass the open lab renders.
// Off by default; the Stats button or the backquote key toggles it, and the
// choice is remembered in this browser.

import type { WebGLRenderer } from "three";

const KEY = "gaia.lab.stats";

export interface FrameStats {
  /** Milliseconds between frames, smoothed. */
  readonly frameMs: number;
  /** Milliseconds of JavaScript in the lab's frame, smoothed. */
  readonly cpuMs: number;
  /** Draw calls and triangles over every pass of the last frame. */
  readonly calls: number;
  readonly triangles: number;
}

export interface Stats {
  /** Call before the lab draws a frame. */
  begin(renderer: WebGLRenderer | undefined): void;
  /** Call after it; `dt` is seconds since the last frame. */
  end(renderer: WebGLRenderer | undefined, dt: number): void;
  /** The latest readings, or null while the readout is off. */
  read(): FrameStats | null;
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

export function createStats(toggle: HTMLButtonElement, readout: HTMLElement): Stats {
  let on = false;
  let start = 0;
  let shown = 0;
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
      if (!on) {
        if (renderer !== undefined) renderer.info.autoReset = true;
        return;
      }
      // Count every pass of the frame (shadows too), not just the last render call.
      if (renderer !== undefined) {
        renderer.info.autoReset = false;
        renderer.info.reset();
      }
      start = performance.now();
    },
    end(renderer, dt) {
      if (!on) return;
      const t = performance.now();
      const ease = 0.08;
      now.cpuMs += (t - start - now.cpuMs) * ease;
      now.frameMs += (dt * 1000 - now.frameMs) * ease;
      now.calls = renderer?.info.render.calls ?? 0;
      now.triangles = renderer?.info.render.triangles ?? 0;
      if (t - shown < 250) return;
      shown = t;
      readout.textContent =
        `${now.frameMs.toFixed(1)} ms · ${Math.round(1000 / Math.max(now.frameMs, 1e-3))} fps · ` +
        `js ${now.cpuMs.toFixed(1)} ms · ${now.calls} draws · ${(now.triangles / 1e6).toFixed(2)} M tris`;
    },
    read: () => (on ? { ...now } : null),
  };
}
