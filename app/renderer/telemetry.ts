// Smoothness reports from a device: when `pnpm lab:serve` serves the lab, its
// page carries a meta tag naming where to post, and every ten seconds the lab
// posts a small summary there (the device, the open tab, the world and how
// smooth the last ten seconds were). A page opened from a file, or served any
// other way, has no such tag and never posts.

/** How often a report goes out, milliseconds. */
const EVERY = 10_000;

/** The same-origin path reports go to, or null when this page should not post. */
export function telemetryEndpoint(): string | null {
  if (location.protocol !== "http:" && location.protocol !== "https:") return null;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="gaia-telemetry"]');
  const path = meta?.content ?? "";
  return path.startsWith("/") ? path : null;
}

/** This page load's own name, so the reports of one opening read together. */
const LOAD = Math.random().toString(36).slice(2, 10);

const post = (endpoint: string, report: Record<string, unknown>): void => {
  const body = JSON.stringify({ load: LOAD, ...report });
  void fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
};

/** Posts `summary()` every ten seconds while the page is visible; returns false when this page does not report. */
export function startTelemetry(summary: () => Record<string, unknown>): boolean {
  const endpoint = telemetryEndpoint();
  if (endpoint === null) return false;
  setInterval(() => {
    if (document.hidden) return;
    post(endpoint, summary());
  }, EVERY);
  return true;
}

/**
 * Posts at once that this page has reached `stage` of opening a world, with
 * the milliseconds since the page began and its JavaScript memory where the
 * browser tells it. A device that fails while opening has then said how far
 * it got. A page that does not report posts nothing.
 */
export function reportStage(stage: string, details: Record<string, unknown> = {}): void {
  const endpoint = telemetryEndpoint();
  if (endpoint === null) return;
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  post(endpoint, {
    stage,
    atMs: Math.round(performance.now()),
    userAgent: navigator.userAgent,
    dpr: window.devicePixelRatio,
    ...(memory === undefined ? {} : { jsHeapMB: Math.round(memory.usedJSHeapSize / 1048576) }),
    ...details,
  });
}
