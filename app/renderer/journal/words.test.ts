import { describe, expect, it } from "vitest";
import { journalOf, ownOf } from "@gaia/world";
import { type WordsSource, contentsWords, wordsOf } from "./words.ts";

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
});
