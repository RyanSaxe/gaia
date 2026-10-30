import { describe, expect, it } from "vitest";
import { areaVitality, entityOf, journalOf, vitalityOf } from "@gaia/world";
import { type OpenedWorld, openedWorld, provingWorld } from "../terrain/code-world.ts";
import type { Represented } from "../terrain/represent.ts";
import { laySnapshot } from "../terrain/snapshot.ts";
import { snapshotFacts } from "../terrain/snapshot-facts.ts";
import { ROOM } from "./pages.ts";
import { contentsWords, pageVitality, wordsOf } from "./words.ts";

/**
 * Every place where the journal and the map show different vitality for the same thing in `code`: each folder and
 * file the map washes, and each building, landmark, tree, stone, bush and drift of flowers it draws.
 */
function disagreements(code: OpenedWorld): string[] {
  const { world } = code;
  const journal = journalOf(world, ROOM);
  const src = { journal, world, vitality: pageVitality(world), lines: () => undefined };
  /** The vitality the journal's page for `id` shows, opened as a tap on the thing opens it. */
  const page = (id: string): number | undefined => {
    const of = [entityOf(id), id].find((o) => journal.entry(o) !== undefined);
    const entry = of === undefined ? undefined : journal.entry(of);
    return entry === undefined ? undefined : wordsOf(src, entry).vitality;
  };
  const off: string[] = [];
  const compare = (what: string, id: string, shown: number | undefined, map: number): void => {
    if (shown !== map) off.push(`${what} ${id || "(root)"}: the map shows ${map}, the journal ${shown ?? "no page"}`);
  };
  // The wash: each file's own vitality on its ground, and each folder's pooled from its files, beside the file's page
  // and the folder's chapter.
  for (const p of world.patches) compare("file", p.path, page(p.path), p.vitality);
  const pooled = areaVitality(world.patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
  for (const a of world.areas) {
    // The whole world's is its contents page's.
    const chapter = journal.entry(a.path);
    const shown = a.path === "" ? contentsWords(src).vitality : chapter === undefined ? undefined : wordsOf(src, chapter).vitality;
    compare("folder", a.path, shown, pooled.get(a.path) ?? 1);
  }
  // The marks: each thing worn by the vitality the world gives what it represents.
  const marked = vitalityOf(world);
  const mark = (what: string, r: Represented | undefined): void => {
    if (r !== undefined) compare(what, r.id, page(r.id), marked.get(r.id) ?? r.vitality);
  };
  for (const b of code.buildings) mark("building", b.represented);
  for (const l of code.landmarks) mark("landmark", l.represented);
  code.layout.symbols.forEach((_, k) => mark("plant, stone or drift", code.symbolOf(k)?.represented));
  return off;
}

describe("the journal beside the map", () => {
  // Each showcase lays out whole from its kept answers, in about two seconds alone and longer while other work shares
  // the machine.
  it.each(["showcase", "showcase-fixed"] as const)("shows the vitality the map shows for every folder, file and thing of %s", { timeout: 60_000 }, async (of) => {
    const { world, summary } = await laySnapshot("a test", of);
    expect(disagreements(openedWorld({ root: of, facts: snapshotFacts(of), world, summary, judged: {} }))).toEqual([]);
  });

  it("shows the vitality the map shows for every folder, file and thing of the proving ground", () => {
    expect(disagreements(openedWorld(provingWorld()))).toEqual([]);
  });
});
