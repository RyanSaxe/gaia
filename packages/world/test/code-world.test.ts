import { describe, expect, it } from "vitest";
import { biome, landmark, link, structure, world as worldKind } from "@gaia/kinds";
import { PALETTE_FAMILIES, PRIMITIVES } from "@gaia/primitives";
import { type CodeGraph, type CodeFacts, type DefNode, type EntityFacts, type FileFacts, type JevClient, type JevQuestion, type JevRequest, type JevResponse, Library } from "@gaia/schema";
import { cellUnder, placeAt } from "@gaia/terrain";
import { type LookSet, type Looks, composeWorld, formsFor, journalOf, judgeWorld, keptJev, landOf, layoutWorld, planStanding, planWorldRequests, rankThings, requestKey, validate } from "@gaia/world";
import { fakeJevClient } from "./fixtures.ts";

const file = (path: string, lines: number): FileFacts => ({
  path,
  language: path.endsWith(".rs") ? "rust" : path.endsWith(".md") ? "markdown" : "typescript",
  lines,
  // Only code defines functions; a manifest's keys and a document's sections never stand.
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

/** A small repository, its code scaled by `grow`. */
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
/** Forms by size, each offered within its range of rank by importance, wide and overlapping as the world's own are. */
const FORMS: LookSet = {
  Stone: { doc: "Option Stone.", needs: [{ rank: [0, 0.7] }] },
  Bush: { doc: "Option Bush.", needs: [{ rank: [0.2, 1] }] },
  Hall: { doc: "Option Hall.", needs: [{ rank: [0.5, 1] }], composes: "building" },
  Spire: { doc: "Option Spire.", needs: [{ rank: [0.8, 1] }], composes: "landmark" },
};
const LOOKS: Looks = {
  compose: { building: structure, landmark, world: worldKind, biome, link, lib: new Library(PRIMITIVES) },
  form: FORMS,
  water: set("Dry", "Brook"),
};

/** The forms whose range holds a rank, worked out here from the ranges themselves. */
const holding = (rank: number): string[] => Object.keys(FORMS).filter((k) => FORMS[k]?.needs?.every((n) => typeof n !== "string" && rank >= n.rank[0] && rank <= n.rank[1]) ?? true).sort();

/**
 * The fake Jev, except that what each thing stands as is `pick`'s choice among the forms it was offered: by default
 * every entity raises the largest form it is offered and everything else stands as the smallest.
 */
const standing = (pick: (about: "file" | "entity", id: string, offered: readonly string[]) => string = (about, _id, offered) => (about === "entity" ? (offered.find((k) => FORMS[k]?.composes === "landmark") ?? offered.find((k) => FORMS[k]?.composes === "building") ?? offered[0]) : offered.find((k) => FORMS[k]?.composes === undefined)) as string): JevClient => {
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

/** What Jev judged about a world, every building and landmark composed: what a world is laid out from. */
const composed = async (m: CodeFacts, jev: JevClient = standing()) => composeWorld(m, LOOKS, jev, await judgeWorld(m, LOOKS, jev));

describe("a world laid out from code", () => {
  it("composes the whole world part by part, its sky and every land, building, landmark and trail, each part in its own words, never offering Jev a preset or the old model's signals", async () => {
    const asked: JevRequest[] = [];
    const fake = standing();
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
    expect(Object.keys(judged.things).sort()).toEqual(facts().entities.map((e) => e.path).sort());
    for (const [path, t] of Object.entries(judged.things)) {
      const k = t.as === "building" ? structure : landmark;
      if (t.blueprint === undefined) throw new Error(`Nothing was composed for ${path}.`);
      expect(t.blueprint.kind, path).toBe(k.id);
      expect(validate(t.blueprint, k, LOOKS.compose.lib), path).toEqual([]);
    }
    // The sky, each region's land and each trail Jev would walk are composed the same way.
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
    // Laid out, the world stands under its composed sky, and each region on its composed land.
    const laid = layoutWorld(facts(), judged);
    expect(laid.sky).toEqual(judged.sky);
    for (const r of laid.regions) expect(r.biome, r.area).toEqual(judged.lands[r.area]);
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
      await composeWorld(facts(), looks, jev, { ...judged, waters: everywhere, things: buildings, stands: {} });
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
      // Every land is the landform under test, whatever the fake Jev would pick.
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

  it("colors every building and landmark among its land's native families: the one family a land names, and any when it names none", async () => {
    /** Composes the world with every land naming `natives` as its own families: what each thing is offered and wears. */
    const colored = async (natives: readonly string[]): Promise<{ offered: string[][]; worn: string[] }> => {
      const base = standing();
      const offered: string[][] = [];
      const jev: JevClient = {
        async ask(request) {
          const q = request.questions["palette.family"];
          if (q?.type === "choice") offered.push(Object.keys(q.criteria).sort());
          const r = await base.ask(request);
          const answers = { ...r.answers };
          for (const id of Object.keys(request.questions)) {
            const family = /^natives\.families:(.+)$/.exec(id)?.[1];
            if (family !== undefined) answers[id] = { type: "noul", noul: natives.includes(family) ? 0.9 : 0.1 };
          }
          return { ...r, answers };
        },
      };
      const judged = await composed(facts(), jev);
      for (const land of Object.values(judged.lands)) expect(land.slots.natives?.params.families).toEqual(natives);
      return { offered, worn: Object.values(judged.things).map((t) => String(t.blueprint?.slots.palette?.params.family)) };
    };
    const two = await colored(["deep-forest", "silver-birch"]);
    expect(two.offered.length).toBeGreaterThan(0);
    for (const options of two.offered) expect(options).toEqual(["deep-forest", "silver-birch"]);
    for (const family of two.worn) expect(["deep-forest", "silver-birch"]).toContain(family);
    const one = await colored(["teal-gold"]);
    expect(one.offered).toEqual([]);
    expect(new Set(one.worn)).toEqual(new Set(["teal-gold"]));
    const none = await colored([]);
    for (const options of none.offered) expect(options).toEqual(Object.keys(PALETTE_FAMILIES).sort());
  });

  it("asks Jev only about the code's structure, in requests that fit its window, with options it can answer", async () => {
    const looks = planWorldRequests(facts(), LOOKS);
    // The looks ask about each area and each entity's trails; what every file and entity stands as is asked once the
    // code is understood, each file in a request of its own and each entity in its own.
    expect(looks.filter((r) => r.about === "file")).toHaveLength(0);
    expect(looks.filter((r) => r.about === "entity").map((r) => r.target)).toEqual(["packages/app"]);
    const stands = planStanding(facts(), LOOKS).requests;
    expect(stands.filter((r) => r.about === "file")).toHaveLength(facts().files.length);
    expect(stands.filter((r) => r.about === "entity")).toHaveLength(3);
    for (const { request } of [...looks, ...stands]) {
      expect(JSON.stringify(request.state)).not.toContain("contentHash");
      // Jev's window is 32,000 tokens, which the engine counts as 1.8 bytes each.
      expect(JSON.stringify(request).length / 1.8).toBeLessThan(32_000);
      for (const q of Object.values(request.questions) as JevQuestion[]) {
        if (q.type === "choice") expect(Object.keys(q.criteria).length).toBeLessThanOrEqual(255);
        if (q.type === "score") expect(q.criteria.length).toBeLessThanOrEqual(10);
      }
    }
    // The same code gives the same world, answer for answer.
    const a = layoutWorld(facts(), await composed(facts(), fakeJevClient()));
    const b = layoutWorld(facts(), await composed(facts(), fakeJevClient()));
    expect(a.standing.length + a.things.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it("asks a file again after an edit only when its words change", () => {
    const keyOf = (m: CodeFacts): string => requestKey(planStanding(m, LOOKS).requests.find((p) => p.target === "packages/core/src/math.ts")!.request);
    const edit = (grow: number, exported = "x"): CodeFacts => ({
      ...facts(),
      files: facts().files.map((f) => (f.path === "packages/core/src/math.ts" ? { ...f, lines: f.lines + grow, symbols: f.symbols.map((x) => ({ ...x, line: (x.line ?? 1) + grow, name: x.name === "x" ? exported : x.name })) } : f)),
    });
    // No line count reaches Jev, so a longer file asks nothing again; a renamed export changes what it says.
    expect(keyOf(edit(1))).toBe(keyOf(facts()));
    expect(keyOf(edit(1000))).toBe(keyOf(facts()));
    expect(keyOf(edit(0, "tangent"))).not.toBe(keyOf(facts()));
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
    // Each patch holds ground in proportion to its code: the two longest files hold the most, within a fair margin of their share.
    for (const p of world.patches) {
      expect(counts.get(p.path) ?? 0).toBeGreaterThan(0);
      expect(Math.abs((counts.get(p.path) ?? 0) - p.ground)).toBeLessThan(Math.max(80, p.ground * 0.25));
    }
    const ground = (path: string) => world.patches.find((p) => p.path === path)!.ground;
    expect(ground("packages/core/src/shapes.ts")).toBeGreaterThan(ground("packages/core/src/math.ts"));
    expect(ground("packages/core/src/math.ts")).toBeGreaterThan(ground("packages/core/src/index.ts") * 4);
    // Areas nest: a directory's ground is its own and its subdirectories'.
    const area = (path: string) => world.areas.find((a) => a.path === path)!;
    expect(area("packages/app/src").ground).toBeGreaterThan(area("packages/app/src/ui").ground);
    expect(Math.abs(area("packages/app").ground - area("packages/app/src").ground - (counts.get("lot:packages/app") ?? 0) - (counts.get("packages/app/package.json") ?? 0))).toBeLessThan(200);
    // Each entity stands in its own area; each standing symbol on its own file's patch.
    expect(world.things.map((t) => t.path).sort()).toEqual(["", "packages/app", "packages/core"]);
    for (const t of world.things) expect(placeAt(world, t.x, t.z).area.path).toBe(t.path);
    expect(world.symbols.length).toBeGreaterThan(0);
    for (const s of world.symbols) expect(placeAt(world, s.x, s.z).file?.path).toBe(s.file);
    // Every file stands as one thing too, at its patch's heart.
    expect(world.standing.filter((s) => s.of === "file").map((s) => s.path).sort()).toEqual(facts().files.map((f) => f.path).sort());
    for (const s of world.standing) if (s.file !== undefined) expect(placeAt(world, s.x, s.z).file?.path).toBe(s.file);
    // Each region's land is its cells, so its cover changes exactly where its areas end.
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
    const standing = world.symbols.filter((s) => s.file === math);
    expect(standing.map((s) => s.id).sort()).toEqual([`${math}#Calc`, `${math}#Calc.add`, `${math}#Calc.mul`, `${math}#Opts`, `${math}#square`]);
    expect(world.symbols.filter((s) => s.file !== math)).toEqual([]);
    const by = new Map(standing.map((s) => [s.name, s]));
    expect(by.get("add")?.parent).toBe(`${math}#Calc`);
    expect(by.get("Calc")?.importance).toBe(0.9);
    expect(by.get("square")?.importance).toBeUndefined();
    // Each stands on its file's patch, on a plot of its own.
    for (const s of standing) expect(placeAt(world, s.x, s.z).file?.path).toBe(math);
    expect(new Set(standing.map((s) => `${s.x},${s.z}`)).size).toBe(standing.length);
    // The patch holds room for its definitions: with them, math.ts is a larger share of the land than without them.
    const share = (w: typeof world) => w.patches.find((p) => p.path === math)!.ground / w.patches.reduce((n, p) => n + p.ground, 0);
    const bare: CodeGraph = { ...graph, nodes: graph.nodes.filter((n) => n.kind !== "def") };
    expect(share(world)).toBeGreaterThan(share(layoutWorld(facts(), judged, bare)));
    // The land is known before Jev answers, with the graph too.
    expect(landOf(facts(), graph).cells).toEqual(world.cells);
    // The journal has one entry for every directory below the root, every thing standing, every file, every file with
    // definitions as a thing of its own and every definition, each after the one it sits under.
    const journal = journalOf(world);
    const count = world.areas.length - 1 + world.things.length + world.patches.length + new Set(world.symbols.map((s) => s.file)).size + world.symbols.length;
    expect(new Set(journal.entries.map((e) => e.of)).size).toBe(count);
    expect(journal.entries.length).toBe(count);
    for (const e of journal.entries) if (e.under !== undefined) expect(journal.entry(e.under)?.page).toBeLessThan(e.page);
  });

  it("gives every definition of a crowded file a plot of its own: a closure holding two hundred functions, sixty more beside it", async () => {
    const lab = "packages/app/src/main.ts";
    const def = (name: string, start: number, end: number, parent?: string): DefNode => ({
      kind: "def", id: `def:${lab}#${parent === undefined ? name : `${parent}.${name}`}`, lineage: name, file: `file:${lab}`, name, role: "function", span: { start, end },
      signature: `function ${name}`, exported: false, measures: { lines: end - start + 1 }, ...(parent === undefined ? {} : { parent: `def:${lab}#${parent}` }),
      judged: { value: { importance: 0.2, quality: null, concepts: {} } },
    });
    const graph: CodeGraph = {
      projectId: "demo", name: "demo", edges: [], pending: [],
      nodes: [
        { kind: "file", id: `file:${lab}`, lineage: "l", path: lab, language: "typescript", bytes: 1, hash: "", binary: false, unparsed: 0, conventions: [], measures: { lines: 250 } },
        def("createLab", 1, 2700),
        ...Array.from({ length: 200 }, (_, i) => def(`inner${i}`, 10 + i * 13, 20 + i * 13, "createLab")),
        ...Array.from({ length: 60 }, (_, i) => def(`outer${i}`, 2701 + i * 10, 2709 + i * 10)),
      ],
    };
    const world = layoutWorld(facts(), await judgeWorld(facts(), LOOKS, fakeJevClient()), graph);
    const standing = world.symbols.filter((s) => s.file === lab);
    expect(standing.length).toBe(261);
    for (const s of standing) expect(placeAt(world, s.x, s.z).file?.path, s.name).toBe(lab);
    expect(new Set(standing.map((s) => `${s.x},${s.z}`)).size).toBe(standing.length);
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
    const landmarks = { ...judged, things: Object.fromEntries(Object.keys(judged.things).map((path) => [path, { as: "landmark" as const, blueprint }])) };
    const land = landOf(facts());
    for (const world of [layoutWorld(facts(), judged), layoutWorld(facts(), landmarks)]) {
      expect(world.size).toBe(land.size);
      expect(world.cells).toEqual(land.cells);
      expect(world.areas.map(({ path, x, z }) => ({ path, x, z }))).toEqual(land.areas.map(({ path, x, z }) => ({ path, x, z })));
      expect(world.patches.map(({ path, x, z, radius }) => ({ path, x, z, radius }))).toEqual(land.patches.map(({ path, x, z, radius }) => ({ path, x, z, radius })));
      expect(world.things.map(({ x, z }) => ({ x, z }))).toEqual(land.lots);
    }
  });

  it("holds still under small edits: one that crosses no rung moves nothing, and a new file moves only its own folder", async () => {
    const judged = await composed(facts());
    const before = layoutWorld(facts(), judged);
    const moved = (after: typeof before): string[] =>
      before.patches.filter((p) => {
        const q = after.patches.find((o) => o.path === p.path);
        return q !== undefined && Math.hypot(p.x - q.x, p.z - q.z) > 0.5;
      }).map((p) => p.path);
    const menu = "packages/app/src/ui/menu.ts";
    const grow = (lines: number): CodeFacts => ({ ...facts(), files: facts().files.map((f) => (f.path === menu ? { ...f, lines: f.lines + lines } : f)) });
    // A few lines more leave menu.ts's ground on its rung: the land is exactly as it was.
    const edited = layoutWorld(grow(3), judged);
    expect(edited.size).toBe(before.size);
    const place = (w: typeof before) => w.patches.map(({ path, x, z, ground }) => ({ path, x, z, ground }));
    expect(place(edited)).toEqual(place(before));
    expect(edited.cells).toEqual(before.cells);
    // A small new file re-divides its own folder, which stays on its rung. Every patch elsewhere stays, but one beside
    // the folder may be nudged by a step as the folder's new borders are redrawn (`sitesOf`).
    const added: CodeFacts = { ...facts(), files: [...facts().files, file("packages/app/src/ui/toolbar.ts", 20)] };
    const after = layoutWorld(added, judged);
    const outside = moved(after).filter((p) => !p.startsWith("packages/app/src/ui/"));
    expect(outside.length).toBeLessThanOrEqual(1);
    for (const path of outside) {
      const [a, b] = [before, after].map((w) => w.patches.find((p) => p.path === path)!);
      expect(Math.hypot(a!.x - b!.x, a!.z - b!.z)).toBeLessThanOrEqual(3);
    }
  });

  it("lets Jev choose each symbol's form and each area's water, and chooses trails that join every connected part first", async () => {
    const judged = await composed(facts(), fakeJevClient());
    // The default design asks each thing on its own, among the forms its rank is offered: `#x` is math.ts's function x.
    expect(holding(0.5)).toContain(judged.stands?.["packages/core/src/math.ts#x"]);
    expect(holding(0.5)).toContain(judged.stands?.["packages/core/src/math.ts"]);
    for (const w of Object.values(judged.waters)) expect(["Dry", "Brook"]).toContain(w);
    const world = layoutWorld(facts(), { ...judged, trails: [{ from: "packages/app", to: "packages/core", want: 0.9 }, { from: "", to: "packages/core", want: 0.6 }, { from: "", to: "packages/app", want: 0.3 }] });
    expect(world.trails.map((t) => `${t.from}->${t.to}`)).toEqual(["packages/app->packages/core", "->packages/core"]);
    expect(world.trails.every((t) => t.spans)).toBe(true);
  });

  it("under the judged design, asks what every file, its definitions and every entity stand as, each on its own, over as many requests as a file needs", async () => {
    const planned = planStanding(facts(), LOOKS).requests;
    const math = planned.find((p) => p.target === "packages/core/src/math.ts")!;
    expect(Object.keys(math.request.questions).sort()).toEqual(["form", "form#helper", "form#x"]);
    expect(math.stands).toEqual({ form: "packages/core/src/math.ts", "form#helper": "packages/core/src/math.ts#helper", "form#x": "packages/core/src/math.ts#x" });
    // A file with nothing standing on its patch is asked what it stands as itself.
    expect(Object.keys(planned.find((p) => p.target === "README.md")!.request.questions)).toEqual(["form"]);
    // A file with more definitions than one request asks about is asked over several, each definition once and the file once.
    const crowded = { ...facts(), files: facts().files.map((f) => (f.path === "packages/core/src/math.ts" ? { ...f, symbols: Array.from({ length: 30 }, (_, k) => ({ name: `f${k}`, kind: "function" as const, exported: false, line: 1 + k * 9, lines: 8 })) } : f)) };
    const asked = planStanding(crowded, LOOKS).requests.filter((p) => p.target === "packages/core/src/math.ts");
    expect(asked.length).toBe(2);
    expect(asked.flatMap((p) => Object.keys(p.request.questions)).sort()).toEqual(["form", ...Array.from({ length: 30 }, (_, k) => `form#f${k}`)].sort());
    // A Jev that gives each thing its own form.
    const jev = standing((about, id) => (about === "entity" ? "Hall" : id === "form#x" ? "Stone" : "Bush"));
    const world = layoutWorld(facts(), await composed(facts(), jev));
    const forms = Object.fromEntries(world.symbols.filter((s) => s.file === "packages/core/src/math.ts").map((s) => [s.name, s.form]));
    expect(forms).toEqual({ x: "Stone", helper: "Bush" });
    expect(world.standing.find((s) => s.path === "packages/core/src/math.ts")?.form).toBe("Bush");
  });

  it("offers every entity, file and definition exactly the forms whose range holds its rank by importance, says its importance, and stands what Jev raises as a building or a landmark on its own ground", async () => {
    const math = "packages/core/src/math.ts";
    const value = (importance: number) => ({ judged: { value: { importance, quality: 0.7, concepts: {} } } });
    const fileNode = (path: string, importance: number) => ({ kind: "file" as const, id: `file:${path}`, lineage: path, path, language: "typescript", bytes: 1, hash: "", binary: false, unparsed: 0, conventions: [], measures: { lines: 10 }, ...value(importance) });
    const def = (name: string, start: number, end: number, importance: number): DefNode => ({ kind: "def", id: `def:${math}#${name}`, lineage: name, file: `file:${math}`, name, role: "function", span: { start, end }, signature: `function ${name}()`, exported: true, measures: { lines: end - start + 1 }, ...value(importance) });
    const graph: CodeGraph = {
      projectId: "demo", name: "demo", pending: [],
      edges: [{ kind: "calls", from: `def:${math}#helper`, to: `def:${math}#heart`, by: { by: "rule" } }],
      nodes: [
        ...facts().entities.map((e, i) => ({ kind: "dir" as const, id: `dir:${e.path}`, lineage: e.path, path: e.path, measures: { lines: 100 }, ...value(0.3 + 0.1 * i) })),
        ...facts().files.map((f, i) => fileNode(f.path, f.path === math ? 0.99 : 0.05 * i)),
        def("heart", 1, 60, 1),
        def("helper", 70, 90, 0.02),
      ],
    };
    const ranks = rankThings(facts(), graph);
    const planned = planStanding(facts(), LOOKS, { graph }).requests;
    for (const p of planned) {
      for (const [qid, id] of Object.entries(p.stands ?? {})) {
        const q = p.request.questions[qid];
        if (q?.type !== "choice") throw new Error(`${qid} is not a choice.`);
        // Offered exactly what its rank's ranges hold: never a form outside them.
        expect(Object.keys(q.criteria).sort(), id).toEqual(holding(ranks.get(id) as number));
        expect(formsFor(LOOKS, ranks.get(id) as number)).toEqual(holding(ranks.get(id) as number));
      }
    }
    // The most important things are offered the largest forms, and the least never are.
    expect(holding(ranks.get(`${math}#heart`) as number)).toEqual(["Bush", "Hall", "Spire"]);
    expect(holding(ranks.get(`${math}#helper`) as number)).toEqual(["Stone"]);
    // A thing offered one form alone stands as it with no question.
    const plan = planStanding(facts(), LOOKS, { graph });
    expect(plan.only[`${math}#helper`]).toBe("Stone");
    expect(Object.values(plan.requests).some((p) => Object.values(p.stands ?? {}).includes(`${math}#helper`))).toBe(false);
    // Each request says how much its things matter.
    const own = planned.find((p) => p.target === math)!;
    const state = own.request.state as { file: { importance?: number; standing?: { name: string; importance?: number }[] } };
    expect(state.file.importance).toBe(0.99);
    expect(state.file.standing?.find((d) => d.name === "heart")?.importance).toBe(1);
    // Raised, the file and its heart stand as a building and a landmark composed part by part, on the file's own patch.
    const raise = standing((_about, _id, offered) => offered.find((k) => FORMS[k]?.composes === "landmark") ?? offered.find((k) => FORMS[k]?.composes === "building") ?? (offered[0] as string));
    const judged = await composeWorld(facts(), LOOKS, raise, await judgeWorld(facts(), LOOKS, raise), { graph });
    const world = layoutWorld(facts(), judged, graph);
    const heart = world.things.find((t) => t.path === `${math}#heart`);
    const file = world.things.find((t) => t.path === math);
    expect([heart?.of, heart?.as, file?.of, file?.as]).toEqual(["definition", "landmark", "file", "landmark"]);
    for (const t of [heart, file]) {
      if (t === undefined) throw new Error("Nothing was raised.");
      expect(validate(t.blueprint, landmark, LOOKS.compose.lib), t.path).toEqual([]);
      expect(placeAt(world, t.x, t.z).file?.path).toBe(math);
    }
    // A definition's landmark reads what leans on it; the definition still has its own entry, standing as the landmark.
    expect(heart?.facts?.dependents).toEqual([`def:${math}#helper`]);
    expect(world.symbols.find((s) => s.id === `${math}#heart`)?.form).toBe("Spire");
    // The land is the same whatever was raised.
    expect(landOf(facts(), graph).cells).toEqual(world.cells);
  });

  it("ranks every thing among the world's own, so each form is offered to the same share of things however large the world", () => {
    const share = (n: number): Record<string, number> => {
      const files = Array.from({ length: n }, (_, i) => file(`data/f${String(i).padStart(4, "0")}.json`, 20));
      const graph: CodeGraph = { projectId: "big", name: "big", edges: [], pending: [], nodes: files.map((f, i) => ({ kind: "file" as const, id: `file:${f.path}`, lineage: f.path, path: f.path, language: "json", bytes: 1, hash: "", binary: false, unparsed: 0, conventions: [], measures: { lines: 20 }, judged: { value: { importance: ((i * 7919) % n) / n, quality: 1, concepts: {} } } })) };
      const ranks = rankThings({ projectId: "big", files, entities: [], repository: { name: "big", files: n, lines: n * 20 } }, graph);
      const counts: Record<string, number> = {};
      for (const r of ranks.values()) for (const k of formsFor(LOOKS, r)) counts[k] = (counts[k] ?? 0) + 1 / n;
      return counts;
    };
    for (const n of [50, 500]) {
      const got = share(n);
      for (const [k, look] of Object.entries(FORMS)) {
        const range = look.needs?.[0];
        if (range === undefined || typeof range === "string") throw new Error(`${k} has no range.`);
        expect(Math.abs((got[k] ?? 0) - (range.rank[1] - range.rank[0])), `${k} in a world of ${n}`).toBeLessThan(2 / n + 1e-9);
      }
    }
  });

  it("keeps Jev's answers: a stored one is used without asking, and a request Jev cannot answer fails, naming it and why, with nothing guessed", async () => {
    const planned = planWorldRequests(facts(), LOOKS);
    const area = planned.find((p) => p.about === "area");
    const file = planStanding(facts(), LOOKS).requests.find((p) => p.about === "file");
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
    // A request that fails once the client has retried it fails the same way, with the client's reason.
    const down = keptJev({ ask: () => Promise.reject(new Error("OpenRouter answered 503")) }, { stored: new Map(), keep: () => undefined });
    await expect(down.ask(file!.request)).rejects.toThrow(/the file .*: OpenRouter answered 503/);
    // With Jev not to be asked, a request with no kept answer fails, saying why, rather than guessing.
    const offline = keptJev(null, { stored: new Map(), keep: () => undefined, unasked: "Jev is off" });
    await expect(offline.ask(area!.request)).rejects.toThrow(/no answer kept for it, and Jev is off/);
  });
});
