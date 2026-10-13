import { describe, expect, it } from "vitest";
import type { CodeGraph, CodeFacts, EngineClient, GraphNode, JevRequest } from "@gaia/schema";
import { factsOf, landOf, standInJev } from "@gaia/world";
import { LOOKS } from "../renderer/terrain/looks.ts";
import proving from "../renderer/terrain/fixtures/proving.json";
import { openWorld } from "./open-world.ts";
import type { Opening } from "./protocol.ts";

/** The proving ground as the engine's graph gives it: its directories and entities, files, definitions and imports. */
function graphOf(m: CodeFacts): CodeGraph {
  const dirs = new Set<string>([""]);
  for (const f of m.files) for (let d = f.path; d.includes("/"); ) dirs.add((d = d.slice(0, d.lastIndexOf("/"))));
  const entities = new Map(m.entities.map((e) => [e.path, e]));
  const nodes: GraphNode[] = [
    ...[...dirs].map((path): GraphNode => {
      const e = entities.get(path);
      return { kind: "dir", id: `dir:${path}`, lineage: path, path, measures: { lines: 0 }, ...(e === undefined ? {} : { entity: { name: e.name, form: e.form, ...(e.entry === undefined ? {} : { entry: e.entry }) } }) };
    }),
    ...m.files.flatMap((f): GraphNode[] => [
      { kind: "file", id: `file:${f.path}`, lineage: f.path, path: f.path, language: f.language, bytes: 1, hash: "", binary: false, unparsed: 0, conventions: [], measures: { lines: f.lines } },
      ...f.symbols.map((s): GraphNode => ({ kind: "def", id: `def:${f.path}#${s.name}`, lineage: s.name, file: `file:${f.path}`, name: s.name, role: s.kind, span: { start: s.line ?? 1, end: (s.line ?? 1) + (s.lines ?? 1) - 1 }, signature: s.name, exported: s.exported, measures: { lines: s.lines ?? 1 } })),
    ]),
  ];
  const edges = m.files.flatMap((f) => f.imports.map((to) => ({ from: `file:${f.path}`, to: `file:${to}`, kind: "imports" as const, by: { by: "rule" as const } })));
  return { projectId: "proving", name: "proving", nodes, edges, pending: [] };
}
const graph = graphOf(proving as unknown as CodeFacts);
const facts = factsOf(graph);

/** An engine with Jev live and nothing kept, whose every batch of answers waits until `release` lets it go. */
function heldEngine(): { engine: EngineClient; held: (() => void)[] } {
  const standIn = standInJev(LOOKS);
  const held: (() => void)[] = [];
  const results: Record<string, (params: { requests: JevRequest[] }) => unknown> = {
    "store.read": () => ({ records: {} }),
    "store.get": () => null,
    "store.put": () => ({ ok: true }),
    "jev.status": () => ({ live: true, key: true }),
    "jev.estimate": ({ requests }) => ({ endpoint: "held", requests: requests.length, questions: 0, bytes: 0, estimatedTokens: 0, estimatedUsd: 0, usdPerMillionInputTokens: 0, concurrency: 8, live: true }),
    // The proving ground's graph, with nothing judged and nothing to understand.
    "project.graph": () => graph,
    "understanding.plan": () => ({
      pending: [],
      estimate: { endpoint: "held", requests: 0, questions: 0, bytes: 0, estimatedTokens: 0, estimatedUsd: 0, usdPerMillionInputTokens: 0, concurrency: 8, live: true },
    }),
  };
  const engine = {
    call: async (method: string, params: { requests: JevRequest[] }) => {
      if (method !== "jev.batch") return results[method]?.(params);
      await new Promise<void>((resolve) => held.push(resolve));
      return { responses: await Promise.all(params.requests.map((r) => standIn.ask(r))) };
    },
    on: () => () => {},
  } as unknown as EngineClient;
  return { engine, held };
}

/** Every file named by the `health` messages shown, with its vitality, in order. */
const named = (shown: readonly Opening[]): [string, number][] => shown.flatMap((o) => (o.stage === "health" ? Object.entries(o.vitality) : []));

describe("opening a world", () => {
  // The proving ground is laid out twice (its land, then the finished world): about a second on a busy machine.
  it("names each file's health once, as the finished world has it, only once its judging is done", { timeout: 20_000 }, async () => {
    const shown: Opening[] = [];
    const { engine, held } = heldEngine();
    let done = false;
    const opened = openWorld({ engine, root: "proving", consent: async () => true, progress: (o) => shown.push(o) }).finally(() => (done = true));
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    while (held.length === 0) await tick();

    // Before any answer: the land, every file's patch as the finished world lays it out, and no health yet, since a
    // file's vitality is Jev's quality.
    const land = shown.find((o) => o.stage === "land");
    expect(land?.stage === "land" && land.patches.map((p) => p.path)).toEqual(landOf(facts).patches.map((p) => p.path));
    expect(named(shown)).toEqual([]);

    while (!done) {
      for (const release of held.splice(0)) release();
      await tick();
    }
    const document = await opened;
    // Every file is named once, with the vitality the finished world gives it, before the document.
    const all = named(shown);
    expect(all.map(([path]) => path).sort()).toEqual(document.world.patches.map((p) => p.path).sort());
    expect(Object.fromEntries(all)).toEqual(Object.fromEntries(document.world.patches.map((p) => [p.path, p.vitality])));
  });
});
