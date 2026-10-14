import { describe, expect, it } from "vitest";
import type { CodeGraph, CodeFacts, EngineClient, GraphNode, JevRequest } from "@gaia/schema";
import { composeWorld, factsOf, judgeWorld, keptJev, landOf, standInJev } from "@gaia/world";
import { LOOKS } from "../renderer/terrain/looks.ts";
import proving from "../renderer/terrain/fixtures/proving.json";
import { LIMIT_KEY, openWorld } from "./open-world.ts";
import type { Opening } from "./protocol.ts";

/** The proving ground as the engine's graph gives it, read from a commit: its directories and entities, files, definitions and imports. */
function graphOf(m: CodeFacts): CodeGraph {
  const dirs = new Set<string>([""]);
  for (const f of m.files) for (let d = f.path; d.includes("/"); ) dirs.add((d = d.slice(0, d.lastIndexOf("/"))));
  const entities = new Map(m.entities.map((e) => [e.path, e]));
  const nodes: GraphNode[] = [
    ...[...dirs].map((path): GraphNode => {
      const e = entities.get(path);
      return { kind: "dir", id: `dir:${path}`, lineage: path, path, measures: { lines: 0 }, ...(e === undefined ? {} : { entity: { name: e.name, form: e.form, manifest: e.manifest, ...(e.entry === undefined ? {} : { entry: e.entry }) } }) };
    }),
    ...m.files.flatMap((f): GraphNode[] => [
      { kind: "file", id: `file:${f.path}`, lineage: f.path, path: f.path, language: f.language, bytes: 1, hash: "", binary: false, unparsed: 0, conventions: [], measures: { lines: f.lines } },
      ...f.symbols.map((s): GraphNode => ({ kind: "def", id: `def:${f.path}#${s.name}`, lineage: s.name, file: `file:${f.path}`, name: s.name, role: s.kind, span: { start: s.line ?? 1, end: (s.line ?? 1) + (s.lines ?? 1) - 1 }, signature: s.name, exported: s.exported, measures: { lines: s.lines ?? 1 } })),
    ]),
  ];
  const edges = m.files.flatMap((f) => f.imports.map((to) => ({ from: `file:${f.path}`, to: `file:${to}`, kind: "imports" as const, by: { by: "rule" as const } })));
  return { projectId: "proving", name: "proving", commit: "c0ffee", nodes, edges, pending: [] };
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
    "understanding.next": () => ({ sent: 0, failed: 0, failures: [], left: 0, settled: [], quality: {} }),
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

/**
 * An engine with nothing kept that answers at once: Jev live with a key unless `status` says otherwise, each batch
 * answered by `answer` (Jev's answers, as the test plays them), and the person's spend limit `limitUsd` against an
 * estimate of `estimateUsd`. `batches` counts what went to Jev.
 */
function engineWith(o: { status?: { live: boolean; key: boolean }; answer?: (r: JevRequest) => unknown; limitUsd?: number; estimateUsd?: number; kept?: Record<string, unknown>; understandingLeft?: number } = {}): { engine: EngineClient; batches: JevRequest[][] } {
  const jev = standInJev(LOOKS);
  const batches: JevRequest[][] = [];
  const estimate = { endpoint: "fake", questions: 0, bytes: 0, estimatedTokens: 1, estimatedUsd: o.estimateUsd ?? 0, usdPerMillionInputTokens: 0, concurrency: 8, live: true };
  const results: Record<string, (params: { requests: JevRequest[]; key?: string }) => unknown> = {
    "store.read": () => ({ records: o.kept ?? {} }),
    "store.get": ({ key }) => (key === LIMIT_KEY && o.limitUsd !== undefined ? { value: { usd: o.limitUsd } } : null),
    "store.put": () => ({ ok: true }),
    "jev.status": () => o.status ?? { live: true, key: true },
    "jev.estimate": ({ requests }) => ({ ...estimate, requests: requests.length }),
    "project.graph": () => graph,
    "understanding.next": () => ({ sent: 0, failed: 0, failures: [], left: 0, settled: [], quality: {} }),
    "understanding.plan": () => ({ pending: o.understandingLeft === undefined ? [] : [{ pass: "files", requests: o.understandingLeft, kept: 0 }], estimate: { ...estimate, requests: o.understandingLeft ?? 0, estimatedUsd: 0 } }),
  };
  const engine = {
    call: async (method: string, params: { requests: JevRequest[]; key?: string }) => {
      if (method !== "jev.batch") return results[method]?.(params);
      batches.push(params.requests);
      return { responses: await Promise.all(params.requests.map((r) => o.answer?.(r) ?? jev.ask(r))) };
    },
    on: () => () => {},
  } as unknown as EngineClient;
  return { engine, batches };
}

/** Every file named by the `health` messages shown, with its vitality, in order. */
const named = (shown: readonly Opening[]): [string, number][] => shown.flatMap((o) => (o.stage === "health" ? Object.entries(o.vitality) : []));

describe("opening a world", () => {
  // The proving ground is laid out twice (its land, then the finished world): about a second on a busy machine.
  it("names each file's health once, as the finished world has it, only once its judging is done, on land that says which commit it is", { timeout: 20_000 }, async () => {
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
    // The commit the code was read from, so a picture of another commit is never taken for this world's map.
    expect(land?.stage === "land" && land.commit).toBe("c0ffee");
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

  it("fails the opening, naming the request and why, when Jev cannot answer one once the client has retried it, and guesses nothing", async () => {
    // Jev refuses one area's request, as OpenRouter might refuse a bad one.
    const { engine } = engineWith({ answer: (r) => ((r.state as { directory?: { path?: string } }).directory?.path === "fords" ? { error: "OpenRouter answered 400: Invalid request parameters" } : undefined) });
    await expect(openWorld({ engine, root: "proving", consent: async () => true, progress: () => {} })).rejects.toThrow(/Gaia could not finish judging the area fords: OpenRouter answered 400/);
  });

  it("fails the opening with Jev off, saying how to turn it on, and sends nothing", async () => {
    const { engine, batches } = engineWith({ status: { live: false, key: true } });
    await expect(openWorld({ engine, root: "proving", consent: async () => true, progress: () => {} })).rejects.toThrow(/Jev is off: start Gaia with GAIA_JEV=live/);
    expect(batches).toEqual([]);
  });

  it("with Jev off and every look kept, still fails the opening while the understanding pass has requests left, and opens once nothing is left", { timeout: 20_000 }, async () => {
    // Every look answered and kept, as an earlier opening with Jev would have left it.
    const keptAnswers: Record<string, unknown> = {};
    const standIn = standInJev(LOOKS);
    const judging = keptJev(standIn, { stored: new Map(), keep: (key, r) => (keptAnswers[key] = r) });
    await composeWorld(facts, LOOKS, judging, await judgeWorld(facts, LOOKS, judging, { graph }), { graph });
    const off = { live: false, key: false };
    const pending = engineWith({ status: off, kept: keptAnswers, understandingLeft: 3 });
    await expect(openWorld({ engine: pending.engine, root: "proving", consent: async () => true, progress: () => {} })).rejects.toThrow(/Jev is off/);
    const done = engineWith({ status: off, kept: keptAnswers });
    const document = await openWorld({ engine: done.engine, root: "proving", consent: async () => true, progress: () => {} });
    expect(done.batches).toEqual([]);
    expect(new Set(Object.values(document.judges))).toEqual(new Set(["jev"]));
  });

  it("leaves the world unopened when the person declines a cost past their limit, and sends nothing", async () => {
    const asked: number[] = [];
    const { engine, batches } = engineWith({ limitUsd: 0.001, estimateUsd: 0.05 });
    await expect(openWorld({ engine, root: "proving", consent: async (plan) => (asked.push(plan.estimatedUsd), false), progress: () => {} })).rejects.toThrow(/you chose not to go ahead/);
    expect(asked).toEqual([0.05]);
    expect(batches).toEqual([]);
  });

  it("opens a world the stand-in judges only when a developer asks for it, sending nothing to Jev", { timeout: 20_000 }, async () => {
    const { engine, batches } = engineWith({ status: { live: false, key: false } });
    const document = await openWorld({ engine, root: "proving", consent: async () => true, progress: () => {}, standIn: true });
    expect(batches).toEqual([]);
    expect(new Set(Object.values(document.judges))).toEqual(new Set(["stand-in"]));
    expect(document.summary).toContain("GAIA_JEV=stand-in");
  });
});
