import { describe, expect, it } from "vitest";
import { type AnyKind, type Blueprint, Library } from "@gaia/schema";
import { BUSH_PRIMITIVES, PRIMITIVES, TREE_PRIMITIVES } from "@gaia/primitives";
import { biome, bush, landmark, link, rock, structure, tree, wildflowers, world } from "@gaia/kinds";
import { type SweepOptions, sweep, validate } from "@gaia/world";

const all = new Library(PRIMITIVES);
const frameAndCrown: SweepOptions = { pairs: [["form", "crown"]] };
const KINDS: readonly (readonly [AnyKind, Library, SweepOptions])[] = [
  [tree, new Library(TREE_PRIMITIVES), frameAndCrown],
  [bush, new Library(BUSH_PRIMITIVES), frameAndCrown],
  ...[rock, wildflowers, structure, landmark, world, biome, link].map((k) => [k, all, {}] as const),
];

/** Every part, option and absence that appears in the blueprints, read from the blueprints alone. */
function covered(k: AnyKind, lib: Library, blueprints: readonly Blueprint[]): string[] {
  const out = new Set<string>();
  for (const bp of blueprints) {
    for (const name of Object.keys(k.slots)) {
      const filled = bp.slots[name];
      if (filled === undefined) {
        out.add(`${name} left out`);
        continue;
      }
      out.add(`${name}: ${filled.use}`);
      for (const [param, value] of Object.entries(filled.params)) for (const v of Array.isArray(value) ? value : [value]) out.add(`${name}: ${filled.use} ${param} "${String(v)}"`);
    }
  }
  return [...out];
}

/** Every part, option and absence a kind's blueprints could contain, read from the kind and the library. */
function possible(k: AnyKind, lib: Library): string[] {
  return Object.entries(k.slots).flatMap(([name, s]) => [
    ...(s.optional ? [`${name} left out`] : []),
    ...lib.forRole(s.role).flatMap((p) => [
      `${name}: ${p.id}`,
      ...Object.entries(p.params).flatMap(([param, f]) =>
        (f.type === "choice" ? Object.keys(f.options) : f.type === "scale" ? f.levels.map((l) => l.words) : f.type === "flag" ? ["false", "true"] : Object.keys(f.members)).map((v) => `${name}: ${p.id} ${param} "${v}"`),
      ),
    ]),
  ]);
}

describe("a sweep of a kind's parts", () => {
  for (const [k, lib, options] of KINDS) {
    it(`stands every part and every option of a ${k.id}, each blueprint valid, and finds nothing missing`, () => {
      const { blueprints, missing } = sweep(k, lib, options);
      expect(missing).toEqual([]);
      for (const bp of blueprints) expect(validate(bp, k, lib)).toEqual([]);
      const coveredKeys = new Set(covered(k, lib, blueprints));
      expect(possible(k, lib).filter((x) => !coveredKeys.has(x))).toEqual([]);
    });
  }

});
