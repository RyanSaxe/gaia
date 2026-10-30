import { describe, expect, it } from "vitest";
import { journalOf, ownOf } from "@gaia/world";
import { type WordsSource, wordsOf } from "./words.ts";

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
  it("shows a definition's own code on its page, a nested definition's included", () => {
    const src = source(TEXT);
    const code = (id: string): string[] => {
      const page = wordsOf(src, src.journal.entry(id)!);
      if (page.body.kind !== "code") throw new Error(`${id}'s page shows no code.`);
      return [...(page.signature === undefined ? [] : [page.signature]), ...page.body.lines];
    };
    // Each definition's lines in the file, from its first, whatever their indentation.
    const trimmed = (lines: readonly string[]): string[] => lines.map((l) => l.trim());
    for (const { id, line, lines } of world.symbols) expect(trimmed(code(id)), id).toEqual(trimmed(TEXT.slice(line - 1, line - 1 + lines)));
  });
});
