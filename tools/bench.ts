// pnpm bench: the engine's code graph of every repository on the bench
// (tools/bench/repos.json), each at a pinned commit, and what the parse
// found and how long it took. Remote repositories are cloned with the
// engine's own project.clone into node_modules/.cache/gaia-bench, so the
// app's data is never touched. Each graph is built by a fresh engine, so the
// time is a cold start's.
// Usage: pnpm bench [name …] [--out results.json]
//        pnpm bench --replay name FROM TO [--monthly]
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
import type { Cloned, CodeGraph } from "@gaia/schema";

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
const chosen = replayAt >= 0 ? [] : names.length > 0 ? repos.filter((r) => names.includes(r.name)) : repos;

execFileSync("cargo", ["build", "-p", "gaia-engine", "--release", "--quiet"], { cwd: repo, env, stdio: "inherit" });
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
