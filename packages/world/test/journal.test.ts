import { describe, expect, it } from "vitest";
import { type JournalSource, entityOf, journalOf, ownOf } from "@gaia/world";

const area = (path: string) => ({ path, name: path.split("/").pop() || "demo", parent: path === "" ? null : path.split("/").slice(0, -1).join("/") });
const patch = (path: string) => ({ path, name: path.split("/").pop() as string, area: path.split("/").slice(0, -1).join("/") });
const def = (file: string, name: string, line: number, parent?: string) => ({
  id: `${file}#${parent === undefined ? name : `${parent}.${name}`}`,
  file,
  name,
  line,
  ...(parent === undefined ? {} : { parent: `${file}#${parent}` }),
});

const MATH = "packages/core/math.ts";
const DEMO: JournalSource = {
  name: "demo",
  areas: ["", "packages", "packages/core", "packages/app", "docs"].map(area),
  patches: ["README.md", "package.json", "docs/guide.md", MATH, "packages/core/index.ts", "packages/app/main.ts", "packages/app/item10.ts", "packages/app/item9.ts"].map(patch),
  symbols: [def(MATH, "square", 210), def(MATH, "Calc", 10), def(MATH, "mul", 50, "Calc"), def(MATH, "add", 20, "Calc"), def(MATH, "Opts", 1)],
};

describe("the traveller's journal", () => {
  it("reads as a file explorer lists the code: chapters, then files, a file with definitions first as itself, then its definitions as written, nested ones after their own", () => {
    const journal = journalOf(DEMO);
    expect(journal.contents).toEqual(["docs", "packages", "package.json", "README.md"]);
    expect(journal.entries.map((e) => e.of)).toEqual([
      "docs",
      "docs/guide.md",
      "packages",
      "packages/app",
      "packages/app/item9.ts",
      "packages/app/item10.ts",
      "packages/app/main.ts",
      "packages/core",
      "packages/core/index.ts",
      MATH,
      ownOf(MATH),
      `${MATH}#Opts`,
      `${MATH}#Calc`,
      `${MATH}#Calc.add`,
      `${MATH}#Calc.mul`,
      `${MATH}#square`,
      "package.json",
      "README.md",
    ]);
    // Each page lists what it holds, and each spread's right-hand page is numbered after the last.
    expect(journal.entry("packages")?.lists).toEqual(["packages/app", "packages/core"]);
    // A file with definitions is a container: its first row is itself, its own code; a file with none is a leaf.
    expect(journal.entry(MATH)?.lists).toEqual([ownOf(MATH), `${MATH}#Opts`, `${MATH}#Calc`, `${MATH}#square`]);
    expect(journal.entry(ownOf(MATH))).toMatchObject({ kind: "own", under: MATH, lists: [] });
    expect(journal.entry("docs/guide.md")?.lists).toEqual([]);
    expect(journal.entry(`${MATH}#Calc`)).toMatchObject({ kind: "definition", under: MATH, lists: [`${MATH}#Calc.add`, `${MATH}#Calc.mul`] });
    expect(journal.entry(`${MATH}#Calc.add`)?.under).toBe(`${MATH}#Calc`);
    expect(journal.entry("docs")?.under).toBeUndefined();
    expect(journal.entries.map((e) => e.page)).toEqual(journal.entries.map((_, i) => 2 * i + 1));
  });

  it("lists each thing that stands first in its directory's chapter, its spread next, and runs a long list on overleaf", () => {
    const journal = journalOf(
      { ...DEMO, things: [{ path: "", name: "demo" }, { path: "packages/core", name: "@demo/core" }, { path: "docs", name: "guide" }], trails: [{ from: "docs", to: "packages/core" }, { from: "packages/app", to: "packages/core" }] },
      { first: 2, next: 3 },
    );
    const order = journal.entries.map((e) => e.of);
    // The repository's own spread comes before every chapter, and an entity's right after its directory's, as the first row of each.
    expect(order.slice(0, 3)).toEqual([entityOf(""), "docs", entityOf("docs")]);
    expect(journal.contents[0]).toBe(entityOf(""));
    expect(journal.entry("packages/core")?.lists[0]).toBe(entityOf("packages/core"));
    expect(order.indexOf(entityOf("packages/core"))).toBe(order.indexOf("packages/core") + 1);
    // An entity's page lists the things its trails join it to; a trail to something that isn't a thing joins nothing.
    expect(journal.entry(entityOf("packages/core"))?.lists).toEqual([entityOf("docs")]);
    expect(journal.entry(entityOf("packages/core"))?.under).toBe("packages/core");
    // math.ts lists itself and its five definitions: two on its first page, three on each after; ending on a right-hand
    // page, the next entry opens on a spread of its own, its picture on the left.
    const math = journal.entry(MATH);
    expect(math?.pages).toBe(3);
    expect(journal.entry(ownOf(MATH))?.page).toBe((math?.page ?? 0) + 4);
    expect(journal.entry("docs")?.pages).toBe(1);
  });
});
