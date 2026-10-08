// Compares ways of building Jev's requests (`DESIGNS` in @gaia/world) on one
// codebase: how many requests and tokens each sends, how often its judgments
// differ from the first design's, question by question, against the noise of
// asking the same design twice and of reordering its options, and how many
// requests a one-line edit asks again. Nothing reaches OpenRouter unless the
// judge is `jev`, the engine runs with GAIA_JEV=live, and --spend-up-to
// covers the engine's own estimate.
//
// Usage: pnpm compare-jev [--judge stand-in|local|jev] [--designs first,revised,outline,escalate,shared,shared-outline,judged]
//          [--model fixture.json] [--repeat 2] [--spend-up-to 0.20] [--out report.json] [--keep-runs yes] [--ledger spend.jsonl]
//   stand-in: the deterministic stand-in judge, in process.
//   local:    the real engine binary, live, against a local stand-in for OpenRouter (proves the path).
//   jev:      the real engine binary and the Keychain's key: real answers, real cost.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { CodeModel, EngineClient, JevAnswer, JevClient, JevEstimate } from "@gaia/schema";
import { DESIGNS, type DesignName, type Exchange, MORE, SOURCE_WISH, judgeWorld, planWorldRequests, requestKey, standInJev, tokensOf } from "@gaia/world";
import { createEngineClient } from "../app/world-service/engine-client.ts";
import { engineJev } from "../app/world-service/jev.ts";
import { LOOKS } from "../app/renderer/terrain/looks.ts";
import { startOpenRouterStandIn } from "./openrouter-stand-in.ts";

const repo = resolve(import.meta.dirname, "..");
const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : (process.argv[i + 1] ?? fallback);
};
const judge = flag("judge", "stand-in");
const designs = flag("designs", "first,revised,outline,escalate,shared,shared-outline,judged").split(",") as DesignName[];
const repeat = Number(flag("repeat", judge === "stand-in" ? "1" : "2"));
const model = JSON.parse(readFileSync(resolve(flag("model", resolve(repo, "app/renderer/terrain/fixtures/gaia.json"))), "utf8")) as CodeModel;
for (const d of designs) if (!(d in DESIGNS)) throw new Error(`Unknown design ${d}; choose from ${Object.keys(DESIGNS).join(", ")}.`);

/** A question's family: what it judges, whatever thing it is about. */
const family = (id: string): string => (id.startsWith(MORE) ? "more" : id.replace(/:.*$/, ""));

/** The judged value of an answer: a choice's key, a score's top level, a noul's side of even odds. */
const valueOf = (a: JevAnswer | undefined): string => (a === undefined ? "" : a.type === "choice" ? a.choice : a.type === "noul" ? String(a.noul > 0.5) : String(Math.round(a.score)));

interface Run {
  readonly design: DesignName;
  readonly label: string;
  /** Each thing's exchange; a shared request's things each get their own. */
  readonly exchanges: Exchange[];
  /** What was actually sent: requests, the tokens OpenRouter billed (estimated for the stand-in), cost and each request's time. */
  readonly sent: { requests: number; tokens: number; ms: number[] };
  readonly costUsd: number;
}

/** Every judgment of a run, by thing and question: the final answer, after any second request. */
function judgments(run: Run): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of run.exchanges) {
    for (const id of Object.keys(e.first.request.questions)) {
      if (id.startsWith(MORE)) continue;
      // Building-or-landmark and its look were one choice in the first design: compare the thing that stands.
      const a = e.second?.answers[id] ?? e.first.answers[id];
      out.set(`${e.about}:${e.target}|${id}`, valueOf(a));
    }
    const stands = out.get(`${e.about}:${e.target}|stands`);
    if (stands === "building" || stands === "landmark") out.set(`${e.about}:${e.target}|stands`, `${stands}:${out.get(`${e.about}:${e.target}|${stands}`)}`);
    out.delete(`${e.about}:${e.target}|building`);
    out.delete(`${e.about}:${e.target}|landmark`);
  }
  return out;
}

/** The share of judgments, by question family, on which two runs differ. */
function differ(a: Run, b: Run): Record<string, { compared: number; differ: number }> {
  const ja = judgments(a);
  const jb = judgments(b);
  const out: Record<string, { compared: number; differ: number }> = {};
  for (const [key, v] of ja) {
    const w = jb.get(key);
    if (w === undefined) continue;
    const f = family(key.split("|")[1] as string);
    const o = (out[f] ??= { compared: 0, differ: 0 });
    o.compared++;
    if (v !== w) o.differ++;
  }
  return out;
}

// ---------- the judge ----------

/** What to stop once the runs are done: the engine process and the local stand-in. */
const started: { engine?: ChildProcess; standIn?: () => Promise<void> } = {};
function startEngine(env: Record<string, string>): EngineClient {
  const bin = resolve(repo, "target/release/gaia-engine");
  execFileSync("cargo", ["build", "-p", "gaia-engine", "--release", "--quiet"], { cwd: repo, env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` }, stdio: "inherit" });
  const child = spawn(bin, ["rpc"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
  const client = createEngineClient((line) => child.stdin?.write(`${line}\n`));
  if (child.stdout !== null) createInterface({ input: child.stdout }).on("line", (line) => client.receive(line));
  started.engine = child;
  return client;
}

async function judgeClient(): Promise<JevClient> {
  if (judge === "stand-in") return standInJev(LOOKS);
  if (judge === "local") {
    const standIn = await startOpenRouterStandIn({ delayMs: 0 });
    started.standIn = standIn.close;
    return engineJev(startEngine({ GAIA_JEV: "live", GAIA_JEV_ENDPOINT: standIn.endpoint }));
  }
  if (judge !== "jev") throw new Error(`Unknown judge ${judge}; choose stand-in, local or jev.`);
  // The cost guard: the engine's own estimate of every first request, doubled for second requests, must fit what was allowed.
  const client = startEngine({});
  const status = await client.call("jev.status", {});
  if (!status.live || !status.key) throw new Error("Jev needs GAIA_JEV=live and the gaia-openrouter key in the Keychain.");
  const first = designs.flatMap((d) => planWorldRequests(model, LOOKS, { design: d }).map((p) => p.request));
  const estimate: JevEstimate = await client.call("jev.estimate", { requests: first });
  const ceiling = estimate.estimatedUsd * 2 * (repeat + 1);
  const allowed = Number(flag("spend-up-to", "0"));
  console.error(`About $${ceiling.toFixed(4)} at most: ${designs.length} designs, ${repeat} runs each and one reordered, second requests included.`);
  if (!(allowed >= ceiling)) throw new Error(`Refusing to spend: pass --spend-up-to ${ceiling.toFixed(2)} or more to ask Jev.`);
  return engineJev(client);
}

// ---------- running ----------

const jev = await judgeClient();
const runs: Run[] = [];
try {
  for (const design of designs) {
    for (let i = 0; i < repeat + 1; i++) {
      // The last run of each design reorders every question's options: how much does order sway the answer?
      const reordered = i === repeat;
      if (reordered && judge === "stand-in") continue;
      const exchanges: Exchange[] = [];
      let costUsd = 0;
      const sent = { requests: 0, tokens: 0, ms: [] as number[] };
      const counted: JevClient = {
        async ask(request) {
          const r = await jev.ask(request);
          costUsd += r.costUsd;
          sent.requests++;
          sent.tokens += r.inputTokens ?? tokensOf(request);
          sent.ms.push(r.ms);
          return r;
        },
      };
      await judgeWorld(model, LOOKS, counted, { design, trace: (e) => exchanges.push(e), ...(reordered ? { shuffle: "reordered" } : {}) });
      runs.push({ design, label: reordered ? `${design} reordered` : `${design} #${i + 1}`, exchanges, sent, costUsd });
    }
  }
} finally {
  started.engine?.kill();
  await started.standIn?.();
}

// ---------- what a one-line edit asks again ----------

/** Requests whose key changes when one file grows by a line at its top, and their tokens, averaged over every source file. */
function reasksPerEdit(design: DesignName): { requests: number; tokens: number } {
  const before = new Set(planWorldRequests(model, LOOKS, { design }).map((p) => requestKey(p.request)));
  const sources = model.files.filter((f) => (f.kind ?? "source") === "source");
  let changed = 0;
  let tokens = 0;
  for (const f of sources) {
    const owner = model.entities.filter((e) => e.path === "" || f.path.startsWith(`${e.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
    const edited: CodeModel = {
      ...model,
      repository: { ...model.repository, lines: model.repository.lines + 1 },
      files: model.files.map((x) => (x === f ? { ...x, lines: x.lines + 1, symbols: x.symbols.map((s) => ({ ...s, ...(s.line === undefined ? {} : { line: s.line + 1 }) })) } : x)),
      entities: model.entities.map((e) => (e === owner ? { ...e, lines: e.lines + 1 } : e)),
    };
    const again = planWorldRequests(edited, LOOKS, { design }).filter((p) => !before.has(requestKey(p.request)));
    changed += again.length;
    tokens += again.reduce((n, p) => n + tokensOf(p.request), 0);
  }
  return { requests: changed / Math.max(1, sources.length), tokens: tokens / Math.max(1, sources.length) };
}

// ---------- the report ----------

const pct = (n: number, of: number): string => (of === 0 ? "-" : `${((100 * n) / of).toFixed(0)}%`);
const report = designs.map((design) => {
  const mine = runs.filter((r) => r.design === design);
  const run = mine[0] as Run;
  const planned = planWorldRequests(model, LOOKS, { design });
  const seconds = run.exchanges.filter((e) => e.second !== undefined);
  const ms = [...run.sent.ms].sort((a, b) => a - b);
  const wishes = run.exchanges.filter((e) => e.first.answers[SOURCE_WISH]?.type === "noul" && (e.first.answers[SOURCE_WISH] as { noul: number }).noul > 0.5).length;
  const read: Record<string, number> = {};
  for (const e of seconds) for (const id of e.second!.read) read[id] = (read[id] ?? 0) + 1;
  const certainties = run.exchanges.flatMap((e) => Object.entries(e.first.answers).filter(([id, a]) => !id.startsWith(MORE) && a.type === "choice").map(([, a]) => (a as { confidence: number }).confidence));
  return {
    design,
    planned: { requests: planned.length, questions: planned.reduce((n, p) => n + Object.keys(p.request.questions).length, 0), tokens: planned.reduce((n, p) => n + tokensOf(p.request), 0), largestRequestTokens: Math.max(...planned.map((p) => tokensOf(p.request))) },
    sent: { requests: run.sent.requests, secondRequests: seconds.length, tokens: run.sent.tokens, costUsd: run.costUsd, msP50: ms[Math.floor(ms.length / 2)] ?? 0, msP90: ms[Math.floor(ms.length * 0.9)] ?? 0 },
    readings: read,
    wouldReadSource: wishes,
    meanChoiceConfidence: certainties.reduce((a, b) => a + b, 0) / Math.max(1, certainties.length),
    reasksPerEdit: reasksPerEdit(design),
    differsFromFirst: design === designs[0] ? undefined : differ(runs.find((r) => r.design === designs[0]) as Run, run),
    noise: mine.length > 1 && !mine[1]!.label.includes("reordered") ? differ(run, mine[1] as Run) : undefined,
    reordered: mine.find((r) => r.label.includes("reordered")) === undefined ? undefined : differ(run, mine.find((r) => r.label.includes("reordered")) as Run),
  };
});

const lines: string[] = [`Judge: ${judge}. ${model.repository.name}: ${model.files.length} files, ${model.entities.length} entities.`];
for (const r of report) {
  lines.push(
    `\n${r.design}: ${r.planned.requests} requests planned, ${r.planned.questions} questions, about ${r.planned.tokens.toLocaleString("en-US")} tokens (largest ${r.planned.largestRequestTokens.toLocaleString("en-US")})`,
    `  sent ${r.sent.requests} requests (${r.sent.secondRequests} second), ${r.sent.tokens.toLocaleString("en-US")} tokens, $${r.sent.costUsd.toFixed(4)} reported, ${r.sent.msP50} ms median (p90 ${r.sent.msP90}); mean choice confidence ${r.meanChoiceConfidence.toFixed(2)}`,
    `  a one-line edit asks ${r.reasksPerEdit.requests.toFixed(2)} requests again (about ${Math.round(r.reasksPerEdit.tokens).toLocaleString("en-US")} tokens)${Object.keys(r.readings).length === 0 ? "" : `; second requests read ${Object.entries(r.readings).map(([k, n]) => `${k} ${n}`).join(", ")}; ${r.wouldReadSource} files would read source`}`,
  );
  const show = (name: string, d: Record<string, { compared: number; differ: number }> | undefined): void => {
    if (d !== undefined) lines.push(`  ${name}: ${Object.entries(d).map(([f, x]) => `${f} ${pct(x.differ, x.compared)} of ${x.compared}`).join(", ")}`);
  };
  show("differs from first", r.differsFromFirst);
  show("same design asked again", r.noise);
  show("options reordered", r.reordered);
}
console.log(lines.join("\n"));
const out = flag("out", "");
if (out !== "") writeFileSync(out, `${JSON.stringify({ judge, report, runs: flag("keep-runs", "") === "" ? undefined : runs.map((r) => ({ label: r.label, exchanges: r.exchanges })) }, null, 2)}\n`);
const ledger = flag("ledger", "");
if (ledger !== "") {
  const spent = runs.reduce((n, r) => n + r.costUsd, 0);
  appendFileSync(ledger, `${JSON.stringify({ time: new Date().toISOString(), what: `compare-jev ${designs.join(",")} x${repeat}+reordered (${judge})`, requests: runs.reduce((n, r) => n + r.sent.requests, 0), inputTokens: runs.reduce((n, r) => n + r.sent.tokens, 0), reportedUsd: +spent.toFixed(6) })}\n`);
}
