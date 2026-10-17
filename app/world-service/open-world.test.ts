import { describe, expect, it } from "vitest";
import type { CodeGraph, CodeFacts, EngineClient, GraphNode, JevRequest } from "@gaia/schema";
import { composeWorld, factsOf, judgeWorld, keptJev, landOf, requestKey } from "@gaia/world";
import { fakeJevClient } from "@gaia/world/testing";
import { LOOKS } from "../renderer/terrain/looks.ts";
import proving from "../renderer/terrain/fixtures/proving.json";
import { LIMIT_KEY, healWorld, judgedGraph, openWorld } from "./open-world.ts";
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
  const fake = fakeJevClient();
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
      return { responses: await Promise.all(params.requests.map((r) => fake.ask(r))) };
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
  const jev = fakeJevClient();
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

describe("the graph a world is laid out from", () => {
  it("keeps the imports between files and the calls and references into each definition, which its building rises with, and no other edge", () => {
    const [a, b] = graph.nodes.filter((n) => n.kind === "def");
    if (a === undefined || b === undefined) throw new Error("The proving ground has no two definitions.");
    const by = { by: "rule" as const };
    const calls = { from: a.id, to: b.id, kind: "calls" as const, by };
    const references = { from: "file:moor/guide.md", to: a.id, kind: "references" as const, by };
    const others = [
      { from: a.id, to: b.id, kind: "implements" as const, by },
      { from: b.id, to: "file:moor/guide.md", kind: "references" as const, by },
    ];
    expect(judgedGraph({ ...graph, edges: [...graph.edges, calls, references, ...others] }).edges).toEqual([...graph.edges, calls, references]);
  });
});

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
    const judging = keptJev(fakeJevClient(), { stored: new Map(), keep: (key, r) => (keptAnswers[key] = r) });
    await composeWorld(facts, LOOKS, judging, await judgeWorld(facts, LOOKS, judging), { graph });
    const off = { live: false, key: false };
    const pending = engineWith({ status: off, kept: keptAnswers, understandingLeft: 3 });
    await expect(openWorld({ engine: pending.engine, root: "proving", consent: async () => true, progress: () => {} })).rejects.toThrow(/Jev is off/);
    const done = engineWith({ status: off, kept: keptAnswers });
    const document = await openWorld({ engine: done.engine, root: "proving", consent: async () => true, progress: () => {} });
    expect(done.batches).toEqual([]);
    expect(document.summary).toContain("judged by Jev");
  });

  it("leaves the world unopened when the person declines a cost past their limit, and sends nothing", async () => {
    const asked: number[] = [];
    const { engine, batches } = engineWith({ limitUsd: 0.001, estimateUsd: 0.05 });
    await expect(openWorld({ engine, root: "proving", consent: async (plan) => (asked.push(plan.estimatedUsd), false), progress: () => {} })).rejects.toThrow(/you chose not to go ahead/);
    expect(asked).toEqual([0.05]);
    expect(batches).toEqual([]);
  });
});

/**
 * The proving ground's graph read from `commit`, as the engine gives it once the understanding pass has judged it:
 * every folder, file and definition at quality 0.6, or as `quality` names it by its id.
 */
function judgedAt(commit: string, quality: Readonly<Record<string, number>> = {}, from: CodeGraph = graph): CodeGraph {
  const judged = (id: string) => ({ value: { importance: 0.5, quality: quality[id] ?? 0.6, concepts: { readability: quality[id] ?? 0.6 } } });
  return { ...from, commit, nodes: from.nodes.map((n): GraphNode => (n.kind === "block" ? n : { ...n, judged: judged(n.id) })) };
}

/** An engine that keeps what is written to its store, as the real one does, reads the folder as `at.graph` says, and notes the key of every request sent to Jev. */
function keepingEngine(at: { graph: CodeGraph }): { engine: EngineClient; asked: string[] } {
  const jev = fakeJevClient();
  const kept: Record<string, unknown> = {};
  const asked: string[] = [];
  const estimate = { endpoint: "fake", questions: 0, bytes: 0, estimatedTokens: 1, estimatedUsd: 0, usdPerMillionInputTokens: 0, concurrency: 8, live: true };
  const results: Record<string, (params: { requests: JevRequest[]; writes: { key: string; value: unknown }[] }) => unknown> = {
    "store.read": () => ({ records: { ...kept } }),
    "store.get": () => null,
    "store.put": ({ writes }) => {
      for (const w of writes) kept[w.key] = w.value;
      return { ok: true };
    },
    "jev.status": () => ({ live: true, key: true }),
    "jev.estimate": ({ requests }) => ({ ...estimate, requests: requests.length }),
    "project.graph": () => at.graph,
    "understanding.next": () => ({ sent: 0, failed: 0, failures: [], left: 0, settled: [], quality: {} }),
  };
  const engine = {
    call: async (method: string, params: { requests: JevRequest[]; writes: { key: string; value: unknown }[] }) => {
      if (method !== "jev.batch") return results[method]?.(params);
      asked.push(...params.requests.map(requestKey));
      return { responses: await Promise.all(params.requests.map((r) => jev.ask(r))) };
    },
    on: () => () => {},
  } as unknown as EngineClient;
  return { engine, asked };
}

describe("healing an open world", () => {
  const wheel = "crossings/mill/wheel.ts";
  const open = (engine: EngineClient) => openWorld({ engine, root: "proving", consent: async () => true, progress: () => {} });

  // Each opening lays the proving ground out twice, about a second on a busy machine, and this test opens it three times.
  it("on a new commit asks Jev only what the commit changed, and sends the page each thing's new vitality where it changed", { timeout: 40_000 }, async () => {
    const at = { graph: judgedAt("c0ffee") };
    const { engine, asked } = keepingEngine(at);
    const shown = await open(engine);
    const before = new Set(asked);
    // The commit rewrites the mill's wheel well, and the understanding pass judges it so, and the mill with it.
    at.graph = judgedAt("beef", { [`file:${wheel}`]: 0.9, "dir:crossings/mill": 0.8 });
    asked.length = 0;
    const healed = await healWorld(engine, shown);

    // Everything an opening of the new commit asks, less what the first opening asked: no more, no less.
    const fresh = keepingEngine({ graph: at.graph });
    await open(fresh.engine);
    const changed = [...new Set(fresh.asked)].filter((key) => !before.has(key));
    expect(changed.length).toBeGreaterThan(0);
    expect([...new Set(asked)].sort()).toEqual(changed.sort());

    // Only the wheel's and the mill's vitality changed (the wheel's definitions keep their own), so only theirs is
    // sent, with what the pass judged anew and the commit the journal reads from now.
    expect(healed.heal).toEqual({
      type: "world.vitality",
      vitality: { [wheel]: 0.9, "crossings/mill": 0.8 },
      judged: { [wheel]: expect.objectContaining({ quality: 0.9 }), "crossings/mill": expect.objectContaining({ quality: 0.8 }) },
      commit: "beef",
    });
    // The page's world takes it where the wheel shows, and nothing moves.
    expect(healed.shown.world.patches.find((p) => p.path === wheel)?.vitality).toBe(0.9);
    expect(healed.shown.world.patches.map(({ path, x, z, radius }) => [path, x, z, radius])).toEqual(shown.world.patches.map(({ path, x, z, radius }) => [path, x, z, radius]));
  });

  it("when the commit would move the land, sends the new vitality of what still stands under the same name, and leaves the rest to the next open", { timeout: 40_000 }, async () => {
    const at = { graph: judgedAt("c0ffee") };
    const { engine } = keepingEngine(at);
    const shown = await open(engine);
    // The commit adds a file beside the wheel, which divides the land anew, and rewrites the wheel well.
    const sluice = "crossings/mill/sluice.ts";
    const added: GraphNode = { kind: "file", id: `file:${sluice}`, lineage: sluice, path: sluice, language: "typescript", bytes: 1, hash: "", binary: false, unparsed: 0, conventions: [], measures: { lines: 300 } };
    at.graph = judgedAt("beef", { [`file:${wheel}`]: 0.9, [`file:${sluice}`]: 0.2 }, { ...graph, nodes: [...graph.nodes, added] });
    const healed = await healWorld(engine, shown);

    // No new commit for the journal and no new judgments: its code still lies where the page's land has it.
    expect(healed.heal).toEqual({ type: "world.vitality", vitality: { [wheel]: 0.9 } });
    expect(healed.shown.commit).toBe("c0ffee");
    expect(healed.shown.world.patches.map((p) => p.path)).toEqual(shown.world.patches.map((p) => p.path));
  });
});
