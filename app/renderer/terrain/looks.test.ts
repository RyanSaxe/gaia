import { describe, expect, it } from "vitest";
import type { AnyPrimitive, Field } from "@gaia/schema";
import { COMPOSING, FORMS } from "./looks.ts";

/** Words that name a kind of code. Jev's options describe a feel, never what code a form or a part is for. */
const CODE_WORDS =
  /\b(functions?|class(es)?|modules?|files?|imports?|tests?)\b/i;

/** Every option a field offers, in the words Jev reads. */
const optionsOf = (f: Field): string[] => {
  if (f.type === "choice") return Object.values(f.options);
  if (f.type === "set") return Object.values(f.members);
  if (f.type === "flag") return [f.yes, f.no];
  return f.levels.map((l) => l.words);
};

const SIZES = ["tree", "bush", "stone", "flowers", "wildBush"] as const;

function sizeWords(
  as: (typeof SIZES)[number],
): readonly (readonly [string, string])[] {
  return [
    [`${as} kind`, COMPOSING[as].doc] as const,
    ...Object.entries(COMPOSING[as].slots).map(
      ([name, s]) => [`${as}'s ${name}`, s.ask ?? ""] as const,
    ),
  ];
}

function fieldWords(
  id: string,
  name: string,
  f: Field,
): readonly (readonly [string, string])[] {
  return [
    [`${id} ${name}`, f.ask] as const,
    ...optionsOf(f).map((o) => [`${id} ${name}`, o] as const),
  ];
}

function partWords(p: AnyPrimitive): readonly (readonly [string, string])[] {
  return [
    [p.id, p.doc] as const,
    ...Object.entries(p.params).flatMap(([name, f]) =>
      fieldWords(p.id, name, f),
    ),
  ];
}

describe("the words Jev composes small things from", () => {
  const parts = new Map<string, AnyPrimitive>();
  for (const as of SIZES) {
    const lib = COMPOSING.offered?.[as] ?? COMPOSING.lib;
    for (const s of Object.values(COMPOSING[as].slots)) {
      for (const p of lib.forRole(s.role)) parts.set(p.id, p);
    }
  }

  it("describe a feel, and never name a kind of code", () => {
    const words = [
      ...Object.entries(FORMS).map(
        ([name, look]) => [`form ${name}`, look.doc] as const,
      ),
      ...SIZES.flatMap(sizeWords),
      ...[...parts.values()].flatMap(partWords),
    ];
    expect(words.filter(([, w]) => CODE_WORDS.test(w))).toEqual([]);
    // Every slot of a small thing has an `ask`, which says what it shows of the code.
    expect(
      words.filter(([what, w]) => what.includes("'s ") && w === ""),
    ).toEqual([]);
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
});
