// Judges and composes Gaia's snapshot world (the facts of
// `app/renderer/terrain/fixtures/gaia-graph.json`, `factsOf`) once with Jev,
// the way the app does, and keeps the answers by request key in
// `fixtures/gaia-jev.json`, the lab's own copy of what the app keeps per
// project. The lab lays the snapshot out with those answers alone, so a page
// with no engine shows Jev's world, and fails on any request with no kept
// answer. Answers already kept are never asked again, so a run can be cut
// short with --limit and finished later; once a whole run has asked every
// request, answers to requests the world no longer makes are dropped.
//
// Nothing reaches OpenRouter unless the judge is `jev`, the engine runs with
// GAIA_JEV=live, and --spend-up-to covers twice the engine's estimate of the
// looks and of composing, about two requests a thing (`composingEstimate`).
// Every request is priced before it is sent: one that would take the
// reported cost past --spend-up-to is not sent, and the run stops there,
// keeping what was answered.
//
// Usage: pnpm jev-world [--judge jev|local] [--limit 5]
//          [--spend-up-to 0.05] [--out fixtures/gaia-jev.json] [--ledger ledger.jsonl]
//          [--graph gaia-graph.json]

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { CodeGraph, EngineClient, JevClient, JevResponse } from "@gaia/schema";
import { composeWorld, composingEstimate, factsOf, judgeWorld, keptJev, planStanding, planWorldRequests, requestKey } from "@gaia/world";
import { createEngineClient } from "../app/world-service/engine-client.ts";
import { engineJev } from "../app/world-service/jev.ts";
import { LOOKS } from "../app/renderer/terrain/looks.ts";
import { startOpenRouterStandIn } from "./openrouter-stand-in.ts";
import { engineBinary } from "./engine-binary.ts";
import { cargoEnv } from "./cargo-env.ts";
import { fixtureJson } from "./fixture-json.ts";

const repo = resolve(import.meta.dirname, "..");
const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : (process.argv[i + 1] ?? fallback);
};
const judge = flag("judge", "local");
const limit = Number(flag("limit", "Infinity"));
const allowed = Number(flag("spend-up-to", "0"));
const out = resolve(flag("out", resolve(repo, "app/renderer/terrain/fixtures/gaia-jev.json")));
const ledger = flag("ledger", "");
const graph = JSON.parse(readFileSync(resolve(flag("graph", resolve(repo, "app/renderer/terrain/fixtures/gaia-graph.json"))), "utf8")) as CodeGraph;
const facts = factsOf(graph);

/** The kept answers: what the app's `answers` table holds for a project, by request key. */
interface Kept {
  readonly answers: Record<string, JevResponse>;
}
const kept: Kept = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as Kept) : { answers: {} };

let engine: ChildProcess | undefined;
let closeStandIn: (() => Promise<void>) | undefined;
function startEngine(env: Record<string, string>): EngineClient {
  execFileSync("cargo", ["build", "-p", "gaia-engine", "--release", "--quiet"], { cwd: repo, env: cargoEnv(), stdio: "inherit" });
  engine = spawn(engineBinary(repo, "release"), ["rpc"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
  const client = createEngineClient((line) => engine?.stdin?.write(`${line}\n`));
  if (engine.stdout !== null) createInterface({ input: engine.stdout }).on("line", (line) => client.receive(line));
  return client;
}

let client: EngineClient;
if (judge === "local") {
  const standIn = await startOpenRouterStandIn({ delayMs: 0 });
  closeStandIn = standIn.close;
  client = startEngine({ GAIA_JEV: "live", GAIA_JEV_ENDPOINT: standIn.endpoint });
} else if (judge === "jev") client = startEngine({});
else throw new Error(`Unknown judge ${judge}; choose jev or local.`);

const status = await client.call("jev.status", {});
if (!status.live || !status.key) throw new Error("Jev needs GAIA_JEV=live and OPENROUTER_API_KEY.");

// What this run would send: the requests not kept yet, at most --limit of them, the looks' and what every thing
// stands as.
const missing = [...planWorldRequests(facts, LOOKS), ...planStanding(facts, LOOKS, { graph }).requests].filter((p) => kept.answers[requestKey(p.request)] === undefined);
const toSend = missing.slice(0, limit);
const estimate = await client.call("jev.estimate", { requests: toSend.map((p) => p.request) });
// Composing follows from those answers: about two requests a thing, priced at one that composes a tree, whether or not
// some of them are kept already, so the figure is never short.
const composing = composingEstimate(facts, LOOKS, graph);
const each = composing === null ? 0 : (await client.call("jev.estimate", { requests: [composing.sample] })).estimatedUsd;
const composingUsd = each * (composing?.requests ?? 0);
const ceiling = (estimate.estimatedUsd + composingUsd) * 2;
console.error(`${missing.length} of the world's requests are not kept yet; sending ${toSend.length}, about ${estimate.estimatedTokens.toLocaleString("en-US")} tokens, about $${estimate.estimatedUsd.toFixed(4)}, and composing about ${composing?.requests ?? 0} more, about $${composingUsd.toFixed(4)} (allowing twice both).`);
if (judge === "jev" && !(allowed >= ceiling)) {
  engine?.kill();
  throw new Error(`Refusing to spend: pass --spend-up-to ${ceiling.toFixed(4)} or more to ask Jev.`);
}

// Jev, sending at most --limit requests and never past what was allowed.
const live = engineJev(client);
let sent = 0;
let spent = 0;
let tokens = 0;
const ms: number[] = [];
const guarded: JevClient = {
  async ask(request) {
    if (sent >= limit) throw new Error("over --limit");
    // Every request is priced before it goes, composing's too, which no plan counts ahead.
    if (judge === "jev" && spent + (await client.call("jev.estimate", { requests: [request] })).estimatedUsd > allowed) throw new Error("over --spend-up-to");
    sent++;
    const r = await live.ask(request);
    spent += r.costUsd;
    tokens += r.inputTokens ?? 0;
    ms.push(r.ms);
    return r;
  },
};
const asked = new Set<string>();
const started = Date.now();
/** Why the run stopped before every request was answered, if it did: a limit, or a request Jev could not answer. */
let stopped: string | undefined;
const jev = keptJev(guarded, {
  stored: new Map(Object.entries(kept.answers)),
  keep: (key, response) => {
    kept.answers[key] = response;
  },
  settled: (key) => asked.add(key),
});
try {
  await composeWorld(facts, LOOKS, jev, await judgeWorld(facts, LOOKS, jev), { graph, concurrency: estimate.concurrency });
} catch (error) {
  stopped = (error as Error).message;
} finally {
  engine?.kill();
  await closeStandIn?.();
}
// Once a whole run has asked every request, answers to requests the world no longer makes (its questions or options
// changed) are dropped.
if (stopped === undefined) for (const key of Object.keys(kept.answers)) if (!asked.has(key)) delete kept.answers[key];
writeFileSync(out, fixtureJson({ answers: kept.answers }));

ms.sort((a, b) => a - b);
const at = (q: number): number => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] ?? 0;
const summary = {
  time: new Date().toISOString(),
  what: `jev-world (${judge})`,
  requests: sent,
  stopped: stopped ?? null,
  inputTokens: tokens,
  estimatedUsd: +estimate.estimatedUsd.toFixed(6),
  reportedUsd: +spent.toFixed(6),
  latencyMs: { p50: at(0.5), p90: at(0.9), max: at(1) },
  wallSeconds: +((Date.now() - started) / 1000).toFixed(1),
  kept: Object.keys(kept.answers).length,
};
console.log(JSON.stringify(summary));
if (stopped !== undefined) {
  console.error(`Stopped before every request was answered: ${stopped}`);
  if (!/over --(limit|spend-up-to)/.test(stopped)) process.exitCode = 1;
}
if (ledger !== "") appendFileSync(ledger, `${JSON.stringify(summary)}\n`);
