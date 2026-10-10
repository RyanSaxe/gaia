// pnpm bench: the engine's code graph of every repository on the bench
// (tools/bench/repos.json), each at a pinned commit, and what the parse
// found and how long it took. Remote repositories are cloned with the
// engine's own project.clone into node_modules/.cache/gaia-bench, so the
// app's data is never touched. Each graph is built by a fresh engine, so the
// time is a cold start's.
// Usage: pnpm bench [name …] [--out results.json]
//        pnpm bench --replay name FROM TO [--monthly]
//        GAIA_JEV=live pnpm bench --understand [name …] [--plan]
//        pnpm bench --calibrate
//        GAIA_JEV=live pnpm bench --mutate [name …] [--plan]
//
// --understand asks Jev's calls about each repository through the engine's
// runner, keeping answers in the bench's store, so a second run sends only
// what changed. It reports what was sent and billed, and how the stand
// scores of definitions spread over their levels. --plan only estimates.
//
// --calibrate reports how every question's held answers spread on the
// held-out half. --mutate makes the calibration set's mutations of each
// repository (the held-out half by default) with gaia-engine mutate, asks
// Jev about the original and mutant copies, and reports how often each
// mutation moved the question it targets and how far the others moved.
//
// A replay opens the repository at each commit from FROM to TO along its
// first parents (one a month with --monthly), carrying lineage from one to
// the next in a store of its own, and reports how many of FROM's
// definitions keep their identity at TO: by id alone, and by lineage.

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Cloned, CodeGraph, UnderstandPlan, UnderstandProgress } from "@gaia/schema";

interface Repo {
  readonly name: string;
  /** A folder in this repository, for Gaia itself. */
  readonly root?: string;
  readonly address?: string;
  readonly commit?: string;
}

const repo = resolve(import.meta.dirname, "..");
const env = {
  ...process.env,
  PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
  GAIA_DATA_DIR: resolve(repo, "node_modules/.cache/gaia-bench"),
};
const engine = resolve(repo, "target/release/gaia-engine");

/** One request to a fresh engine, and how long it took to answer. */
async function call<T>(method: string, params: object, dataDir?: string): Promise<{ result: T; ms: number }> {
  const childEnv = dataDir === undefined ? env : { ...env, GAIA_DATA_DIR: dataDir };
  const child = spawn(engine, ["rpc"], { env: childEnv, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout });
  const t0 = performance.now();
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`);
  for await (const line of lines) {
    const ms = performance.now() - t0;
    child.stdin.end();
    const response = JSON.parse(line) as { result?: T; error?: { message: string } };
    if (response.result === undefined) throw new Error(`${method}: ${response.error?.message ?? "no answer"}`);
    return { result: response.result, ms };
  }
  throw new Error(`${method}: the engine closed without answering`);
}

/** The repository's folder, cloned and at its pinned commit. */
async function rootOf(r: Repo): Promise<string> {
  if (r.root !== undefined) return resolve(repo, r.root);
  if (r.address === undefined || r.commit === undefined) throw new Error(`${r.name} needs a root, or an address and a commit`);
  const { result } = await call<Cloned>("project.clone", { address: r.address });
  if (!result.cloned) throw new Error(`${r.name} could not be cloned: ${result.why}`);
  const git = (...args: string[]): void => void execFileSync("git", ["-C", result.root, ...args], { stdio: "ignore" });
  try {
    git("cat-file", "-e", `${r.commit}^{commit}`);
  } catch {
    git("fetch", "--quiet", "origin", r.commit);
  }
  git("-c", "advice.detachedHead=false", "checkout", "--quiet", r.commit);
  return result.root;
}

const tally = <T>(items: readonly T[], key: (t: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
};
const words = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .map(([k, n]) => `${k} ${n.toLocaleString("en")}`)
    .join(", ");

function measure(graph: CodeGraph, ms: number) {
  const files = graph.nodes.flatMap((n) => (n.kind === "file" ? [n] : []));
  const defs = graph.nodes.flatMap((n) => (n.kind === "def" ? [n] : []));
  const blocks = graph.nodes.flatMap((n) => (n.kind === "block" ? [n] : []));
  return {
    ms: Math.round(ms),
    files: files.length,
    languages: tally(files, (f) => f.language ?? "no grammar"),
    definitions: defs.length,
    roles: tally(defs, (d) => d.role),
    blocks: tally(blocks, (b) => b.shape),
    pending: tally(graph.pending, (p) => p.kind),
    edges: tally(graph.edges, (e) => `${e.kind} by ${e.by.by}`),
    unparsed: files.reduce((n, f) => n + f.unparsed, 0),
    unparsedFiles: files.filter((f) => f.unparsed > 0).map((f) => f.path),
    conventions: tally(
      files.flatMap((f) => f.conventions),
      (c) => c,
    ),
  };
}

/** One engine kept open for a run of requests, as the app keeps it. */
function session() {
  const child = spawn(engine, ["rpc"], { env, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout });
  const waiting = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>();
  lines.on("line", (line) => {
    const r = JSON.parse(line) as { id: number; result?: unknown; error?: { message: string } };
    waiting.get(r.id)?.(r);
    waiting.delete(r.id);
  });
  let id = 0;
  return {
    call<T>(method: string, params: object): Promise<T> {
      const n = ++id;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`);
      return new Promise((done, fail) => waiting.set(n, (r) => (r.result === undefined ? fail(new Error(`${method}: ${r.error?.message}`)) : done(r.result as T))));
    },
    close: () => child.stdin.end(),
  };
}

/** Asks Jev's calls about a repository, and reports what it cost and how stand spreads. */
async function understandRepo(r: Repo, planOnly: boolean): Promise<void> {
  const root = await rootOf(r);
  const engine = session();
  const usd = (records: Record<string, { costUsd?: number }>): number => Object.values(records).reduce((n, v) => n + (v.costUsd ?? 0), 0);
  try {
    const plan = await engine.call<UnderstandPlan>("understand.plan", { root });
    const pendingRequests = plan.pending.reduce((n, p) => n + p.requests, 0);
    const kept = plan.pending.reduce((n, p) => n + p.kept, 0);
    console.log(`${r.name}: ${pendingRequests} requests to send, ${kept} kept; estimated $${plan.estimate.estimatedUsd.toFixed(4)}, priced by what Jev billed this project so far`);
    if (planOnly) return;
    const graph0 = await engine.call<CodeGraph>("project.graph", { root });
    const before = usd((await engine.call<{ records: Record<string, { costUsd?: number }> }>("store.read", { project: graph0.projectId, table: "calls" })).records);
    let sent = 0;
    let failed = 0;
    const t0 = performance.now();
    const drain = async (): Promise<void> => {
      for (;;) {
        const p = await engine.call<UnderstandProgress>("understand.next", { root });
        sent += p.sent;
        failed += p.failed;
        if (p.left === 0 || p.sent === 0) break;
      }
    };
    await drain();
    // Until the world has its rule for what stands, the bench deepens the top fifth of the screened nodes.
    const screened = (await engine.call<CodeGraph>("project.graph", { root, judged: true })).nodes.flatMap((n) =>
      (n.kind === "def" || n.kind === "block") && n.judged?.stand !== undefined ? [{ id: n.id, stand: n.judged.stand.score }] : [],
    );
    const chosen = screened.sort((a, b) => b.stand - a.stand).slice(0, Math.ceil(screened.length / 5)).map((n) => n.id);
    await engine.call("understand.deepen", { root, nodes: chosen });
    await drain();
    const seconds = (performance.now() - t0) / 1000;
    const graph = await engine.call<CodeGraph>("project.graph", { root, judged: true });
    const after = usd((await engine.call<{ records: Record<string, { costUsd?: number }> }>("store.read", { project: graph.projectId, table: "calls" })).records);
    const stands = graph.nodes.flatMap((n) => (n.kind === "def" && n.judged?.stand !== undefined ? [n.judged.stand.score] : []));
    const levels = [0, 0, 0, 0, 0];
    for (const s of stands) levels[Math.min(4, Math.max(0, Math.round(s)))] = (levels[Math.min(4, Math.max(0, Math.round(s)))] ?? 0) + 1;
    const mean = stands.reduce((a, b) => a + b, 0) / Math.max(1, stands.length);
    console.log(`  sent ${sent}, failed ${failed}, ${seconds.toFixed(1)} s, billed $${(after - before).toFixed(4)}`);
    console.log(`  stand over ${stands.length} definitions, plumbing to landmark: ${levels.join(" / ")}; mean ${mean.toFixed(2)}; largest level ${Math.round((100 * Math.max(...levels)) / Math.max(1, stands.length))}%`);
  } finally {
    engine.close();
  }
}

/** Ranks with ties averaged, for a rank correlation. */
function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length).fill(0);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.[0] === order[i]?.[0]) j++;
    for (let k = i; k <= j; k++) out[order[k]?.[1] ?? 0] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}
function spearman(a: readonly number[], b: readonly number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (v: number[]): number => v.reduce((x, y) => x + y, 0) / Math.max(1, v.length);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += ((ra[i] ?? 0) - ma) * ((rb[i] ?? 0) - mb);
    da += ((ra[i] ?? 0) - ma) ** 2;
    db += ((rb[i] ?? 0) - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/**
 * The calibration measures, from the answers the bench's store holds, on
 * the held-out half of tools/bench/calibration/split.json (round 6,
 * calibration page). Spread and overlap for stand; profile's kinds against
 * each ecosystem's test conventions. Caught and bleed need the quality
 * questions and their mutations, which come with step 4.
 */
async function calibrate(): Promise<void> {
  const split = JSON.parse(readFileSync(resolve(repo, "tools/bench/calibration/split.json"), "utf8")) as { fit: string[]; heldOut: string[] };
  type Seen = { score: number; value: number; lines?: number; cognitive?: number };
  const scores = new Map<string, Seen[]>();
  const choices = new Map<string, Map<string, number>>();
  const yesNo = new Map<string, number[]>();
  let tests = 0;
  let testsAgree = 0;
  for (const name of split.heldOut) {
    const r = repos.find((x) => x.name === name);
    if (r === undefined) continue;
    const { result: graph } = await call<CodeGraph>("project.graph", { root: await rootOf(r), judged: true });
    if (!graph.nodes.some((n) => n.judged !== undefined)) {
      console.log(`${name}: no answers yet; run pnpm bench --understand ${name} first`);
      continue;
    }
    for (const n of graph.nodes) {
      // Overlap is measured only on code that makes at least one decision, so trivial functions can't inflate it.
      const deciding = (n.kind === "def" || n.kind === "block") && (n.measures.cyclomatic ?? 1) >= 2;
      const visit = (question: string, a: unknown): void => {
        if (typeof a !== "object" || a === null) return;
        const o = a as Record<string, unknown>;
        if (typeof o.score === "number" && typeof o.value === "number") {
          const seen: Seen = { score: o.score, value: o.value, ...(deciding ? { lines: n.measures.lines, cognitive: n.measures.cognitive ?? 0 } : {}) };
          scores.set(question, [...(scores.get(question) ?? []), seen]);
        } else if (typeof o.choice === "string") {
          const c = choices.get(question) ?? new Map<string, number>();
          c.set(o.choice, (c.get(o.choice) ?? 0) + 1);
          choices.set(question, c);
        } else if (typeof o.p === "number" && typeof o.call === "string") {
          yesNo.set(question, [...(yesNo.get(question) ?? []), o.p]);
        } else {
          for (const [k, v] of Object.entries(o)) visit(`${question}.${k}`, v);
        }
      };
      for (const [k, v] of Object.entries(n.judged ?? {})) visit(`${n.kind}.${k}`, v);
    }
    const files = graph.nodes.flatMap((n) => (n.kind === "file" && n.judged?.kind !== undefined && n.conventions.some((c) => /test|spec/.test(c)) ? [n] : []));
    tests += files.length;
    testsAgree += files.filter((f) => ["test", "test support"].includes(f.judged?.kind?.choice ?? "")).length;
  }
  const pct = (n: number, of: number): string => `${Math.round((100 * n) / Math.max(1, of))}%`;
  console.log(`held out (${split.heldOut.join(", ")}); to pass: no level over 60%, every level used, values' 10th to 90th percentiles 0.5 apart, overlap under 0.8`);
  for (const [question, seen] of [...scores].sort(([a], [b]) => a.localeCompare(b))) {
    // The number of levels, from any answer whose value is above zero: value = score / top.
    const top = Math.round(Math.max(...seen.map((x) => (x.value > 0 ? x.score / x.value : 0))));
    const levels = Array.from({ length: top + 1 }, (_, l) => seen.filter((x) => Math.round(x.score) === l).length);
    const largest = Math.max(...levels) / seen.length;
    const values = seen.map((x) => x.value).sort((a, b) => a - b);
    const at = (q: number): number => values[Math.floor(q * (values.length - 1))] ?? 0;
    const apart = at(0.9) - at(0.1);
    const measured = seen.filter((x) => x.lines !== undefined);
    const overlap =
      measured.length >= 20
        ? `; overlap with lines ${spearman(measured.map((x) => x.score), measured.map((x) => x.lines ?? 0)).toFixed(2)}, cognitive ${spearman(measured.map((x) => x.score), measured.map((x) => x.cognitive ?? 0)).toFixed(2)} on ${measured.length}`
        : "";
    const fails = [largest > 0.6 && "a level over 60%", levels.some((l) => l === 0) && "a level unused", apart < 0.5 && "percentiles close"].filter(Boolean);
    console.log(`  ${question}: ${seen.length} answers, ${levels.map((l) => pct(l, seen.length)).join(" / ")}; percentiles ${apart.toFixed(2)} apart${overlap}; ${fails.length === 0 ? "passes spread" : `fails: ${fails.join(", ")}`}`);
  }
  for (const [question, c] of [...choices].sort(([a], [b]) => a.localeCompare(b))) {
    const total = [...c.values()].reduce((a, b) => a + b, 0);
    const [first, n] = [...c].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    console.log(`  ${question}: ${total} answers over ${c.size} options, the most "${first}" at ${pct(n, total)}`);
  }
  for (const [question, ps] of [...yesNo].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${question}: ${ps.length} answers, yes in ${pct(ps.filter((p) => p >= 0.5).length, ps.length)}`);
  }
  console.log(`held out, files a test convention names that profile judged a test: ${testsAgree} of ${tests}`);
}

/** One mutation, as `gaia-engine mutate` lists it. */
interface Mutation {
  readonly kind: string;
  readonly def: string;
  readonly file: string;
  readonly moves: string;
  readonly toward: "lower" | string;
  readonly leaves: readonly string[];
}

/**
 * Asks Jev about each mutation's original and mutant copies, as separate
 * projects with only the mutated files, and reports the calibration page's
 * caught and bleed for each kind.
 */
async function mutations(names: readonly string[], planOnly: boolean): Promise<void> {
  const split = JSON.parse(readFileSync(resolve(repo, "tools/bench/calibration/split.json"), "utf8")) as { heldOut: string[] };
  const picked = repos.filter((r) => (names.length > 0 ? names : split.heldOut).includes(r.name));
  type Seen = { mutation: Mutation; before: unknown; after: unknown; leaves: [unknown, unknown][] };
  const seen: Seen[] = [];
  const at = (graph: CodeGraph, def: string, field: string): unknown => {
    const node = graph.nodes.find((n) => n.id === def);
    return field.split(".").reduce<unknown>((o, k) => (typeof o === "object" && o !== null ? (o as Record<string, unknown>)[k] : undefined), node?.judged);
  };
  for (const r of picked) {
    const out = resolve(repo, "node_modules/.cache/gaia-bench/mutants", r.name);
    const listed = JSON.parse(execFileSync(engine, ["mutate", await rootOf(r), out, "20"], { env, encoding: "utf8" })) as { mutations: Mutation[] };
    for (const kind of [...new Set(listed.mutations.map((m) => m.kind))]) {
      const mine = listed.mutations.filter((m) => m.kind === kind);
      const graphs: CodeGraph[] = [];
      for (const side of ["original", "mutant"]) {
        const root = resolve(out, kind, side);
        const engineSession = session();
        try {
          const plan = await engineSession.call<UnderstandPlan>("understand.plan", { root });
          console.log(`${r.name} ${kind} ${side}: ${plan.pending.reduce((n, p) => n + p.requests, 0)} requests to send now; estimated $${plan.estimate.estimatedUsd.toFixed(4)}`);
          if (planOnly) continue;
          const drain = async (): Promise<void> => {
            for (;;) {
              const p = await engineSession.call<UnderstandProgress>("understand.next", { root });
              if (p.left === 0 || p.sent === 0) break;
            }
          };
          await drain();
          await engineSession.call("understand.deepen", { root, nodes: mine.map((m) => m.def) });
          await drain();
          graphs.push(await engineSession.call<CodeGraph>("project.graph", { root, judged: true }));
        } finally {
          engineSession.close();
        }
      }
      const [original, mutant] = graphs;
      if (original === undefined || mutant === undefined) continue;
      for (const m of mine) {
        seen.push({ mutation: m, before: at(original, m.def, m.moves), after: at(mutant, m.def, m.moves), leaves: m.leaves.map((l) => [at(original, m.def, l), at(mutant, m.def, l)]) });
      }
    }
  }
  if (planOnly) return;
  const score = (a: unknown): number | undefined => (typeof a === "object" && a !== null && typeof (a as { score?: unknown }).score === "number" ? (a as { score: number }).score : undefined);
  const choice = (a: unknown): string | undefined => (typeof a === "object" && a !== null ? (a as { choice?: string }).choice : undefined);
  console.log("caught: the targeted question worse in at least 90%, by 0.5 levels on average; bleed: the others move under 0.2 levels on average");
  for (const kind of [...new Set(seen.map((s) => s.mutation.kind))]) {
    const mine = seen.filter((s) => s.mutation.kind === kind);
    const answered = mine.filter((s) => s.before !== undefined && s.after !== undefined);
    let caught = 0;
    const drops: number[] = [];
    for (const s of answered) {
      if (s.mutation.toward === "lower") {
        const [b, a] = [score(s.before), score(s.after)];
        if (b === undefined || a === undefined) continue;
        drops.push(b - a);
        if (a < b) caught++;
      } else if (choice(s.after) === s.mutation.toward && choice(s.before) !== s.mutation.toward) {
        caught++;
      }
    }
    const moved = mine.flatMap((s) => s.leaves.flatMap(([b, a]) => (score(b) !== undefined && score(a) !== undefined ? [Math.abs((score(a) ?? 0) - (score(b) ?? 0))] : [])));
    const mean = (xs: number[]): string => (xs.length === 0 ? "-" : (xs.reduce((x, y) => x + y, 0) / xs.length).toFixed(2));
    console.log(
      `  ${kind}: ${answered.length} of ${mine.length} answered; caught ${caught} (${Math.round((100 * caught) / Math.max(1, answered.length))}%)` +
        `${drops.length > 0 ? `, mean drop ${mean(drops)} levels` : ""}; bleed ${mean(moved)} levels over ${moved.length} answers`,
    );
  }
}

/** Replays a repository's history and reports what keeps its identity. */
async function replay(r: Repo, from: string, to: string, monthly: boolean): Promise<void> {
  const root = await rootOf(r);
  const git = (...a: string[]): string => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" }).trim();
  const fromSha = git("rev-parse", from);
  let commits = [fromSha, ...git("rev-list", "--first-parent", "--reverse", `${fromSha}..${to}`).split("\n").filter(Boolean)];
  if (monthly) {
    const picked: string[] = [];
    let last = -Infinity;
    for (const c of commits) {
      const at = Number(git("show", "-s", "--format=%ct", c));
      if (at - last >= 30 * 86_400 || c === commits.at(-1)) {
        picked.push(c);
        last = at;
      }
    }
    commits = picked;
  }
  const store = mkdtempSync(resolve(tmpdir(), "gaia-replay-"));
  const defsAt: { id: string; qualified: string; lineage: string }[][] = [];
  try {
    for (const c of commits) {
      git("-c", "advice.detachedHead=false", "checkout", "--quiet", c);
      const { result } = await call<CodeGraph>("project.graph", { root }, store);
      defsAt.push(
        result.nodes.flatMap((n) => (n.kind === "def" ? [{ id: n.id, qualified: n.id.split("#").slice(1).join("#"), lineage: n.lineage }] : [])),
      );
    }
  } finally {
    rmSync(store, { recursive: true, force: true });
    if (r.commit !== undefined) git("-c", "advice.detachedHead=false", "checkout", "--quiet", r.commit);
  }
  const first = defsAt[0] ?? [];
  const last = defsAt.at(-1) ?? [];
  const ids = new Set(last.map((d) => d.id));
  const lineages = new Set(last.map((d) => d.lineage));
  const names = new Set(last.map((d) => d.qualified));
  // A definition survives when its qualified name still exists somewhere, wherever it moved.
  const surviving = first.filter((d) => names.has(d.qualified));
  const pct = (n: number, of: number): string => `${of === 0 ? 0 : Math.round((100 * n) / of)}%`;
  const byId = first.filter((d) => ids.has(d.id)).length;
  const byLineage = surviving.filter((d) => lineages.has(d.lineage)).length;
  console.log(`${r.name}, ${commits.length} commits from ${fromSha.slice(0, 7)} to ${to.slice(0, 7)}:`);
  console.log(`  ${first.length} definitions at the start; ${surviving.length} still exist by qualified name`);
  console.log(`  same id: ${byId} (${pct(byId, first.length)}); surviving with their lineage: ${byLineage} of ${surviving.length} (${pct(byLineage, surviving.length)})`);
}

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args[outAt + 1] : undefined;
const names = args.filter((a, i) => !a.startsWith("--") && (outAt < 0 || i !== outAt + 1));
const { repos } = JSON.parse(readFileSync(resolve(repo, "tools/bench/repos.json"), "utf8")) as { repos: Repo[] };
const replayAt = args.indexOf("--replay");
const understanding = args.includes("--understand");
const calibrating = args.includes("--calibrate");
const mutating = args.includes("--mutate");
const picked = names.length > 0 ? repos.filter((r) => names.includes(r.name)) : repos;
const chosen = replayAt >= 0 || understanding || calibrating || mutating ? [] : picked;

execFileSync("cargo", ["build", "-p", "gaia-engine", "--release", "--quiet"], { cwd: repo, env, stdio: "inherit" });
if (calibrating) await calibrate();
if (mutating) await mutations(names, args.includes("--plan"));
if (understanding) {
  for (const r of picked) await understandRepo(r, args.includes("--plan"));
}
if (replayAt >= 0) {
  const [name, from, to] = args.slice(replayAt + 1, replayAt + 4);
  const r = repos.find((x) => x.name === name);
  if (r === undefined || from === undefined || to === undefined) throw new Error("Usage: pnpm bench --replay name FROM TO [--monthly]");
  await replay(r, from, to, args.includes("--monthly"));
}
const results: Record<string, ReturnType<typeof measure>> = {};
for (const r of chosen) {
  const root = await rootOf(r);
  const { result, ms } = await call<CodeGraph>("project.graph", { root });
  const m = measure(result, ms);
  results[r.name] = m;
  const blocks = Object.values(m.blocks).reduce((a, b) => a + b, 0);
  console.log(
    `${r.name}: ${m.files} files, ${m.definitions.toLocaleString("en")} definitions, ${blocks.toLocaleString("en")} blocks, ` +
      `${m.pending.import ?? 0} imports and ${(m.pending.call ?? 0).toLocaleString("en")} calls pending, ` +
      `${m.unparsed} unparsed in ${m.unparsedFiles.length} files, ${(m.ms / 1000).toFixed(2)} s`,
  );
  console.log(`  languages: ${words(m.languages)}`);
  console.log(`  definitions: ${words(m.roles)}`);
  console.log(`  blocks: ${words(m.blocks)}`);
  console.log(`  edges: ${words(m.edges)}`);
  if (Object.keys(m.conventions).length > 0) console.log(`  conventions: ${words(m.conventions)}`);
}
if (out !== undefined) writeFileSync(resolve(out), `${JSON.stringify(results, null, 2)}\n`);
