// Writes what Jev said about every folder, file and definition of Gaia's
// snapshot, for the journal in the lab (`fixtures/gaia-said.json`): each
// node's judgments from the engine's judged graph, as `project.graph` with
// `judged: true` returns it, with each block's lines carried over from the
// graph's commit to the snapshot's. A block is kept only where its lines are
// unchanged between the two, so no answer is ever drawn beside the wrong
// lines. Nothing is asked of Jev. Run it from a checkout that has both
// commits.
// Usage: pnpm journal-said <judged-graph.json> <graph-commit> [snapshot-commit] [out.json]

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CodeGraph, GraphNode, Judged, Span } from "@gaia/schema";

const repo = resolve(import.meta.dirname, "..");
const [graphPath, graphCommit, snapshotCommit = "1fe65bf", outPath] = process.argv.slice(2);
if (graphPath === undefined || graphCommit === undefined) throw new Error("Usage: pnpm journal-said <judged-graph.json> <graph-commit> [snapshot-commit] [out.json]");
const out = resolve(outPath ?? resolve(repo, "app/renderer/terrain/fixtures/gaia-said.json"));
const graph = JSON.parse(readFileSync(graphPath, "utf8")) as CodeGraph;

const textAt = (commit: string, path: string): string[] | null => {
  try {
    return execFileSync("git", ["show", `${commit}:${path}`], { cwd: repo, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .split("\n");
  } catch {
    return null;
  }
};

/** Each line of `from` that is unchanged in `to`, by number (1-based), through their longest common run of lines. */
function sameLines(from: readonly string[], to: readonly string[]): Map<number, number> {
  const same = new Map<number, number>();
  if (from.length === to.length && from.every((l, i) => l === to[i])) {
    for (let i = 1; i <= from.length; i++) same.set(i, i);
    return same;
  }
  const [n, m] = [from.length, to.length];
  const longest = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      longest[i * (m + 1) + j] = from[i] === to[j] ? (longest[(i + 1) * (m + 1) + j + 1] as number) + 1 : Math.max(longest[(i + 1) * (m + 1) + j] as number, longest[i * (m + 1) + j + 1] as number);
    }
  }
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (from[i] === to[j]) {
      same.set(i + 1, j + 1);
      i++;
      j++;
    } else if ((longest[(i + 1) * (m + 1) + j] as number) >= (longest[i * (m + 1) + j + 1] as number)) i++;
    else j++;
  }
  return same;
}

/**
 * A judgment as the journal shows it: its answers to two places, without the
 * calls that answered them or the options Jev gave no weight.
 */
const answersOf = (judged: Judged): Judged =>
  JSON.parse(
    JSON.stringify(judged, (key, value: unknown) => {
      if (key === "call") return undefined;
      if (typeof value === "number") return Math.round(value * 100) / 100;
      if (key === "p" && typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value as Record<string, number>).filter(([, p]) => p >= 0.005));
      return value;
    }),
  ) as Judged;

const pathOf = (node: GraphNode): string => (node.kind === "dir" || node.kind === "file" ? node.path : node.kind === "def" ? node.id.slice("def:".length) : "");
const fileOf = (node: GraphNode): string | null => (node.kind === "file" ? node.path : node.kind === "def" ? node.file.slice("file:".length) : null);

const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const lines = new Map<string, Map<number, number> | null>();
const carried = (file: string): Map<number, number> | null => {
  if (!lines.has(file)) {
    const [from, to] = [textAt(graphCommit, file), textAt(snapshotCommit, file)];
    lines.set(file, from === null || to === null ? null : sameLines(from, to));
  }
  return lines.get(file) ?? null;
};

const said: Record<string, { judged: Judged; lines?: Span }[]> = {};
let blocks = 0;
let dropped = 0;
for (const node of graph.nodes) {
  if (node.judged === undefined || Object.keys(node.judged).length === 0) continue;
  if (node.kind === "block") {
    const def = byId.get(node.def);
    const file = def === undefined ? null : fileOf(def);
    const same = file === null ? null : carried(file);
    const start = same?.get(node.span.start);
    // Every line of the block unchanged, and still one after another.
    const whole = start !== undefined && Array.from({ length: node.span.end - node.span.start + 1 }, (_, k) => same?.get(node.span.start + k) === start + k).every(Boolean);
    if (def === undefined || !whole || start === undefined) {
      dropped++;
      continue;
    }
    (said[pathOf(def)] ??= []).push({ judged: answersOf(node.judged), lines: { start, end: start + node.span.end - node.span.start } });
    blocks++;
    continue;
  }
  const file = fileOf(node);
  if (file !== null && carried(file) === null) continue;
  (said[pathOf(node)] ??= []).push({ judged: answersOf(node.judged) });
}
writeFileSync(out, `${JSON.stringify({ graph: graphCommit, snapshot: snapshotCommit, said })}\n`);
console.log(`${out}: ${Object.keys(said).length} nodes, ${blocks} blocks carried to ${snapshotCommit}, ${dropped} left out where their lines changed`);
