// Prints, and never sends, every Jev request that judging Gaia's own world
// would make: the exact bodies the engine's connector would post to
// OpenRouter, then how many there are and what they would cost. The cost
// comes from the engine's own `jev.estimate`, the same code that would send
// them, which reads neither the key nor the network.
// Usage: pnpm print-world-requests [requests.json]

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CodeModel, JevEstimate } from "@gaia/schema";
import { planWorldRequests } from "@gaia/world";
import { LOOKS } from "../app/renderer/terrain/looks.ts";

const repo = resolve(import.meta.dirname, "..");
const model = JSON.parse(readFileSync(resolve(repo, "app/renderer/terrain/fixtures/gaia.json"), "utf8")) as CodeModel;
const planned = planWorldRequests(model, LOOKS);
const out = process.argv[2];
if (out !== undefined) writeFileSync(out, `${JSON.stringify(planned, null, 2)}\n`);
else console.log(JSON.stringify(planned.map((p) => p.request), null, 2));

const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` };
execFileSync("cargo", ["build", "-p", "gaia-engine", "--release", "--quiet"], { cwd: repo, env, stdio: "inherit" });
const call = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "jev.estimate", params: { requests: planned.map((p) => p.request) } });
const run = spawnSync(resolve(repo, "target/release/gaia-engine"), ["rpc"], { input: `${call}\n`, maxBuffer: 1 << 26 });
const estimate = (JSON.parse(run.stdout.toString()) as { result: JevEstimate }).result;

const by: Record<string, { requests: number; questions: number }> = {};
for (const p of planned) {
  const b = (by[p.about] ??= { requests: 0, questions: 0 });
  b.requests++;
  b.questions += Object.keys(p.request.questions).length;
}
const lines = [
  `${estimate.requests} requests, ${estimate.questions} questions, ${(estimate.bytes / 1024).toFixed(0)} KiB to ${estimate.endpoint}`,
  ...Object.entries(by).map(([about, b]) => `  ${about}: ${b.requests} requests, ${b.questions} questions`),
  `About ${estimate.estimatedTokens.toLocaleString()} input tokens (bytes / 1.8, calibrated on OpenRouter's published example); output tokens are free.`,
  `About $${estimate.estimatedUsd.toFixed(4)} at $${estimate.usdPerMillionInputTokens} per million input tokens, ${estimate.concurrency} at a time.`,
  `Sent: nothing. This engine would send them only with GAIA_JEV=live (now: ${estimate.live ? "live" : "off"}).`,
];
console.error(lines.join("\n"));
