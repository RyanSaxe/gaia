import { describe, expect, it } from "vitest";
import type { CodeModel, EntityFacts, FileFacts, JevQuestion } from "@gaia/schema";
import { type Looks, judgeWorld, layoutWorld, planWorldRequests, standInJev } from "@gaia/world";

const file = (path: string, lines: number, kind: FileFacts["kind"] = "source"): FileFacts => ({
  path,
  language: path.endsWith(".rs") ? "rust" : path.endsWith(".md") ? "markdown" : "typescript",
  kind,
  contentHash: "",
  lines,
  symbols: [{ name: "x", kind: "function", exported: true, doc: "Does x." }],
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

  it("puts each file's patch in its directory's area, nests areas, stands each entity in its own area, and grows with the code", async () => {
    const world = layoutWorld(model(), await judgeWorld(model(), LOOKS, standInJev(LOOKS)));
    const area = (path: string) => world.areas.find((a) => a.path === path)!;
    const inside = (p: { x: number; z: number; radius: number }, a: { x: number; z: number; radius: number }) => Math.hypot(p.x - a.x, p.z - a.z) + p.radius <= a.radius + 1e-6;
    for (const p of world.patches) expect(inside(p, area(p.area))).toBe(true);
    for (const a of world.areas) if (a.parent !== null) expect(inside(a, area(a.parent))).toBe(true);
    for (const [i, p] of world.patches.entries()) {
      for (const q of world.patches.slice(i + 1)) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(p.radius + q.radius);
    }
    expect(world.things.map((t) => t.path).sort()).toEqual(["", "packages/app", "packages/core"]);
    for (const t of world.things) expect(inside({ x: t.x, z: t.z, radius: t.lot }, area(t.area))).toBe(true);
    // A larger patch for a longer file.
    const patch = (path: string) => world.patches.find((p) => p.path === path)!;
    expect(patch("packages/core/src/shapes.ts").radius).toBeGreaterThan(patch("packages/core/src/index.ts").radius);
    const bigger = layoutWorld(model(30), await judgeWorld(model(30), LOOKS, standInJev(LOOKS)));
    expect(bigger.size).toBeGreaterThan(world.size);

  });
});
