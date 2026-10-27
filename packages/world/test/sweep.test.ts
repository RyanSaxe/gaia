import { describe, expect, it } from "vitest";
import { type AnyKind, type Blueprint, Library } from "@gaia/schema";
import { BUSH_PRIMITIVES, PRIMITIVES, TREE_PRIMITIVES } from "@gaia/primitives";
import { biome, bush, landmark, link, rock, structure, tree, wildflowers, world } from "@gaia/kinds";
import { type SweepOptions, type SweepPlace, sweep, validate } from "@gaia/world";

const all = new Library(PRIMITIVES);
const frameAndCrown: SweepOptions = { pairs: [["form", "crown"]] };
const KINDS: readonly (readonly [AnyKind, Library, SweepOptions])[] = [
  [tree, new Library(TREE_PRIMITIVES), frameAndCrown],
  [bush, new Library(BUSH_PRIMITIVES), frameAndCrown],
  ...[rock, wildflowers, structure, landmark, world, biome, link].map((k) => [k, all, {}] as const),
];

/** Every part, option and absence the blueprints stand, read from the blueprints alone. */
function standing(k: AnyKind, lib: Library, blueprints: readonly Blueprint[]): string[] {
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

/** Every part, option and absence a kind's blueprints could stand, read from the kind and the library. */
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
      const stood = new Set(standing(k, lib, blueprints));
      expect(possible(k, lib).filter((x) => !stood.has(x))).toEqual([]);
    });
  }

  it("is the same on every run", () => {
    for (const [k, lib, options] of KINDS) expect(sweep(k, lib, options).blueprints.map((b) => b.id)).toEqual(sweep(k, lib, options).blueprints.map((b) => b.id));
  });

  it("stands every frame with every crown, a tree's from a tree's parts and a bush's from a bush's", () => {
    for (const [k, parts] of [[tree, TREE_PRIMITIVES], [bush, BUSH_PRIMITIVES]] as const) {
      const lib = new Library(parts);
      const pairs = new Set(sweep(k, lib, frameAndCrown).blueprints.map((b) => `${b.slots.form?.use} ${b.slots.crown?.use}`));
      const frames = lib.forRole("Skeleton").map((p) => p.id);
      const crowns = lib.forRole("Foliage").map((p) => p.id);
      expect(pairs.size).toBe(frames.length * crowns.length);
      for (const f of frames) for (const c of crowns) expect(pairs.has(`${f} ${c}`), `${f} with ${c}`).toBe(true);
    }
    const bushes = sweep(bush, new Library(BUSH_PRIMITIVES), frameAndCrown).blueprints;
    expect(bushes.filter((b) => ["branching@1", "spire@1", "needles@1"].some((id) => b.slots.form?.use === id || b.slots.crown?.use === id))).toEqual([]);
  });

  it("stands a part that needs running water only where its place has it, and lists it missing where no place does", () => {
    const water = (has: boolean): { has: readonly string[] } => ({ has: has ? ["running water"] : [] });
    const places = Array.from({ length: 30 }, (_, i) => water(i % 6 === 2));
    const { blueprints, missing } = sweep(structure, all, { places });
    expect(missing).toEqual([]);
    const wheels = blueprints.flatMap((b, i) => (b.slots.feature?.use === "waterwheel@1" ? [i] : []));
    expect(wheels.length).toBeGreaterThan(0);
    for (const i of wheels) expect(places[i]?.has, `place ${i}`).toEqual(["running water"]);
    // Each place by running water stands the wheel until the wheel has nothing left to show.
    expect(wheels.slice(0, 3)).toEqual([2, 8, 14]);
    const dry = sweep(structure, all, { places: places.map(() => water(false)) });
    expect(dry.blueprints.some((b) => b.slots.feature?.use === "waterwheel@1")).toBe(false);
    expect(dry.missing).toContain("feature: waterwheel@1");
  });

  it("honours what each place settles, and stands every part under every label or lists what it lacks", () => {
    const places: (SweepPlace & { readonly fixed: Readonly<Record<string, string | boolean>> })[] = ["thriving", "ruin"].flatMap((label) => [
      { label, uses: { relief: "valley@1" }, fixed: { "relief.stream": "brook", "relief.pond": false } },
      { label, uses: { relief: "basin@1" }, fixed: { "relief.stream": "dry bed", "relief.pond": true } },
      ...Array.from({ length: 10 }, () => ({ label, fixed: { "relief.stream": "dry bed", "relief.pond": false } })),
    ]);
    const { blueprints, missing } = sweep(biome, all, { places });
    expect(blueprints.length).toBe(places.length);
    places.forEach((place, i) => {
      const relief = blueprints[i]?.slots.relief;
      if (place.uses !== undefined) expect(relief?.use).toBe(place.uses.relief);
      if (relief?.use === "valley@1") expect(relief.params.stream).toBe(place.fixed["relief.stream"]);
      if (relief?.use === "basin@1") expect(relief.params.pond).toBe(place.fixed["relief.pond"]);
    });
    // Every landform stands under both labels.
    for (const label of ["thriving", "ruin"]) {
      const under = new Set(blueprints.flatMap((b, i) => (places[i]?.label === label ? [b.slots.relief?.use] : [])));
      expect(under.size).toBe(all.forRole("Relief").length);
    }
    // A brook and a dry bed were settled, never a trickle.
    expect(missing).toEqual(['relief: valley@1 stream "trickle"']);
  });
});
