import { describe, expect, it } from "vitest";
import { biome, bush, landmark, link, rock, structure, tree, wildBush, wildflowers, world as worldKind } from "@gaia/kinds";
import { BUSH_PRIMITIVES, PRIMITIVES, TREE_PRIMITIVES } from "@gaia/primitives";
import { type CodeGraph, type CodeFacts, type DefNode, type EntityFacts, type FileFacts, type JevClient, type JevQuestion, type JevRequest, type JevResponse, Library } from "@gaia/schema";
import { cellUnder, placeAt } from "@gaia/terrain";
import { LAYOUT, type LookSet, type Looks, composeWorld, journalOf, judgeWorld, keptJev, landOf, layoutWorld, planForms, planStructure, planWorldRequests, raisedAs, readStructure, requestKey, validate } from "@gaia/world";
import { fakeJev, fakeJevClient } from "./fixtures.ts";

const file = (path: string, lines: number): FileFacts => ({
  path,
  language: path.endsWith(".rs") ? "rust" : path.endsWith(".md") ? "markdown" : "typescript",
  lines,
  // Only .ts and .rs files get symbols, since manifest keys and document sections are never placed.
  symbols: /\.(ts|rs)$/.test(path)
    ? [
        { name: "x", kind: "function", exported: true, line: 3, lines: Math.max(1, Math.round(lines / 3)) },
        { name: "helper", kind: "function", exported: false, line: 40, lines: Math.max(1, Math.round(lines / 4)) },
      ]
    : [],
  imports: [],
  importedBy: [],
});

const entity = (path: string, name: string, dependsOn: string[], dependents: string[]): EntityFacts => ({
  path,
  name,
  form: "package",
  manifest: `${path}/package.json`,
  files: 3,
  lines: 600,
  exports: 10,
  dependsOn,
  dependents,
});

/** A small repository whose source file sizes scale by `grow`. */
function facts(grow = 1): CodeFacts {
  const files = [
    file("package.json", 20),
    file("README.md", 80),
    file("packages/core/package.json", 15),
    file("packages/core/src/index.ts", 10),
    file("packages/core/src/math.ts", 300 * grow),
    file("packages/core/src/shapes.ts", 420 * grow),
    file("packages/core/test/math.test.ts", 90),
    file("packages/app/package.json", 15),
    file("packages/app/src/main.ts", 250 * grow),
    file("packages/app/src/ui/panel.ts", 180 * grow),
    file("packages/app/src/ui/menu.ts", 120 * grow),
  ];
  return {
    projectId: "demo",
    files,
    entities: [entity("", "demo", [], []), entity("packages/app", "@demo/app", ["packages/core"], []), entity("packages/core", "@demo/core", [], ["packages/app"])],
    repository: { name: "demo", files: files.length, lines: files.reduce((n, f) => n + f.lines, 0) },
  };
}

const set = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, { doc: `Option ${k}.` }]));
/** Forms by size, each with a rank range. The ranges are wide and overlap, like the real forms' ranges. */
const FORMS: LookSet = {
  Stone: { doc: "Option Stone.", needs: [{ rank: [0, 0.7] }], composes: "stone", first: { slot: "form", use: "boulder@1" } },
  Bush: { doc: "Option Bush.", needs: [{ rank: [0.2, 1] }], composes: "bush", first: { slot: "form", use: "thicket@1", fixed: { "form.habit": "mound" } } },
  Hall: { doc: "Option Hall.", needs: [{ rank: [0.5, 1] }], composes: "building" },
  Spire: { doc: "Option Spire.", needs: [{ rank: [0.8, 1] }], composes: "landmark" },
};
const LOOKS: Looks = {
  compose: { building: structure, landmark, world: worldKind, biome, link, tree, bush, stone: rock, flowers: wildflowers, wildBush, lib: new Library(PRIMITIVES), offered: { tree: new Library(TREE_PRIMITIVES), bush: new Library(BUSH_PRIMITIVES), wildBush: new Library(BUSH_PRIMITIVES) } },
  form: FORMS,
  water: set("Dry", "Brook"),
  wild: [
    { cover: "lush grass", length: "tall and unkempt" },
    { cover: "golden steppe", length: "tall and unkempt" },
  ],
};

/**
 * The fake Jev, except that `pick` chooses each thing's form among those offered. By default, an entity gets its
 * largest offered form, and everything else gets the first offered form that is not a building or landmark.
 */
const formPicker = (pick: (about: "file" | "entity", id: string, offered: readonly string[]) => string = (about, _id, offered) => (about === "entity" ? (offered.find((k) => FORMS[k]?.composes === "landmark") ?? offered.find((k) => FORMS[k]?.composes === "building") ?? offered[0]) : offered.find((k) => !raisedAs(FORMS[k]?.composes ?? "building"))) as string): JevClient => {
  const base = fakeJevClient();
  return {
    async ask(request) {
      const r = await base.ask(request);
      const answers = { ...r.answers };
      const about = (request.state as Record<string, unknown>).entity !== undefined ? "entity" : "file";
      for (const [id, q] of Object.entries(request.questions)) {
        if (q.type !== "choice" || (id !== "form" && !id.startsWith("form#"))) continue;
        const choice = pick(about, id, Object.keys(q.criteria));
        answers[id] = { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 };
      }
      return { ...r, answers };
    },
  };
};

/** Judges and composes a world, returning the judgments `layoutWorld` takes. */
const composed = async (m: CodeFacts, jev: JevClient = formPicker()) => composeWorld(m, LOOKS, jev, await judgeWorld(m, LOOKS, jev));

describe("a world laid out from code", () => {
  it("composes the whole world part by part, its sky and every land, building, landmark and trail, each part in its own words, never offering Jev a preset or the old model's signals", async () => {
    const asked: JevRequest[] = [];
    const fake = formPicker();
    const jev: JevClient = { ask: (r) => (asked.push(r), fake.ask(r)) };
    const judged = await composeWorld(facts(), LOOKS, jev, await judgeWorld(facts(), LOOKS, jev));
    const composing = asked.filter((r) => Object.keys(r.questions).some((id) => /^[a-z]+\.(use|present)$/.test(id)) || (r.state as Record<string, unknown> | undefined)?.decided !== undefined);
    expect(composing.length).toBeGreaterThan(0);
    for (const r of composing) {
      // Each part is chosen among primitives, never a whole preset.
      for (const [id, q] of Object.entries(r.questions)) if (id.endsWith(".use") && q.type === "choice") for (const option of Object.keys(q.criteria)) expect(() => LOOKS.compose.lib.get(option as never), option).not.toThrow();
      for (const q of Object.values(r.questions)) expect(q.instructions).not.toContain("Which form fits it best?");
      expect(JSON.stringify(r.state)).not.toMatch(/"(tests|coveredByTests|failing|diagnostics|unusedExports|debtMarkers)"/);
    }
    // Every entity gets a building or landmark. Every other thing gets a small form, also composed.
    expect(Object.keys(judged.things).filter((id) => raisedAs(judged.things[id]!.as)).sort()).toEqual(facts().entities.map((e) => e.path).sort());
    for (const [path, t] of Object.entries(judged.things)) {
      const k = t.as === "building" ? structure : t.as === "landmark" ? landmark : t.as === "bush" ? bush : rock;
      if (t.blueprint === undefined) throw new Error(`Nothing was composed for ${path}.`);
      expect(t.blueprint.kind, path).toBe(k.id);
      expect(validate(t.blueprint, k, LOOKS.compose.lib), path).toEqual([]);
    }
    // The sky, each region's land and each trail are composed the same way.
    if (judged.sky === undefined) throw new Error("No sky was composed.");
    expect(judged.sky.kind).toBe(worldKind.id);
    expect(validate(judged.sky, worldKind, LOOKS.compose.lib)).toEqual([]);
    expect(Object.keys(judged.lands).sort()).toEqual(Object.keys(judged.waters).sort());
    for (const [path, land] of Object.entries(judged.lands)) expect(validate(land, biome, LOOKS.compose.lib), path).toEqual([]);
    expect(judged.trails.length).toBeGreaterThan(0);
    for (const t of judged.trails) {
      if (t.route === undefined) throw new Error(`Nothing was composed for the trail ${t.from} to ${t.to}.`);
      expect(validate(t.route, link, LOOKS.compose.lib), `${t.from}->${t.to}`).toEqual([]);
    }
    // The laid-out world carries the composed sky, and each region carries its composed land.
    const laid = layoutWorld(facts(), judged);
    expect(laid.sky).toEqual(judged.sky);
    for (const r of laid.regions) expect(r.biome, r.area).toEqual(judged.lands[r.area]);
    // Every tree, bush, stone and flowers stands as the form Jev chose, with the blueprint composed for it.
    const small = [...laid.symbols.map((s) => ({ ...s, key: s.id })), ...laid.naturalThings.map((s) => ({ ...s, key: s.path }))];
    expect(small.length).toBeGreaterThan(0);
    for (const s of small) {
      expect(s.as, s.key).toBe(FORMS[s.form]?.composes);
      expect(s.blueprint, s.key).toEqual(judged.things[s.key]?.blueprint);
    }
  });

  it("offers a building only the features its region's water lets stand there, and leaves the pick among them to Jev", async () => {
    const looks: Looks = { ...LOOKS, water: { Dry: { doc: "Option Dry." }, Brook: { doc: "Option Brook.", holds: ["running water"] } } };
    const needing = PRIMITIVES.filter((p) => p.role === "Feature" && (p.needs ?? []).length > 0);
    expect(needing.length).toBeGreaterThan(0);
    const offered = async (water: string): Promise<Set<string>> => {
      const asked: JevRequest[] = [];
      const fake = fakeJevClient();
      const jev: JevClient = { ask: (r) => (asked.push(r), fake.ask(r)) };
      const judged = await judgeWorld(facts(), looks, jev);
      const everywhere = Object.fromEntries(Object.keys(judged.waters).map((path) => [path, water]));
      const buildings = Object.fromEntries(facts().entities.map((e) => [e.path, { as: "building" as const }]));
      await composeWorld(facts(), looks, jev, { ...judged, waters: everywhere, things: buildings, forms: {} });
      return new Set(asked.flatMap((r) => Object.keys((r.questions["feature.use"] as { criteria?: object } | undefined)?.criteria ?? {})));
    };
    const dry = await offered("Dry");
    const wet = await offered("Brook");
    expect(wet.size).toBeGreaterThan(0);
    for (const p of needing) {
      expect(dry.has(p.id), p.id).toBe(false);
      expect(wet.has(p.id), p.id).toBe(true);
    }
  });

  it("asks an area's water once: the stream or pond of the land composed for it is the water's, never asked again", async () => {
    const looks: Looks = {
      ...LOOKS,
      water: {
        Dry: { doc: "Option Dry.", settles: { "relief.stream": "dry bed", "relief.pond": false } },
        Pond: { doc: "Option Pond.", settles: { "relief.stream": "dry bed", "relief.pond": true } },
        Brook: { doc: "Option Brook.", settles: { "relief.stream": "brook", "relief.pond": false } },
      },
    };
    for (const [water, relief] of [["Brook", "valley@1"], ["Dry", "valley@1"], ["Pond", "basin@1"], ["Dry", "basin@1"]] as const) {
      const asked: JevRequest[] = [];
      const fake = fakeJevClient();
      // Force every land's relief to the landform under test.
      const jev: JevClient = {
        async ask(r) {
          asked.push(r);
          const response = await fake.ask(r);
          return r.questions["relief.use"] === undefined ? response : { ...response, answers: { ...response.answers, "relief.use": { type: "choice", choice: relief, probabilities: { [relief]: 1 }, confidence: 1 } } };
        },
      };
      const judged = await judgeWorld(facts(), looks, jev);
      const lands = (await composeWorld(facts(), looks, jev, { ...judged, waters: Object.fromEntries(Object.keys(judged.waters).map((path) => [path, water])) })).lands;
      expect(asked.filter((r) => r.questions["relief.stream"] !== undefined || r.questions["relief.pond"] !== undefined), `${water} on ${relief}`).toEqual([]);
      for (const land of Object.values(lands)) {
        expect(land.slots.relief?.use).toBe(relief);
        const settled = relief === "valley@1" ? { stream: looks.water[water]?.settles?.["relief.stream"] } : { pond: looks.water[water]?.settles?.["relief.pond"] };
        expect(land.slots.relief?.params, `${water} on ${relief}`).toMatchObject(settled);
      }
    }
  });

  it("asks Jev only about the code's structure, in requests that fit its window, with options it can answer", async () => {
    const looks = planWorldRequests(facts(), LOOKS);
    // planWorldRequests asks only about areas and entity trails. planForms asks for forms later, with one request per
    // file and one per entity.
    expect(looks.filter((r) => r.about === "file")).toHaveLength(0);
    expect(looks.filter((r) => r.about === "entity").map((r) => r.target)).toEqual(["packages/app"]);
    const formRequests = planForms(facts(), LOOKS).requests;
    expect(formRequests.filter((r) => r.about === "file")).toHaveLength(facts().files.length);
    expect(formRequests.filter((r) => r.about === "entity")).toHaveLength(3);
    for (const { request } of [...looks, ...formRequests]) {
      expect(JSON.stringify(request.state)).not.toContain("contentHash");
      // Jev's window is 32,000 tokens, which the engine counts as 1.8 bytes each.
      expect(JSON.stringify(request).length / 1.8).toBeLessThan(32_000);
      for (const q of Object.values(request.questions) as JevQuestion[]) {
        expect(["choice", "noul", "score"]).toContain(q.type);
        if (q.type === "choice") expect(Object.keys(q.criteria).length).toBeLessThanOrEqual(255);
        if (q.type === "score") expect(q.criteria.length).toBeLessThanOrEqual(10);
      }
    }
    // The same code and answers give the same world.
    const a = layoutWorld(facts(), await composed(facts(), fakeJevClient()));
    const b = layoutWorld(facts(), await composed(facts(), fakeJevClient()));
    expect(a.naturalThings.length + a.things.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it("divides the land among directories and files by their code, with no gaps, nested as the tree nests, and what placeAt reads agrees", async () => {
    const world = layoutWorld(facts(), await composed(facts()));
    // Every point of the land is one file's patch or one entity's lot, in its directory's area.
    const half = world.size / 2;
    const counts = new Map<string, number>();
    for (let x = -half + 2; x < half; x += 4) {
      for (let z = -half + 2; z < half; z += 4) {
        const here = placeAt(world, x, z);
        if (here.area.depth < 0) continue;
        const cell = world.cells[cellUnder(world, x, z)]!;
        expect(here.area.path).toBe(cell.area);
        expect(here.file?.path ?? null).toBe(cell.file ?? null);
        if (here.file !== null) expect(here.file.path.startsWith(here.area.path)).toBe(true);
        counts.set(here.file?.path ?? `lot:${here.area.path}`, (counts.get(here.file?.path ?? `lot:${here.area.path}`) ?? 0) + 16);
      }
    }
    // Each patch's sampled area matches its ground within 25% or 80 square meters, and longer files get more ground.
    for (const p of world.patches) {
      expect(counts.get(p.path) ?? 0).toBeGreaterThan(0);
      expect(Math.abs((counts.get(p.path) ?? 0) - p.ground)).toBeLessThan(Math.max(80, p.ground * 0.25));
    }
    const ground = (path: string) => world.patches.find((p) => p.path === path)!.ground;
    expect(ground("packages/core/src/shapes.ts")).toBeGreaterThan(ground("packages/core/src/math.ts"));
    expect(ground("packages/core/src/math.ts")).toBeGreaterThan(ground("packages/core/src/index.ts") * 4);
    // Areas nest. A directory's ground is its own ground plus its subdirectories'.
    const area = (path: string) => world.areas.find((a) => a.path === path)!;
    expect(area("packages/app/src").ground).toBeGreaterThan(area("packages/app/src/ui").ground);
    expect(Math.abs(area("packages/app").ground - area("packages/app/src").ground - (counts.get("lot:packages/app") ?? 0) - (counts.get("packages/app/package.json") ?? 0))).toBeLessThan(200);
    // Each entity's thing is in its own area, and each symbol is on its own file's patch.
    expect(world.things.map((t) => t.path).sort()).toEqual(["", "packages/app", "packages/core"]);
    for (const t of world.things) expect(placeAt(world, t.x, t.z).area.path).toBe(t.path);
    expect(world.symbols.length).toBeGreaterThan(0);
    for (const s of world.symbols) expect(placeAt(world, s.x, s.z).file?.path).toBe(s.file);
    // Every file also gets one small form, on its own patch.
    expect(world.naturalThings.filter((s) => s.of === "file").map((s) => s.path).sort()).toEqual(facts().files.map((f) => f.path).sort());
    for (const s of world.naturalThings) if (s.file !== undefined) expect(placeAt(world, s.x, s.z).file?.path).toBe(s.file);
    // A region's sites are its cells' sites, so its ground cover changes exactly where its areas end.
    for (const r of world.regions) expect(r.sites.length).toBeGreaterThan(0);
    expect(world.regions.reduce((n, r) => n + r.sites.length, 0)).toBe(world.cells.length);
    const bigger = layoutWorld(facts(30), await composed(facts(30)));
    expect(bigger.size).toBeGreaterThan(world.size);
  });

  it("with Engine's graph, stands every definition on its own plot, nested ones under their parent, sized by their importance; never a plain value or a stylesheet rule", async () => {
    const math = "packages/core/src/math.ts";
    const def = (name: string, role: string, start: number, end: number, importance?: number, parent?: string): DefNode => ({
      kind: "def", id: `def:${math}#${parent === undefined ? name : `${parent}.${name}`}`, lineage: name, file: `file:${math}`, name, role, span: { start, end },
      signature: `${role} ${name}`, exported: false, measures: { lines: end - start + 1 }, ...(parent === undefined ? {} : { parent: `def:${math}#${parent}` }),
      ...(importance === undefined ? {} : { judged: { value: { importance, quality: null, concepts: {} } } }),
    });
    const graph: CodeGraph = {
      projectId: "demo", name: "demo", edges: [], pending: [],
      nodes: [
        { kind: "file", id: `file:${math}`, lineage: "m", path: math, language: "typescript", bytes: 1, hash: "", binary: false, unparsed: 0, conventions: [], measures: { lines: 300 } },
        { kind: "file", id: "file:README.md", lineage: "r", path: "README.md", language: "markdown", bytes: 1, hash: "", binary: false, unparsed: 0, conventions: [], measures: { lines: 80 } },
        def("Opts", "interface", 1, 8, 0.25),
        def("PI", "constant", 9, 9, 0.05),
        def("Calc", "class", 10, 200, 0.9),
        def("add", "method", 20, 40, 0.3, "Calc"),
        def("mul", "method", 50, 90, 0.6, "Calc"),
        def("square", "function", 210, 220),
        { ...def("Usage", "section", 1, 20, 0.5), id: "def:README.md#Usage", file: "file:README.md" },
      ],
    };
    const judged = await judgeWorld(facts(), LOOKS, fakeJevClient());
    const world = layoutWorld(facts(), judged, graph);
    const defined = world.symbols.filter((s) => s.file === math);
    expect(defined.map((s) => s.id).sort()).toEqual([`${math}#Calc`, `${math}#Calc.add`, `${math}#Calc.mul`, `${math}#Opts`, `${math}#square`]);
    expect(world.symbols.filter((s) => s.file !== math)).toEqual([]);
    const by = new Map(defined.map((s) => [s.name, s]));
    expect(by.get("add")?.parent).toBe(`${math}#Calc`);
    expect(by.get("Calc")?.importance).toBe(0.9);
    expect(by.get("square")?.importance).toBeUndefined();
    // Each definition is on its file's patch, at a point of its own.
    for (const s of defined) expect(placeAt(world, s.x, s.z).file?.path).toBe(math);
    expect(new Set(defined.map((s) => `${s.x},${s.z}`)).size).toBe(defined.length);
    // A patch includes ground for its definitions, so math.ts takes a larger share of the land with them.
    const share = (w: typeof world) => w.patches.find((p) => p.path === math)!.ground / w.patches.reduce((n, p) => n + p.ground, 0);
    const bare: CodeGraph = { ...graph, nodes: graph.nodes.filter((n) => n.kind !== "def") };
    expect(share(world)).toBeGreaterThan(share(layoutWorld(facts(), judged, bare)));
    // landOf gives the same cells before Jev answers, with the graph too.
    expect(landOf(facts(), graph).cells).toEqual(world.cells);
    // The journal has one entry per directory below the root, building or landmark, file, file's own code and
    // definition, each after its parent entry.
    const journal = journalOf(world);
    const count = world.areas.length - 1 + world.things.length + world.patches.length + new Set(world.symbols.map((s) => s.file)).size + world.symbols.length;
    expect(new Set(journal.entries.map((e) => e.of)).size).toBe(count);
    expect(journal.entries.length).toBe(count);
    for (const e of journal.entries) if (e.under !== undefined) expect(journal.entry(e.under)?.page).toBeLessThan(e.page);
  });

  it("gives every definition of a crowded file a plot of its own, and stands what Jev raises there on the file's ground: a closure holding two hundred functions, sixty more beside it", async () => {
    const lab = "packages/app/src/main.ts";
    const def = (name: string, start: number, end: number, parent?: string, importance = 0.2): DefNode => ({
      kind: "def", id: `def:${lab}#${parent === undefined ? name : `${parent}.${name}`}`, lineage: name, file: `file:${lab}`, name, role: "function", span: { start, end },
      signature: `function ${name}`, exported: false, measures: { lines: end - start + 1 }, ...(parent === undefined ? {} : { parent: `def:${lab}#${parent}` }),
      judged: { value: { importance, quality: null, concepts: {} } },
    });
    const graph: CodeGraph = {
      projectId: "demo", name: "demo", edges: [], pending: [],
      nodes: [
        { kind: "file", id: `file:${lab}`, lineage: "l", path: lab, language: "typescript", bytes: 1, hash: "", binary: false, unparsed: 0, conventions: [], measures: { lines: 250 }, judged: { value: { importance: 1, quality: null, concepts: {} } } },
        def("createLab", 1, 2700),
        ...Array.from({ length: 200 }, (_, i) => def(`inner${i}`, 10 + i * 13, 20 + i * 13, "createLab")),
        ...Array.from({ length: 60 }, (_, i) => def(`outer${i}`, 2701 + i * 10, 2709 + i * 10, undefined, i === 0 ? 1 : 0.2)),
      ],
    };
    // A Jev that raises each file, and the file's first outer function, as a building or a landmark when it may.
    const raise = formPicker((about, id, offered) => (about === "file" && (id === "form" || id === "form#outer0") ? offered.find((k) => raisedAs(FORMS[k]?.composes ?? "stone")) : undefined) ?? (offered.find((k) => !raisedAs(FORMS[k]?.composes ?? "building")) as string));
    const world = layoutWorld(facts(), await composeWorld(facts(), LOOKS, raise, await judgeWorld(facts(), LOOKS, raise), { graph }), graph);
    const defined = world.symbols.filter((s) => s.file === lab);
    expect(defined.length).toBe(261);
    for (const s of defined) expect(placeAt(world, s.x, s.z).file?.path, s.name).toBe(lab);
    expect(new Set(defined.map((s) => `${s.x},${s.z}`)).size).toBe(defined.length);
    const raised = world.things.filter((t) => t.file === lab);
    expect(raised.map((t) => t.of).sort()).toEqual(["definition", "file"]);
    for (const t of raised) expect(placeAt(world, t.x, t.z).file?.path, t.path).toBe(lab);
  });

  it("reads vitality from Jev's quality: a file's and a definition's are their own, and a file Jev didn't judge takes its folder's", async () => {
    const math = "packages/core/src/math.ts";
    const value = (quality: number) => ({ judged: { value: { importance: 0.5, quality, concepts: {} } } });
    const file = (path: string, lines: number) => ({ kind: "file" as const, id: `file:${path}`, lineage: path, path, language: "typescript", bytes: 1, hash: "", binary: false, unparsed: 0, conventions: [], measures: { lines } });
    const def = (name: string, start: number, end: number): DefNode => ({ kind: "def", id: `def:${math}#${name}`, lineage: name, file: `file:${math}`, name, role: "function", span: { start, end }, signature: `function ${name}`, exported: false, measures: { lines: end - start + 1 } });
    const graph: CodeGraph = {
      projectId: "demo", name: "demo", edges: [], pending: [],
      nodes: [
        { kind: "dir", id: "dir:packages/core/src", lineage: "s", path: "packages/core/src", measures: { lines: 730 }, ...value(0.4) },
        { ...file(math, 300), ...value(0.3) },
        file("packages/core/src/shapes.ts", 420),
        { ...def("add", 1, 40), ...value(0.8) },
        def("mul", 50, 90),
      ],
    };
    const world = layoutWorld(facts(), await composed(facts(), fakeJevClient()), graph);
    const patch = (path: string) => world.patches.find((p) => p.path === path)?.vitality;
    expect(patch(math)).toBe(0.3);
    expect(patch("packages/core/src/shapes.ts")).toBe(0.4);
    const symbol = new Map(world.symbols.filter((s) => s.file === math).map((s) => [s.name, s.vitality]));
    expect(symbol.get("add")).toBe(0.8);
    expect(symbol.get("mul")).toBe(0.3);
  });

  it("knows the land before anything is judged: however Jev judges, every area, patch, cell and lot is the same", async () => {
    const judged = await composed(facts());
    const blueprint = Object.values(judged.things)[0]?.blueprint;
    if (blueprint === undefined) throw new Error("Nothing stands.");
    const landmarks = { ...judged, things: Object.fromEntries(Object.entries(judged.things).map(([path, t]) => [path, raisedAs(t.as) ? { as: "landmark" as const, blueprint } : t])) };
    const land = landOf(facts());
    for (const world of [layoutWorld(facts(), judged), layoutWorld(facts(), landmarks)]) {
      expect(world.size).toBe(land.size);
      expect(world.cells).toEqual(land.cells);
      expect(world.areas.map(({ path, x, z }) => ({ path, x, z }))).toEqual(land.areas.map(({ path, x, z }) => ({ path, x, z })));
      expect(world.patches.map(({ path, x, z, radius }) => ({ path, x, z, radius }))).toEqual(land.patches.map(({ path, x, z, radius }) => ({ path, x, z, radius })));
      expect(world.things.map(({ x, z }) => ({ x, z }))).toEqual(land.lots);
    }
  });

  it("keeps its layout under small edits: one that crosses no rung moves nothing, and a new file moves only its own folder", async () => {
    const judged = await composed(facts());
    const before = layoutWorld(facts(), judged);
    const moved = (after: typeof before): string[] =>
      before.patches.filter((p) => {
        const q = after.patches.find((o) => o.path === p.path);
        return q !== undefined && Math.hypot(p.x - q.x, p.z - q.z) > 0.5;
      }).map((p) => p.path);
    const menu = "packages/app/src/ui/menu.ts";
    const grow = (lines: number): CodeFacts => ({ ...facts(), files: facts().files.map((f) => (f.path === menu ? { ...f, lines: f.lines + lines } : f)) });
    // Three more lines keep menu.ts on the same rung, so the land is unchanged.
    const edited = layoutWorld(grow(3), judged);
    expect(edited.size).toBe(before.size);
    const place = (w: typeof before) => w.patches.map(({ path, x, z, ground }) => ({ path, x, z, ground }));
    expect(place(edited)).toEqual(place(before));
    expect(edited.cells).toEqual(before.cells);
    // A small new file re-divides its own folder, which stays on the same rung. Patches outside the folder stay put,
    // except that one beside it may move up to 3 meters when `sitesOf` redraws the folder's borders.
    const added: CodeFacts = { ...facts(), files: [...facts().files, file("packages/app/src/ui/toolbar.ts", 20)] };
    const after = layoutWorld(added, judged);
    const outside = moved(after).filter((p) => !p.startsWith("packages/app/src/ui/"));
    expect(outside.length).toBeLessThanOrEqual(1);
    for (const path of outside) {
      const [a, b] = [before, after].map((w) => w.patches.find((p) => p.path === path)!);
      expect(Math.hypot(a!.x - b!.x, a!.z - b!.z)).toBeLessThanOrEqual(3);
    }
    // Line counts never reach Jev, so a longer file keeps its request and is not asked again. A renamed export changes it.
    const keyOf = (m: CodeFacts): string => requestKey(planForms(m, LOOKS).requests.find((p) => p.target === menu)!.request);
    const rename = (m: CodeFacts): CodeFacts => ({ ...m, files: m.files.map((f) => (f.path === menu ? { ...f, symbols: f.symbols.map((x) => (x.name === "x" ? { ...x, name: "tangent" } : x)) } : f)) });
    expect(keyOf(grow(3))).toBe(keyOf(facts()));
    expect(keyOf(grow(1000))).toBe(keyOf(facts()));
    expect(keyOf(rename(facts()))).not.toBe(keyOf(facts()));
  });

  it("under the judged design, asks what every file, its definitions and every entity stand as, each on its own, over as many requests as a file needs", async () => {
    const planned = planForms(facts(), LOOKS).requests;
    const math = planned.find((p) => p.target === "packages/core/src/math.ts")!;
    expect(Object.keys(math.request.questions).sort()).toEqual(["form", "form#helper", "form#x"]);
    expect(math.thingByQuestion).toEqual({ form: "packages/core/src/math.ts", "form#helper": "packages/core/src/math.ts#helper", "form#x": "packages/core/src/math.ts#x" });
    // A file with no definitions still gets a form question for itself.
    expect(Object.keys(planned.find((p) => p.target === "README.md")!.request.questions)).toEqual(["form"]);
    // A file with more definitions than `LAYOUT.formsPerRequest` spreads them over several requests, asking about each once.
    const crowded = { ...facts(), files: facts().files.map((f) => (f.path === "packages/core/src/math.ts" ? { ...f, symbols: Array.from({ length: 30 }, (_, k) => ({ name: `f${k}`, kind: "function" as const, exported: false, line: 1 + k * 9, lines: 8 })) } : f)) };
    const asked = planForms(crowded, LOOKS).requests.filter((p) => p.target === "packages/core/src/math.ts");
    expect(asked.length).toBe(Math.ceil(30 / LAYOUT.formsPerRequest));
    expect(asked.flatMap((p) => Object.keys(p.request.questions)).sort()).toEqual(["form", ...Array.from({ length: 30 }, (_, k) => `form#f${k}`)].sort());
    // A Jev that gives each thing its own form.
    const jev = formPicker((about, id) => (about === "entity" ? "Hall" : id === "form#x" ? "Stone" : "Bush"));
    const world = layoutWorld(facts(), await composed(facts(), jev));
    const forms = Object.fromEntries(world.symbols.filter((s) => s.file === "packages/core/src/math.ts").map((s) => [s.name, s.form]));
    expect(forms).toEqual({ x: "Stone", helper: "Bush" });
    expect(world.naturalThings.find((s) => s.path === "packages/core/src/math.ts")?.form).toBe("Bush");
  });

  it("keeps Jev's answers: a stored one is used without asking, and a request Jev cannot answer fails, naming it and why, with nothing guessed", async () => {
    const planned = planWorldRequests(facts(), LOOKS);
    const area = planned.find((p) => p.about === "area");
    const file = planForms(facts(), LOOKS).requests.find((p) => p.about === "file");
    const stored = await fakeJevClient().ask(area!.request);
    const asked: string[] = [];
    // A Jev that answers every choice with an option it was never offered.
    const wayward: JevClient = {
      async ask(request) {
        asked.push(requestKey(request));
        return { answers: { "form#x": { type: "choice", choice: "Bamboo", probabilities: {}, confidence: 1 } }, model: "jev", costUsd: 0, ms: 1 };
      },
    };
    const kept: JevResponse[] = [];
    const jev = keptJev(wayward, { stored: new Map([[requestKey(area!.request), stored]]), keep: (_, r) => kept.push(r) });
    expect(await jev.ask(area!.request)).toEqual(stored);
    await expect(jev.ask(file!.request)).rejects.toThrow(new RegExp(`the file ${file!.target}: Jev answered outside the options`));
    expect(asked).toEqual([requestKey(file!.request)]);
    expect(kept).toEqual([]);
    // A request that still fails after the client's retries fails the same way, with the client's reason.
    const down = keptJev({ ask: () => Promise.reject(new Error("OpenRouter answered 503")) }, { stored: new Map(), keep: () => undefined });
    await expect(down.ask(file!.request)).rejects.toThrow(/the file .*: OpenRouter answered 503/);
    // When Jev must not be asked, a request with no stored answer fails with the reason instead of a guess.
    const offline = keptJev(null, { stored: new Map(), keep: () => undefined, unasked: "Jev is off" });
    await expect(offline.ask(area!.request)).rejects.toThrow(/no answer kept for it, and Jev is off/);
    // Jev's pick among the parts a place was offered stands, and a part the place was not offered never does,
    // whatever Jev answered: a feature that needs water where none runs.
    const lib = LOOKS.compose.lib;
    const needing = PRIMITIVES.find((p) => p.role === "Feature" && (p.needs ?? []).length > 0);
    if (needing === undefined) throw new Error("No feature needs anything of its place.");
    const wants = (needing.needs ?? []).filter((n): n is string => typeof n === "string");
    const there = planStructure(structure, lib, { id: "packages/app", state: {}, has: wants });
    expect(readStructure(structure, lib, there, fakeJev(there.request, { "feature.present": true, "feature.use": needing.id })).feature).toBe(needing.id);
    const elsewhere = planStructure(structure, lib, { id: "packages/app", state: {} });
    const pick = { ...fakeJev(elsewhere.request, { "feature.present": true }), "feature.use": { type: "choice" as const, choice: needing.id, probabilities: { [needing.id]: 1 }, confidence: 1 } };
    // readStructure rejects a pick it did not offer, or ignores it when only one part was offered.
    const stood = (): string | undefined => {
      try {
        return readStructure(structure, lib, elsewhere, pick).feature;
      } catch {
        return undefined;
      }
    };
    expect(stood()).not.toBe(needing.id);
  });
});
