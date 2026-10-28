// Posts smoothness reports from a device. When `pnpm lab:serve` serves the
// page, a `gaia-telemetry` meta tag names the endpoint, and every ten seconds
// the page posts a summary of the device, the world and the last ten seconds'
// smoothness. A page opened any other way has no such tag and never posts.

/** Interval between reports, in milliseconds. */
const EVERY = 10_000;

/** Returns the same-origin path to post reports to, or null when this page does not report. */
export function telemetryEndpoint(): string | null {
  if (location.protocol !== "http:" && location.protocol !== "https:") return null;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="gaia-telemetry"]');
  const path = meta?.content ?? "";
  return path.startsWith("/") ? path : null;
}

/** A random id for this page load, so the reports from one load can be grouped. */
const LOAD = Math.random().toString(36).slice(2, 10);

const post = (endpoint: string, report: Record<string, unknown>): void => {
  const body = JSON.stringify({ load: LOAD, ...report });
  void fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
};

/** Posts `summary()` every ten seconds while the page is visible. Returns false when this page does not report. */
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
 * Posts immediately that this page reached `stage` while opening a world, with
 * the milliseconds since page start and the JavaScript heap size where the
 * browser exposes it. A device that fails while opening has then reported how
 * far it got. A page that does not report posts nothing.
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
