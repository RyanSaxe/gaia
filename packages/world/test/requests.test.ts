import { describe, expect, it } from "vitest";
import type { CodeFacts, FileFacts, JevAnswer, JevClient, JevQuestion, JevRequest } from "@gaia/schema";
import {
  DESIGNS,
  type DesignName,
  type Exchange,
  type Looks,
  MORE,
  OUTLINE,
  SOURCE_WISH,
  areaOutline,
  areaReadings,
  entityOutline,
  fileOutline,
  fileReadings,
  judgeWorld,
  planWorldRequests,
  requestKey,
  standInJev,
  tokensOf,
} from "@gaia/world";

const file = (path: string, lines: number, imports: string[] = [], importedBy: string[] = []): FileFacts => ({
  path,
  language: "typescript",
  lines,
  symbols: [
    { name: "run", kind: "function", exported: true, line: 3, lines: 40 },
    { name: "Shape", kind: "class", exported: true, line: 50, lines: 60 },
    { name: "helper", kind: "function", exported: false, line: 120, lines: 12 },
  ],
  imports,
  importedBy,
});

function facts(): CodeFacts {
  const files = [
    file("pkg/src/index.ts", 20, ["pkg/src/a.ts", "pkg/src/b.ts"]),
    file("pkg/src/a.ts", 250, ["pkg/src/b.ts"], ["pkg/src/index.ts", "pkg/test/a.test.ts"]),
    file("pkg/src/b.ts", 180, [], ["pkg/src/index.ts", "pkg/src/a.ts"]),
    file("pkg/test/a.test.ts", 90, ["pkg/src/a.ts"]),
    file("app/main.ts", 300, ["pkg/src/index.ts"]),
  ];
  const entity = (path: string, name: string, dependsOn: string[], dependents: string[]) => ({
    path,
    name,
    form: "package" as const,
    files: 2,
    lines: 500,
    exports: 4,
    dependsOn,
    dependents,
    unusedExports: 0,
  });
  return {
    projectId: "demo",
    files,
    entities: [entity("pkg", "pkg", [], ["app"]), entity("app", "app", ["pkg"], [])],
    repository: { name: "demo", files: files.length, lines: 840 },
  };
}

const set = (...keys: string[]) => Object.fromEntries(keys.map((k, i) => [k, { doc: `Option ${k}.`, suits: i === 0 ? ["docs"] : ["source"] }]));
const LOOKS: Looks = {
  world: set("Dawn", "Dusk"),
  land: set("Moor", "Valley"),
  building: set("Cottage", "Mill"),
  landmark: set("Tower", "Oak"),
  trail: set("Path", "Track"),
  form: set("Stone", "Bush"),
  water: set("Dry", "Brook"),
  character: set("Meadow land", "Wood"),
};

/** A huge file: hundreds of symbols with long docs and hundreds of imports. */
const huge: FileFacts = {
  ...file("pkg/src/huge.ts", 9000, Array.from({ length: 300 }, (_, i) => `pkg/src/dep${i}.ts`), Array.from({ length: 300 }, (_, i) => `pkg/src/user${i}.ts`)),
  symbols: Array.from({ length: 500 }, (_, i) => ({ name: `symbol${i}`, kind: "function" as const, exported: i % 2 === 0, line: i * 18 + 1, lines: 17 })),
};

describe("what Jev reads about a thing", () => {
  it("outlines every file, area and entity within its token budget, sizes in words and no line numbers", () => {
    const m = { ...facts(), files: [...facts().files, huge] };
    for (const f of m.files) {
      const outline = fileOutline(f);
      expect(tokensOf(outline)).toBeLessThanOrEqual(OUTLINE.tokens.file);
      expect(JSON.stringify(outline)).not.toMatch(/"line"|"lines"/);
      for (const r of Object.values(fileReadings(m, f))) expect(tokensOf(r.state)).toBeLessThanOrEqual(OUTLINE.tokens.reading);
    }
    // A small file's outline is whole: every symbol, with its doc.
    expect(fileOutline(facts().files[1]!).symbols).toEqual([
      { name: "Shape", kind: "class", exported: true, size: "medium" },
      { name: "run", kind: "function", exported: true, size: "medium" },
      { name: "helper", kind: "function", exported: false, size: "short" },
    ]);
    // A huge one keeps as much as fits and says how much it left out.
    expect(fileOutline(huge).moreSymbols).toBeGreaterThan(400);
    for (const dir of ["", "pkg", "pkg/src"]) {
      expect(tokensOf(areaOutline(m, dir))).toBeLessThanOrEqual(OUTLINE.tokens.area);
      for (const r of Object.values(areaReadings(m, dir))) expect(tokensOf(r.state)).toBeLessThanOrEqual(OUTLINE.tokens.reading);
    }
    for (const e of m.entities) expect(tokensOf(entityOutline(m, e))).toBeLessThanOrEqual(OUTLINE.tokens.entity);
  });

  it("asks only questions Jev can answer, in every design, and the stand-in answers each with one of its options", async () => {
    const jev = standInJev(LOOKS);
    for (const design of Object.keys(DESIGNS) as DesignName[]) {
      for (const { request } of planWorldRequests(facts(), LOOKS, { design })) {
        expect(tokensOf(request)).toBeLessThan(32_000);
        const { answers } = await jev.ask(request);
        for (const [id, q] of Object.entries(request.questions) as [string, JevQuestion][]) {
          expect(answers[id]?.type).toBe(q.type);
          if (q.type === "choice") expect(Object.keys(q.criteria)).toContain(answers[id]?.type === "choice" ? answers[id].choice : "");
          if (q.type === "score") expect(q.criteria.length).toBeLessThanOrEqual(10);
          if (q.type === "choice") expect(Object.keys(q.criteria).length).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it("shares one state per area: every file's questions ride in its area's request, each naming its file, and judge the world as asking each alone does", async () => {
    const own = planWorldRequests(facts(), LOOKS, { design: "revised" });
    const shared = planWorldRequests(facts(), LOOKS, { design: "shared" });
    expect(shared.length).toBeLessThan(own.length);
    expect(shared.some((p) => p.about === "file")).toBe(false);
    const asked = (ps: typeof own) => ps.reduce((n, p) => n + Object.keys(p.request.questions).length, 0);
    expect(asked(shared)).toBe(asked(own));
    for (const p of shared.filter((x) => x.carries !== undefined)) {
      const files = (p.request.state as { files: Record<string, unknown> }).files;
      for (const t of p.carries!.filter((c) => c.about === "file")) {
        expect(files[t.target]).toBeDefined();
        for (const sent of Object.keys(t.questions)) expect(p.request.questions[sent]!.instructions).toContain(`files["${t.target}"]`);
      }
    }
    // The stand-in answers each question from its own file's facts, as Jev answers each question on its own.
    expect(await judgeWorld(facts(), LOOKS, standInJev(LOOKS), { design: "shared" })).toEqual(await judgeWorld(facts(), LOOKS, standInJev(LOOKS), { design: "revised" }));
  });

  it("asks a file again after a one-line edit only when its words change, where summary facts ask again every time", () => {
    const edited = facts();
    const files = edited.files.map((f) => (f.path === "pkg/src/a.ts" ? { ...f, lines: f.lines + 1, symbols: f.symbols.map((s) => ({ ...s, line: (s.line ?? 1) + 1 })) } : f));
    const keyOf = (m: CodeFacts, design: DesignName) => requestKey(planWorldRequests(m, LOOKS, { design }).find((p) => p.target === "pkg/src/a.ts")!.request);
    expect(keyOf({ ...edited, files }, "outline")).toBe(keyOf(facts(), "outline"));
    expect(keyOf({ ...edited, files }, "revised")).not.toBe(keyOf(facts(), "revised"));
  });
});

/** A Jev that is unsure what a file's functions stand as until it has read the file's imports, and says the imports would help. */
function unsureAboutFunctions(log: JevRequest[]): JevClient {
  return {
    async ask(request) {
      log.push(request);
      const state = request.state as Record<string, unknown>;
      const answers: Record<string, JevAnswer> = {};
      for (const [id, q] of Object.entries(request.questions)) {
        if (q.type === "noul") answers[id] = { type: "noul", noul: id === `${MORE}imports` ? 0.9 : 0.2 };
        else if (q.type === "choice") {
          const keys = Object.keys(q.criteria);
          const sure = id !== "form:function" || "itImports" in state;
          const choice = id === "form:function" && sure ? "Bush" : (keys[0] as string);
          answers[id] = { type: "choice", choice, probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? 0.8 : 0.2 / (keys.length - 1)])), confidence: sure ? 0.8 : 0.3 };
        } else answers[id] = { type: "score", score: 0, probabilities: { 0: 1 }, confidence: 1 };
      }
      return { answers, model: request.model, costUsd: 0, ms: 0 };
    },
  };
}

describe("context that grows by Jev's choice", () => {
  it("asks an unsure file again with the readings Jev chose, asking only what it was unsure of, and keeps the surer answer", async () => {
    const log: JevRequest[] = [];
    const exchanges: Exchange[] = [];
    const judged = await judgeWorld(facts(), LOOKS, unsureAboutFunctions(log), { design: "escalate", trace: (e) => exchanges.push(e) });
    const a = exchanges.find((e) => e.target === "pkg/src/a.ts")!;
    expect(Object.keys(a.first.request.questions)).toEqual(expect.arrayContaining(["form:function", `${MORE}imports`, `${MORE}importers`, SOURCE_WISH]));
    expect(a.second?.read).toEqual(["imports"]);
    expect(Object.keys(a.second!.request.questions)).toEqual(["form:function"]);
    expect((a.second!.request.state as { itImports: { name: string }[] }).itImports.map((b) => b.name)).toEqual(["pkg/src/b.ts"]);
    expect(judged.forms["pkg/src/a.ts"]?.function).toBe("Bush");
    // A file that imports nothing reads the first reading Gaia offers instead.
    const b = exchanges.find((e) => e.target === "pkg/src/b.ts")!;
    expect(b.second?.read).toEqual([Object.keys(fileReadings(facts(), facts().files[2]!))[0]]);
    // The world and areas were sure: one request each. Without escalation, never a second.
    expect(exchanges.find((e) => e.about === "world")?.second).toBeUndefined();
    const plain: Exchange[] = [];
    await judgeWorld(facts(), LOOKS, unsureAboutFunctions([]), { design: "outline", trace: (e) => plain.push(e) });
    expect(plain.every((e) => e.second === undefined)).toBe(true);
  });

  it("judges top-down when a design carries character: a file reads its area's land and water, an area the world's light", async () => {
    const exchanges: Exchange[] = [];
    const judged = await judgeWorld(facts(), LOOKS, standInJev(LOOKS), { design: "outline", trace: (e) => exchanges.push(e) });
    const area = exchanges.find((e) => e.about === "area")!;
    expect((area.first.request.state as { world: string }).world.startsWith(`${judged.world}:`)).toBe(true);
    const f = exchanges.find((e) => e.target === "pkg/src/a.ts")!;
    const land = (f.first.request.state as { land: { area: string; landform: string; water: string } }).land;
    expect(land.landform.startsWith(`${judged.lands[land.area === "(the repository's root)" ? "" : land.area]}:`)).toBe(true);
    expect(land.water.startsWith(`${judged.waters[land.area === "(the repository's root)" ? "" : land.area]}:`)).toBe(true);
  });
});
