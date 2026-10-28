// Judges and composes a project's world with Jev once, the way the app does,
// from its graph snapshot (`factsOf` of what `pnpm graph-snapshot` writes). It
// keeps the answers by request key, as the app keeps them per project, so the
// requests and cost of composing a world can be counted outside the app. Both
// files are outside the repository unless set otherwise (`SNAPSHOT`), because
// the repository keeps only the showcase's answers, which `pnpm showcase`
// writes. Kept answers are never requested again, so a run can stop early
// with --limit and finish later. Once a whole run has sent every request, it
// drops answers to requests the world no longer makes.
//
// Nothing reaches OpenRouter unless the judge is `jev`, the engine runs with
// GAIA_JEV=live, and --spend-up-to covers twice the engine's estimate of the
// looks and of composing, about two requests per thing (`composingEstimate`).
// Every request is priced before it is sent. One that would take the reported
// cost past --spend-up-to is not sent, and the run stops there, keeping what
// was answered.
//
// Usage: pnpm jev-world [--judge jev|local] [--limit 5]
//          [--spend-up-to 0.05] [--out jev.json] [--ledger ledger.jsonl]
//          [--graph graph.json]

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { CodeGraph, EngineClient, JevClient, JevResponse } from "@gaia/schema";
import { composeWorld, composingEstimate, factsOf, judgeWorld, keptJev, planForms, planWorldRequests, requestKey } from "@gaia/world";
import { createEngineClient } from "../app/world-service/engine-client.ts";
import { engineJev } from "../app/world-service/jev.ts";
import { LOOKS } from "../app/renderer/terrain/looks.ts";
import { startOpenRouterStandIn } from "./openrouter-stand-in.ts";
import { engineBinary } from "./engine-binary.ts";
import { cargoEnv } from "./cargo-env.ts";
import { fixtureJson } from "./fixture-json.ts";
import { SNAPSHOT } from "./snapshot-paths.ts";

const repo = resolve(import.meta.dirname, "..");
const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : (process.argv[i + 1] ?? fallback);
};
const judge = flag("judge", "local");
const limit = Number(flag("limit", "Infinity"));
const allowed = Number(flag("spend-up-to", "0"));
const out = resolve(flag("out", SNAPSHOT.answers));
const ledger = flag("ledger", "");
const graphFile = resolve(flag("graph", SNAPSHOT.graph));
if (!existsSync(graphFile)) throw new Error(`No graph snapshot at ${graphFile}: write one with \`GAIA_DATA_DIR=dir pnpm graph-snapshot\`, or pass --graph.`);
const graph = JSON.parse(readFileSync(graphFile, "utf8")) as CodeGraph;
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

// What this run would send: the look and form requests (`planWorldRequests`, `planForms`) with no kept answer, at
// most --limit of them.
const missing = [...planWorldRequests(facts, LOOKS), ...planForms(facts, LOOKS, { graph }).requests].filter((p) => kept.answers[requestKey(p.request)] === undefined);
const toSend = missing.slice(0, limit);
const estimate = await client.call("jev.estimate", { requests: toSend.map((p) => p.request) });
// Composing depends on those answers. It takes about two requests per thing, each priced as one that composes a tree,
// counted even if some are kept already, so the estimate is never low.
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
    // Every request is priced before it is sent, including composing's, which no plan counts ahead.
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
// Once a whole run has sent every request, drop answers to requests the world no longer makes, because their questions
// or options changed.
if (stopped === undefined) for (const key of Object.keys(kept.answers)) if (!asked.has(key)) delete kept.answers[key];
mkdirSync(dirname(out), { recursive: true });
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
