import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TELEMETRY_LIMIT, handleTelemetry } from "./telemetry.ts";

describe("telemetry", () => {
  const dir = mkdtempSync(join(tmpdir(), "gaia-telemetry-"));
  const file = join(dir, ".lab", "telemetry.jsonl");
  let server: Server;
  let url = "";
  beforeAll(async () => {
    server = createServer((req, res) => handleTelemetry(req, res, file));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/telemetry`;
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const post = (body: string) => fetch(url, { method: "POST", body, headers: { "content-type": "application/json" } }).then((r) => r.status);

  it("appends each report as one stamped line of JSON, and refuses what is not a small JSON object", async () => {
    expect(await post(JSON.stringify({ tab: "terrain", smooth: { medianMs: 8.3, stutters: 0 } }))).toBe(204);
    expect(await post(JSON.stringify({ tab: "flora" }))).toBe(204);
    expect(await post("not json")).toBe(400);
    expect(await post("[1, 2]")).toBe(400);
    expect(await post(JSON.stringify({ pad: "x".repeat(TELEMETRY_LIMIT) })).catch(() => 413)).toBe(413);
    const lines = readFileSync(file, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.tab)).toEqual(["terrain", "flora"]);
    expect(lines[0].smooth).toEqual({ medianMs: 8.3, stutters: 0 });
    expect(Number.isNaN(Date.parse(lines[0].received))).toBe(false);
  });
});
