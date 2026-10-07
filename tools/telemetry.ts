// Smoothness reports from the devices `pnpm lab:serve` serves: each POST to
// /telemetry is one small JSON object, appended as one line to a git-ignored
// file, so how the lab felt on a phone can be read back afterwards.

import { appendFileSync, mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";

/** The largest report accepted, bytes. A report is a few hundred. */
export const TELEMETRY_LIMIT = 8 * 1024;

/** One report as a line of JSON stamped with when it arrived, or null when the body is not one JSON object. */
export function telemetryLine(body: string, received: Date): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return `${JSON.stringify({ received: received.toISOString(), ...parsed })}\n`;
}

/** Answers POST /telemetry: appends the report to `file`, refusing anything too large or not a JSON object. */
export function handleTelemetry(req: IncomingMessage, res: ServerResponse, file: string): void {
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST", "content-type": "text/plain" }).end("POST a report.");
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let refused = false;
  req.on("data", (chunk: Buffer) => {
    if (refused) return;
    size += chunk.length;
    if (size > TELEMETRY_LIMIT) {
      refused = true;
      res.writeHead(413, { "content-type": "text/plain", connection: "close" }).end("Too large.");
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (refused) return;
    const line = telemetryLine(Buffer.concat(chunks).toString("utf8"), new Date());
    if (line === null) {
      res.writeHead(400, { "content-type": "text/plain" }).end("Send one JSON object.");
      return;
    }
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line);
    res.writeHead(204).end();
  });
}
