import { describe, expect, it } from "vitest";
import { journalOf } from "@gaia/world";
import { type Judgment, type WordsSource, contentsWords, wordsOf } from "./words.ts";

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
    { id: `${MATH}#Calc`, file: MATH, name: "Calc", line: 2, lines: 5 },
    { id: `${MATH}#Calc.add`, file: MATH, parent: `${MATH}#Calc`, name: "add", line: 3, lines: 1 },
  ],
};
const TEXT = ["// math", "export class Calc {", "  add(a: number) { return a + 1; }", "", "  // more", "}"];

const source = (lines: readonly string[] | undefined): WordsSource => ({
  journal: journalOf(world),
  world,
  vitality: (of) => ({ "": 0.8, core: 0.6, [MATH]: 0.5, [`${MATH}#Calc`]: 0.3, [`${MATH}#Calc.add`]: 0.9, "README.md": 1 })[of] ?? 1,
  lines: () => lines,
});

describe("what a journal page says", () => {
  it("lists a chapter's chapters and files, a file's definitions under their own, each with its own vitality and page; a definition is its code after its signature", () => {
    const src = source(TEXT);
    const j = src.journal;
    expect(contentsWords(src).body).toEqual({ kind: "rows", rows: [{ of: "core", name: "core", depth: 0, vitality: 0.6, page: j.entry("core")?.page }, { of: "README.md", name: "README.md", depth: 0, vitality: 1, page: j.entry("README.md")?.page }] });
    const file = wordsOf(src, j.entry(MATH)!);
    expect(file).toMatchObject({ path: ["core"], name: "math.ts", vitality: 0.5 });
    expect(file.body.kind === "rows" && file.body.rows.map((r) => [r.name, r.depth, r.vitality])).toEqual([["Calc", 0, 0.3], ["add", 1, 0.9]]);
    const calc = wordsOf(src, j.entry(`${MATH}#Calc`)!);
    expect(calc).toMatchObject({ path: ["core", "math.ts"], name: "Calc", vitality: 0.3, signature: "export class Calc {", body: { kind: "code", first: 3, opensAt: 3 } });
    expect(calc.body.kind === "code" && calc.body.lines).toEqual(TEXT.slice(2, 6));
    // Until the file's text arrives, a definition says where it is and what it is called, and holds no code.
    expect(wordsOf(source(undefined), j.entry(`${MATH}#Calc`)!)).toMatchObject({ name: "Calc", body: { kind: "code", lines: [] } });
  });

  it("reads what Jev judged in the graph's own terms: a node's attention marks its row, a block's marks its lines, and routine marks nothing", () => {
    const attention = (choice: string, p: number) => ({ attention: { choice, p: { [choice]: p, routine: 1 - p }, call: "attention" } });
    const judged: Record<string, readonly Judgment[]> = {
      [`${MATH}#Calc`]: [{ judged: attention("heart", 0.8) }, { judged: attention("fragile", 0.6), lines: { start: 3, end: 3 } }, { judged: attention("routine", 0.9), lines: { start: 5, end: 6 } }],
      [`${MATH}#Calc.add`]: [{ judged: attention("routine", 0.7) }],
    };
    const src = { ...source(TEXT), judged: (of: string) => judged[of] ?? [] };
    const file = wordsOf(src, src.journal.entry(MATH)!);
    expect(file.body.kind === "rows" && file.body.rows.map((r) => r.mark)).toEqual([{ kind: "understand", sure: 0.8 }, undefined]);
    const calc = wordsOf(src, src.journal.entry(`${MATH}#Calc`)!);
    expect(calc.body.kind === "code" && calc.body.marks).toEqual([{ kind: "improve", sure: 0.6, from: 3, to: 3 }]);
  });
});
