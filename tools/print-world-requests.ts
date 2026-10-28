// Prints, and never sends, every Jev request that judging a project's world
// would make, from the graph snapshot `pnpm graph-snapshot` writes (`SNAPSHOT`
// unless --graph names another). It prints the look and form requests for
// every entity, file and definition as the exact bodies the engine's connector
// would post to OpenRouter, then their count and cost. Composing depends on the
// answers, so it is not printed, and the app prices it at about two requests
// per thing (`composingEstimate`). The cost comes from the engine's
// own `jev.estimate`, the same code that would send them, which reads neither
// the key nor the network.
// Usage: pnpm print-world-requests [--graph graph.json] [requests.json]

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { engineBinary } from "./engine-binary.ts";
import { cargoEnv } from "./cargo-env.ts";
import type { CodeGraph, JevEstimate } from "@gaia/schema";
import { factsOf, planForms, planWorldRequests } from "@gaia/world";
import { LOOKS } from "../app/renderer/terrain/looks.ts";
import { SNAPSHOT } from "./snapshot-paths.ts";

const repo = resolve(import.meta.dirname, "..");
const { values, positionals } = parseArgs({ allowPositionals: true, options: { graph: { type: "string" } } });
const graphFile = resolve(values.graph ?? SNAPSHOT.graph);
if (!existsSync(graphFile)) throw new Error(`No graph snapshot at ${graphFile}: write one with \`GAIA_DATA_DIR=dir pnpm graph-snapshot\`, or pass --graph.`);
const graph = JSON.parse(readFileSync(graphFile, "utf8")) as CodeGraph;
const facts = factsOf(graph);
const planned = [...planWorldRequests(facts, LOOKS), ...planForms(facts, LOOKS, { graph }).requests];
const out = positionals[0];
if (out !== undefined) writeFileSync(out, `${JSON.stringify(planned, null, 2)}\n`);
else console.log(JSON.stringify(planned.map((p) => p.request), null, 2));

const env = cargoEnv();
execFileSync("cargo", ["build", "-p", "gaia-engine", "--release", "--quiet"], { cwd: repo, env, stdio: "inherit" });
const call = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "jev.estimate", params: { requests: planned.map((p) => p.request) } });
const run = spawnSync(engineBinary(repo, "release"), ["rpc"], { input: `${call}\n`, env, maxBuffer: 1 << 26 });
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
