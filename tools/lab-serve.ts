// Serves the lab to a phone over Tailscale: the same one-page bundle as
// `pnpm lab:html`, rebuilt whenever the renderer's source changes. It listens
// on this machine's Tailscale address only, never on every interface, so the
// LAN and localhost cannot reach it. Reload the page to see a change. The
// page it serves posts a smoothness report every ten seconds to /telemetry,
// which appends each to .lab/telemetry.jsonl at the repository's root.
// Usage: pnpm lab:serve   (LAB_PORT=5181 pnpm lab:serve for a second server)

import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { context } from "esbuild";
import { LAB_BUILD, type LabBundle, labBundle, labPage } from "./lab-page.ts";
import { tailscaleAddress } from "./tailscale.ts";
import { handleTelemetry } from "./telemetry.ts";

const PORT = Number(process.env.LAB_PORT ?? 5180);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`LAB_PORT must be a port number; it is ${process.env.LAB_PORT}.`);
  process.exit(1);
}
const TELEMETRY = resolve(import.meta.dirname, "../.lab/telemetry.jsonl");

const host = tailscaleAddress(networkInterfaces());
if (host === null) {
  console.error("This machine has no Tailscale address (100.64.0.0/10). Start Tailscale, then run pnpm lab:serve again.");
  process.exit(1);
}

let bundle: LabBundle | null = null;
const ctx = await context({
  ...LAB_BUILD,
  logLevel: "warning",
  plugins: [
    ...LAB_BUILD.plugins,
    {
      name: "lab-serve",
      setup(build) {
        build.onEnd((result) => {
          const at = new Date().toLocaleTimeString();
          if (result.errors.length > 0) {
            console.error(`${at} The build failed; the page stays at the last good build.`);
            return;
          }
          bundle = labBundle(result);
          console.log(`${at} Built the lab (${((bundle.js.length + bundle.css.length) / 1024).toFixed(0)} KiB).`);
        });
      },
    },
  ],
});
await ctx.watch();

const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }
  if (path === "/telemetry") {
    handleTelemetry(req, res, TELEMETRY);
    return;
  }
  if (path !== "/" && path !== "/index.html") {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  if (bundle === null) {
    res.writeHead(503, { "content-type": "text/plain" }).end("The lab has not built yet. The terminal running pnpm lab:serve shows why.");
    return;
  }
  // The tag tells the page to post its smoothness reports here.
  const html = labPage(bundle).replace("</head>", () => '<meta name="gaia-telemetry" content="/telemetry">\n</head>');
  const gzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  const body = gzip ? gzipSync(html) : Buffer.from(html);
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    ...(gzip ? { "content-encoding": "gzip" } : {}),
  });
  res.end(req.method === "HEAD" ? undefined : body);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(error.code === "EADDRINUSE" ? `Port ${PORT} on ${host} is in use. Is another pnpm lab:serve running?` : error.message);
  process.exit(1);
});
server.listen(PORT, host, () => {
  console.log(`Serving the lab on Tailscale only: http://${host}:${PORT}/`);
  console.log(`Reload the page after a change. Smoothness reports append to ${TELEMETRY}. Ctrl-C stops the server.`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void ctx.dispose().then(() => process.exit(0));
  });
}
