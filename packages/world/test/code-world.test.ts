import { describe, expect, it } from "vitest";
import type { CodeModel, EntityFacts, FileFacts, JevClient, JevQuestion, JevResponse } from "@gaia/schema";
import { cellUnder, placeAt } from "@gaia/terrain";
import { type Judge, type Looks, codeGraph, judgeWorld, keptJev, layoutWorld, planWorldRequests, requestKey, standInJev } from "@gaia/world";

const file = (path: string, lines: number, kind: FileFacts["kind"] = "source"): FileFacts => ({
  path,
  language: path.endsWith(".rs") ? "rust" : path.endsWith(".md") ? "markdown" : "typescript",
  kind,
  contentHash: "",
  lines,
  symbols: [
    { name: "x", kind: "function", exported: true, doc: "Does x.", line: 3, lines: Math.max(1, Math.round(lines / 3)) },
    { name: "helper", kind: "function", exported: false, line: 40, lines: Math.max(1, Math.round(lines / 4)) },
  ],
  imports: [],
  importedBy: [],
  doc: `The ${path} file.`,
  tests: { coveredBy: [], failing: [] },
  complexity: { functions: 1, longestFunction: 10, maxNesting: 1 },
  diagnostics: { errors: 0, warnings: 0, lint: 0 },
  debtMarkers: 0,
  unused: false,
  git: { daysSinceFirstCommit: 10, commitsLast14Days: 1 },
});

const entity = (path: string, name: string, dependsOn: string[], dependents: string[]): EntityFacts => ({
  path,
  name,
  form: "package",
  files: 3,
  lines: 600,
  languages: ["typescript"],
  exports: 10,
  dependsOn,
  dependents,
  tests: { files: 1, failing: 0, covered: 1 },
  diagnostics: { errors: 0, warnings: 0, lint: 0 },
  debtMarkers: 0,
  unusedExports: 0,
  git: { daysSinceFirstCommit: 10, commitsLast14Days: 2, contributors: 1 },
});

/** A small repository, its code scaled by `grow`. */
function model(grow = 1): CodeModel {
  const files = [
    file("package.json", 20, "config"),
    file("README.md", 80, "docs"),
    file("packages/core/package.json", 15, "config"),
    file("packages/core/src/index.ts", 10),
    file("packages/core/src/math.ts", 300 * grow),
    file("packages/core/src/shapes.ts", 420 * grow),
    file("packages/core/test/math.test.ts", 90, "test"),
    file("packages/app/package.json", 15, "config"),
    file("packages/app/src/main.ts", 250 * grow),
    file("packages/app/src/ui/panel.ts", 180 * grow),
    file("packages/app/src/ui/menu.ts", 120 * grow),
  ];
  return {
    projectId: "demo",
    files,
    entities: [entity("", "demo", [], []), entity("packages/app", "@demo/app", ["packages/core"], []), entity("packages/core", "@demo/core", [], ["packages/app"])],
    repository: { name: "demo", files: files.length, lines: files.reduce((n, f) => n + f.lines, 0), languages: { typescript: 1000 }, ageDays: 10, commitsLast30Days: 12, contributors: 1 },
  };
}

const set = (...keys: string[]) => Object.fromEntries(keys.map((k, i) => [k, { doc: `Option ${k}.`, suits: i === 0 ? ["docs", "config"] : ["source", "package"] }]));
const LOOKS: Looks = {
  world: set("Dawn", "Dusk"),
  land: set("Moor", "Valley", "Hills"),
  vibe: set("Meadow", "Oak", "Fir"),
  building: set("Cottage", "Mill"),
  landmark: set("Tower", "Oak"),
  trail: set("Path", "Track"),
  form: set("Stone", "Bush"),
  water: set("Dry", "Brook"),
  character: set("Meadow land", "Wood"),
};

describe("a world laid out from code", () => {
  it("asks Jev only about facts and doc comments, with options it can answer, and the stand-in answers every question from them", async () => {
    const requests = planWorldRequests(model(), LOOKS);
    expect(requests.filter((r) => r.about === "file")).toHaveLength(11);
    expect(requests.filter((r) => r.about === "entity")).toHaveLength(3);
    const jev = standInJev(LOOKS);
    for (const { request } of requests) {
      const text = JSON.stringify(request.state);
      expect(text).not.toContain("contentHash");
      const { answers } = await jev.ask(request);
      for (const [id, q] of Object.entries(request.questions) as [string, JevQuestion][]) {
        const a = answers[id];
        expect(a?.type).toBe(q.type === "score" ? "score" : q.type);
        if (q.type === "choice" && a?.type === "choice") expect(Object.keys(q.criteria)).toContain(a.choice);
      }
    }
    // The same code gives the same world, answer for answer.
    const a = layoutWorld(model(), await judgeWorld(model(), LOOKS, jev));
    const b = layoutWorld(model(), await judgeWorld(model(), LOOKS, standInJev(LOOKS)));
    expect(b).toEqual(a);
  });

  it("builds one graph of the code: directories hold files, files hold their functions, entities depend on entities", () => {
    const g = codeGraph(model());
    const node = (id: string) => g.nodes.find((n) => n.id === id);
    expect(node("file:packages/core/src/math.ts")?.parent).toBe("dir:packages/core/src");
    expect(node("symbol:packages/core/src/math.ts#helper")).toMatchObject({ kind: "symbol", parent: "file:packages/core/src/math.ts", lines: 75, symbol: { exported: false } });
    expect(node("dir:packages/core")?.lines).toBe(15 + 10 + 300 + 420 + 90);
    expect(g.edges).toContainEqual({ from: "entity:packages/app", to: "entity:packages/core", kind: "depends", weight: 1 });
    expect(g.edges).toContainEqual({ from: "dir:packages/app/src", to: "dir:packages/app/src/ui", kind: "contains", weight: 1 });
  });

  it("divides the land among directories and files by their code, with no gaps, nested as the tree nests, and what placeAt reads agrees", async () => {
    const world = layoutWorld(model(), await judgeWorld(model(), LOOKS, standInJev(LOOKS)));
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
    // Each region's land is its cells, so its cover changes exactly where its areas end.
    for (const r of world.regions) expect(r.sites.length).toBeGreaterThan(0);
    expect(world.regions.reduce((n, r) => n + r.sites.length, 0)).toBe(world.cells.length);
    const bigger = layoutWorld(model(30), await judgeWorld(model(30), LOOKS, standInJev(LOOKS)));
    expect(bigger.size).toBeGreaterThan(world.size);
  });

  it("moves little when a little code changes", async () => {
    const before = layoutWorld(model(), await judgeWorld(model(), LOOKS, standInJev(LOOKS)));
    const grown = model();
    const changed: CodeModel = { ...grown, files: grown.files.map((f) => (f.path === "packages/app/src/ui/menu.ts" ? { ...f, lines: f.lines + 12 } : f)) };
    const after = layoutWorld(changed, await judgeWorld(changed, LOOKS, standInJev(LOOKS)));
    const moved = before.patches.map((p) => {
      const q = after.patches.find((o) => o.path === p.path)!;
      return Math.hypot(p.x - q.x, p.z - q.z);
    });
    // Most patches stay within a few meters; none jumps across the world.
    moved.sort((a, b) => a - b);
    expect(moved[Math.floor(moved.length / 2)]!).toBeLessThan(6);
    expect(moved[moved.length - 1]!).toBeLessThan(before.size / 3);
  });

  it("lets Jev choose each symbol's form and each area's water and character, and chooses trails that join every connected part first", async () => {
    const judged = await judgeWorld(model(), LOOKS, standInJev(LOOKS));
    expect(Object.keys(judged.forms)).toContain("packages/core/src/math.ts");
    expect(["Stone", "Bush"]).toContain(judged.forms["packages/core/src/math.ts"]!.function);
    for (const w of Object.values(judged.waters)) expect(["Dry", "Brook"]).toContain(w);
    // Every area with land of its own is judged for how its trees and open ground lie, and its region carries the choice.
    expect(Object.keys(judged.characters).sort()).toEqual(Object.keys(judged.waters).sort());
    for (const r of layoutWorld(model(), judged).regions) expect(Object.keys(LOOKS.character)).toContain(r.character);
    const world = layoutWorld(model(), { ...judged, trails: [{ from: "packages/app", to: "packages/core", want: 0.9, look: "Path" }, { from: "", to: "packages/core", want: 0.6, look: "Track" }, { from: "", to: "packages/app", want: 0.3, look: "Path" }] });
    expect(world.trails.map((t) => `${t.from}->${t.to}`)).toEqual(["packages/app->packages/core", "->packages/core"]);
    expect(world.trails.every((t) => t.spans)).toBe(true);
  });

  it("keeps Jev's answers: a stored one is used without asking, and one outside the options is left to the stand-in", async () => {
    const planned = planWorldRequests(model(), LOOKS);
    const world = planned.find((p) => p.about === "world");
    const file = planned.find((p) => p.about === "file");
    const standIn = standInJev(LOOKS);
    const stored = await standIn.ask(world!.request);
    const asked: string[] = [];
    // A Jev that answers every choice with an option it was never offered.
    const wayward: JevClient = {
      async ask(request) {
        asked.push(requestKey(request));
        return { answers: { vibe: { type: "choice", choice: "Bamboo", probabilities: {}, confidence: 1 } }, model: "jev", costUsd: 0, ms: 1 };
      },
    };
    const kept: JevResponse[] = [];
    const judges = new Map<string, Judge>();
    const jev = keptJev(wayward, standIn, { stored: new Map([[requestKey(world!.request), stored]]), keep: (_, r) => kept.push(r), settled: (k, j) => judges.set(k, j) });
    expect(await jev.ask(world!.request)).toEqual(stored);
    const vibe = (await jev.ask(file!.request)).answers.vibe;
    expect(vibe?.type === "choice" && Object.keys(LOOKS.vibe)).toContain(vibe?.type === "choice" ? vibe.choice : "");
    expect(vibe).toEqual((await standIn.ask(file!.request)).answers.vibe);
    expect(asked).toEqual([requestKey(file!.request)]);
    expect(kept).toEqual([]);
    expect([...judges.values()]).toEqual(["jev", "stand-in"]);
  });
});
