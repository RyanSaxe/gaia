import { describe, expect, it } from "vitest";
import type { AnyPrimitive, Field } from "@gaia/schema";
import { COMPOSING, FORMS } from "./looks.ts";

/** Words that name a kind of code: Jev reads a feel, never what code a form or a part is for. */
const CODE_WORDS = /\b(functions?|class(es)?|modules?|files?|imports?|tests?)\b/i;

/** Every option a field offers, in the words Jev reads. */
const optionsOf = (f: Field): string[] => (f.type === "choice" ? Object.values(f.options) : f.type === "set" ? Object.values(f.members) : f.type === "flag" ? [f.yes, f.no] : f.levels.map((l) => l.words));

describe("the words Jev composes small things from", () => {
  const sizes = ["tree", "bush", "stone", "flowers"] as const;
  const parts = new Map<string, AnyPrimitive>();
  for (const as of sizes) {
    const lib = COMPOSING.offered?.[as] ?? COMPOSING.lib;
    for (const s of Object.values(COMPOSING[as].slots)) for (const p of lib.forRole(s.role)) parts.set(p.id, p);
  }

  it("describe a feel, and never name a kind of code", () => {
    const words = [
      ...Object.entries(FORMS).map(([name, look]) => [`form ${name}`, look.doc] as const),
      ...sizes.flatMap((as) => [[`${as} kind`, COMPOSING[as].doc] as const, ...Object.entries(COMPOSING[as].slots).map(([name, s]) => [`${as}'s ${name}`, s.ask ?? ""] as const)]),
      ...[...parts.values()].flatMap((p) => [[p.id, p.doc] as const, ...Object.entries(p.params).flatMap(([name, f]) => [[`${p.id} ${name}`, f.ask] as const, ...optionsOf(f).map((o) => [`${p.id} ${name}`, o] as const)])]),
    ];
    expect(words.filter(([, w]) => CODE_WORDS.test(w))).toEqual([]);
    // Every slot of a small thing says what it shows of the code.
    expect(words.filter(([what, w]) => what.includes("'s ") && w === "")).toEqual([]);
  });

  it("give every option of every field words of its own", () => {
    for (const p of parts.values()) {
      for (const [name, f] of Object.entries(p.params)) {
        const options = optionsOf(f);
        expect(new Set(options).size, `${p.id} ${name}`).toBe(options.length);
      }
    }
    const docs = Object.values(FORMS).map((l) => l.doc);
    expect(new Set(docs).size).toBe(docs.length);
  });

  it("offer a bush no tree's frame and no needles, and a tree no bush's frame", () => {
    const bush = COMPOSING.offered?.bush;
    const tree = COMPOSING.offered?.tree;
    expect(bush?.forRole("Skeleton").map((p) => p.id).sort()).toEqual(["bramble@1", "sapling@1", "thicket@1"]);
    expect(bush?.forRole("Foliage").some((p) => p.id === "needles@1")).toBe(false);
    expect(tree?.forRole("Skeleton").map((p) => p.id).sort()).toEqual(["branching@1", "spire@1"]);
  });
});
