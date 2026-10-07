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

/** Posts `summary()` every ten seconds while the page is visible; returns false when this page does not report. */
export function startTelemetry(summary: () => Record<string, unknown>): boolean {
  const endpoint = telemetryEndpoint();
  if (endpoint === null) return false;
  setInterval(() => {
    if (document.hidden) return;
    const body = JSON.stringify(summary());
    void fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  }, EVERY);
  return true;
}
