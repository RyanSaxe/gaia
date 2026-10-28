import { describe, expect, it } from "vitest";
import { journalOf, ownOf } from "@gaia/world";
import { conceptsCaption } from "./caption.ts";
import { type WordsSource, appendixWords, contentsWords, mostImportant, proseOf, wordsOf } from "./words.ts";
import type { JudgedThing } from "../../world-service/protocol.ts";

const MATH = "core/math.ts";
const world = {
  name: "demo",
  areas: [
    { path: "", name: "demo", parent: null },
    { path: "core", name: "core", parent: "" },
  ],
  patches: [
    { path: MATH, name: "math.ts", area: "core" },
    { path: "README.md", name: "README.md", area: "" },
  ],
  symbols: [
    { id: `${MATH}#Calc`, file: MATH, name: "Calc", kind: "class" as const, line: 2, lines: 5 },
    { id: `${MATH}#Calc.add`, file: MATH, parent: `${MATH}#Calc`, name: "add", kind: "function" as const, line: 3, lines: 1 },
  ],
};
const TEXT = ["// math", "export class Calc {", "  add(a: number) { return a + 1; }", "", "  // more", "}"];

const source = (lines: readonly string[] | undefined): WordsSource => ({
  journal: journalOf(world),
  world,
  vitality: (of) => ({ "": 0.8, core: 0.6, [MATH]: 0.5, [ownOf(MATH)]: 0.5, [`${MATH}#Calc`]: 0.3, [`${MATH}#Calc.add`]: 0.9, "README.md": 1 })[of] ?? 1,
  lines: (path) => (path === "README.md" ? ["# Demo", "", "Adds numbers."] : lines),
});

describe("what a journal page says", () => {
  it("lists a chapter's chapters and files, a file's definitions under their own, each with its own vitality and page; a definition is its code after its signature", () => {
    const src = source(TEXT);
    const j = src.journal;
    expect(contentsWords(src).body).toEqual({ kind: "rows", rows: [{ of: "core", name: "core", depth: 0, vitality: 0.6, page: j.entry("core")?.page }, { of: "README.md", name: "README.md", depth: 0, vitality: 1, page: j.entry("README.md")?.page }] });
    const file = wordsOf(src, j.entry(MATH)!);
    expect(file).toMatchObject({ path: ["core"], name: "math.ts", vitality: 0.5 });
    // A file with definitions lists its own page first.
    expect(file.body.kind === "rows" && file.body.rows.map((r) => [r.of, r.depth, r.vitality])).toEqual([[ownOf(MATH), 0, 0.5], [`${MATH}#Calc`, 0, 0.3], [`${MATH}#Calc.add`, 1, 0.9]]);
    const calc = wordsOf(src, j.entry(`${MATH}#Calc`)!);
    expect(calc).toMatchObject({ path: ["core", "math.ts"], name: "Calc", vitality: 0.3, signature: "export class Calc {", body: { kind: "code", first: 3, opensAt: 3 } });
    expect(calc.body.kind === "code" && calc.body.lines).toEqual(TEXT.slice(2, 6));
    // Until the file's text arrives, a definition's page has its path and name but no code.
    expect(wordsOf(source(undefined), j.entry(`${MATH}#Calc`)!)).toMatchObject({ name: "Calc", body: { kind: "code", lines: [] } });
  });

  it("shows a file as a thing by its own text, each definition folded to a line that turns to its page, and a file with none by its whole text, a document's as prose", () => {
    const src = source(TEXT);
    const own = wordsOf(src, src.journal.entry(ownOf(MATH))!);
    expect(own).toMatchObject({ path: ["core"], name: "math.ts", vitality: 0.5, body: { kind: "code", first: 1, lines: TEXT, opensAt: 1 } });
    // Calc keeps its first line and folds its body, which includes the nested add.
    expect(own.body.kind === "code" && own.body.folded).toEqual([{ from: 3, to: 6, of: `${MATH}#Calc`, page: src.journal.entry(`${MATH}#Calc`)?.page }]);
    expect(wordsOf(src, src.journal.entry("README.md")!)).toMatchObject({ path: [], name: "README.md", body: { kind: "code", first: 1, lines: ["# Demo", "", "Adds numbers."], prose: true } });
    // A binary file, such as an image, shows no lines.
    const image = { ...src, lines: () => ["\u0089PNG", "\u0000\u0000"] };
    expect(wordsOf(image, src.journal.entry("README.md")!).body).toMatchObject({ lines: [] });
  });

  it("sets a document as its paragraphs: wrapped lines joined, each heading, item and fenced line its own", () => {
    const doc = ["# Gaia", "", "Gaia turns a codebase into", "a [world](https://gaia.dev) to wander.", "", "", "- one item that", "  runs on", "- **two**", "```ts", "const x = 1;", "```", "Done."];
    expect(proseOf(doc)).toEqual({
      lines: ["# Gaia", "", "Gaia turns a codebase into a world to wander.", "", "• one item that runs on", "• two", "const x = 1;", "Done."],
      pre: [false, false, false, false, false, false, true, false],
    });
  });

  it("leads a file with its most important definition, plain, folded around its key block; a definition's page is its code plain, and only the appendix marks Jev's blocks", () => {
    const OPS = "core/ops.ts";
    const ops = {
      name: "demo",
      areas: [{ path: "", name: "demo", parent: null }, { path: "core", name: "core", parent: "" }],
      patches: [{ path: OPS, name: "ops.ts", area: "core" }],
      symbols: [
        { id: `${OPS}#big`, file: OPS, name: "big", kind: "function" as const, line: 2, lines: 39 },
        { id: `${OPS}#tiny`, file: OPS, name: "tiny", kind: "function" as const, line: 42, lines: 1 },
        { id: `${OPS}#mid`, file: OPS, name: "mid", kind: "function" as const, line: 44, lines: 7 },
      ],
    };
    const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const things: Record<string, JudgedThing> = {
      [OPS]: { quality: 0.5, importance: 0.7, concepts: {}, picks: {} },
      [`${OPS}#big`]: { quality: 0.3, importance: 0.9, concepts: {}, picks: { weak: { start: 10, end: 12 }, key: { start: 20, end: 22 } } },
      [`${OPS}#tiny`]: { quality: 0.99, importance: 0.05, concepts: {}, picks: {} },
      [`${OPS}#mid`]: { quality: 0.8, importance: 0.6, concepts: {}, picks: { key: { start: 46, end: 47 } } },
    };
    const src: WordsSource = { journal: journalOf(ops, { first: 18, next: 21, lead: 6 }), world: ops, vitality: (of) => things[of]?.quality ?? 1, lines: () => text, thing: (of) => things[of] };
    // big is the most important by Jev's importance alone, whatever its quality.
    expect(mostImportant(src, [`${OPS}#big`, `${OPS}#tiny`, `${OPS}#mid`])).toBe(`${OPS}#big`);
    const file = wordsOf(src, src.journal.entry(OPS)!);
    expect(file.importance).toBe(0.7);
    // The lead is big's signature and key block with the rest folded, and no row is marked.
    expect(file.body.kind === "rows" && file.body.lead).toEqual({
      of: `${OPS}#big`,
      name: "big",
      page: src.journal.entry(`${OPS}#big`)?.page,
      shows: `${OPS}#big`,
      signature: { n: 2, text: "line 2" },
      first: 20,
      lines: ["line 20", "line 21", "line 22"],
      before: 17,
      after: 18,
    });
    expect(file.body.kind === "rows" && file.body.rows.some((r) => "mark" in r)).toBe(false);
    // A long definition's page opens at its key block, without marks.
    const big = wordsOf(src, src.journal.entry(`${OPS}#big`)!);
    expect(big.body).toMatchObject({ kind: "code", opensAt: 20, marks: [] });
    // Its appendix has Jev's marks: the weak block first, then the key block.
    const full = appendixWords(src, src.journal.entry(`${OPS}#big`)!);
    expect(full.body.kind === "full" && full.body.marks.map((m) => [m.kind, m.from, m.to])).toEqual([["improve", 10, 12], ["understand", 20, 22]]);
  });

  it("leads a folder with its most important file, shown by that file's most important definition", () => {
    const A = "core/a.ts";
    const B = "core/b.ts";
    const two = {
      name: "demo",
      areas: [{ path: "", name: "demo", parent: null }, { path: "core", name: "core", parent: "" }],
      patches: [{ path: A, name: "a.ts", area: "core" }, { path: B, name: "b.ts", area: "core" }],
      symbols: [
        { id: `${A}#good`, file: A, name: "good", kind: "function" as const, line: 1, lines: 4 },
        { id: `${A}#fine`, file: A, name: "fine", kind: "function" as const, line: 6, lines: 4 },
        { id: `${B}#bad`, file: B, name: "bad", kind: "function" as const, line: 1, lines: 4 },
        { id: `${B}#ok`, file: B, name: "ok", kind: "function" as const, line: 6, lines: 4 },
      ],
    };
    const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    const t = (quality: number, importance: number): JudgedThing => ({ quality, importance, concepts: {}, picks: {} });
    const things: Record<string, JudgedThing> = { core: t(0.6, 0.8), [A]: t(0.9, 0.7), [B]: t(0.4, 0.8), [`${A}#good`]: t(0.95, 0.6), [`${A}#fine`]: t(0.7, 0.3), [`${B}#bad`]: t(0.2, 0.9), [`${B}#ok`]: t(0.8, 0.2) };
    const src: WordsSource = { journal: journalOf(two, { first: 18, next: 21, lead: 6 }), world: two, vitality: (of) => things[of]?.quality ?? 1, lines: () => text, thing: (of) => things[of] };
    const core = wordsOf(src, src.journal.entry("core")!);
    // b.ts is the folder's most important file, and bad is b.ts's most important definition.
    expect(core.body.kind === "rows" && core.body.lead).toMatchObject({ of: B, name: "b.ts", shows: `${B}#bad`, signature: { text: "line 1" } });
  });

  it("lists what a package's folder holds on its page, and at its foot its trails by their way", () => {
    const pkgs = {
      name: "demo",
      areas: [{ path: "", name: "demo", parent: null }, { path: "app", name: "app", parent: "" }, { path: "core", name: "core", parent: "" }, { path: "core/src", name: "src", parent: "core" }],
      patches: [{ path: "core/package.json", name: "package.json", area: "core" }, { path: "app/main.ts", name: "main.ts", area: "app" }],
      symbols: [],
      things: [{ path: "app", name: "@demo/app" }, { path: "core", name: "@demo/core" }],
      trails: [{ from: "app", to: "core" }],
    };
    const src: WordsSource = { journal: journalOf(pkgs), world: pkgs, vitality: () => 0.5, lines: () => undefined };
    const core = wordsOf(src, src.journal.entry("entity:core")!);
    expect(core.body.kind === "rows" && core.body.rows.map((r) => r.name)).toEqual(["src", "package.json"]);
    expect(core.trails && { uses: core.trails.uses.map((r) => r.name), usedBy: core.trails.usedBy.map((r) => r.name) }).toEqual({ uses: [], usedBy: ["@demo/app"] });
    expect(wordsOf(src, src.journal.entry("entity:app")!).trails?.uses.map((r) => r.of)).toEqual(["entity:core"]);
  });

  it("captions what the understanding pass judged with each concept as a percentage, leaving out an answer that doesn't count", () => {
    expect(conceptsCaption({ quality: 0.5, importance: 0.5, concepts: { robustness: null, coupling: 0.5, readability: 0.454 }, picks: {} })).toEqual([
      { label: "readability", value: "45%" },
      { label: "loose coupling", value: "50%" },
    ]);
  });
});
