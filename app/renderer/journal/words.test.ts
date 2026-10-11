import { describe, expect, it } from "vitest";
import { journalOf, ownOf } from "@gaia/world";
import { captionOf } from "./caption.ts";
import { type Judgment, type WordsSource, contentsWords, proseOf, wordsOf } from "./words.ts";

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
    // A file with definitions lists itself first, as a thing of its own.
    expect(file.body.kind === "rows" && file.body.rows.map((r) => [r.of, r.depth, r.vitality])).toEqual([[ownOf(MATH), 0, 0.5], [`${MATH}#Calc`, 0, 0.3], [`${MATH}#Calc.add`, 1, 0.9]]);
    const calc = wordsOf(src, j.entry(`${MATH}#Calc`)!);
    expect(calc).toMatchObject({ path: ["core", "math.ts"], name: "Calc", vitality: 0.3, signature: "export class Calc {", body: { kind: "code", first: 3, opensAt: 3 } });
    expect(calc.body.kind === "code" && calc.body.lines).toEqual(TEXT.slice(2, 6));
    // Until the file's text arrives, a definition says where it is and what it is called, and holds no code.
    expect(wordsOf(source(undefined), j.entry(`${MATH}#Calc`)!)).toMatchObject({ name: "Calc", body: { kind: "code", lines: [] } });
  });

  it("shows a file as a thing by its own text, each definition folded to a line that turns to its page, and a file with none by its whole text, a document's as prose", () => {
    const src = source(TEXT);
    const own = wordsOf(src, src.journal.entry(ownOf(MATH))!);
    expect(own).toMatchObject({ path: ["core"], name: "math.ts", vitality: 0.5, body: { kind: "code", first: 1, lines: TEXT, opensAt: 1 } });
    // Calc is its line, then its body folded; add, inside it, is folded with it.
    expect(own.body.kind === "code" && own.body.folded).toEqual([{ from: 3, to: 6, of: `${MATH}#Calc`, page: src.journal.entry(`${MATH}#Calc`)?.page }]);
    expect(wordsOf(src, src.journal.entry("README.md")!)).toMatchObject({ path: [], name: "README.md", body: { kind: "code", first: 1, lines: ["# Demo", "", "Adds numbers."], prose: true } });
    // A file that isn't text, such as an image, shows none.
    const image = { ...src, lines: () => ["\u0089PNG", "\u0000\u0000"] };
    expect(wordsOf(image, src.journal.entry("README.md")!).body).toMatchObject({ lines: [] });
  });

  it("reads what Jev judged in the graph's own terms: a node's attention marks its row, a block's marks its lines, and routine marks nothing", () => {
    const attention = (choice: string, p: number) => ({ attention: { choice, p: { [choice]: p, routine: 1 - p }, call: "attention" } });
    const judged: Record<string, readonly Judgment[]> = {
      [`${MATH}#Calc`]: [{ judged: attention("heart", 0.8) }, { judged: attention("fragile", 0.6), lines: { start: 3, end: 3 } }, { judged: attention("routine", 0.9), lines: { start: 5, end: 6 } }],
      [`${MATH}#Calc.add`]: [{ judged: attention("routine", 0.7) }],
    };
    const src = { ...source(TEXT), judged: (of: string) => judged[of] ?? [] };
    const file = wordsOf(src, src.journal.entry(MATH)!);
    expect(file.body.kind === "rows" && file.body.rows.map((r) => r.mark)).toEqual([undefined, { kind: "understand", sure: 0.8 }, undefined]);
    const calc = wordsOf(src, src.journal.entry(`${MATH}#Calc`)!);
    expect(calc.body.kind === "code" && calc.body.marks).toEqual([{ kind: "improve", sure: 0.6, from: 3, to: 3 }]);
  });

  it("sets a document as its paragraphs: wrapped lines joined, each heading, item and fenced line its own", () => {
    const doc = ["# Gaia", "", "Gaia turns a codebase into", "a [world](https://gaia.dev) to wander.", "", "", "- one item that", "  runs on", "- **two**", "```ts", "const x = 1;", "```", "Done."];
    expect(proseOf(doc)).toEqual({
      lines: ["# Gaia", "", "Gaia turns a codebase into a world to wander.", "", "• one item that runs on", "• two", "const x = 1;", "Done."],
      pre: [false, false, false, false, false, false, true, false],
    });
  });

  it("captions a thing with what Jev says of it, each answer by its name, leaving out what says nothing", () => {
    const judged: Judgment = {
      judged: {
        attention: { choice: "heart", p: { heart: 0.8, routine: 0.2 }, call: "attention" },
        role: { choice: "orchestrator", p: { orchestrator: 0.9 }, call: "role" },
        quality: { readability: { score: 0.6, value: 0.2, call: "quality" }, change: { score: 2.1, value: 0.7, call: "quality" } },
      },
      // Change has no name, as an answer from before the engine sent them: a bare number says nothing on a caption.
      names: { attention: "The heart of the work", "quality.readability": "Hard to follow" },
    };
    expect(captionOf("definition", judged)).toEqual([
      { label: "why look", value: "heart of the work", sure: 0.8 },
      { label: "role", value: "orchestrator", sure: 0.9 },
      { label: "reads", value: "hard to follow" },
    ]);
    // A routine thing gives no reason to look; a file says whether it needs tests.
    const file: Judgment = { judged: { attention: { choice: "routine", p: { routine: 0.7 }, call: "attention" }, needsTests: { p: 0.9, call: "profile" } } };
    expect(captionOf("file", file)).toEqual([{ label: "needs tests", value: "yes", sure: 0.9 }]);
    expect(captionOf("folder", undefined)).toEqual([]);
  });
});
