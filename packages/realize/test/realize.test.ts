import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type Blueprint, type Part, Library, blueprintOf, rand, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, BUSH_PRIMITIVES, FLORA_PRIMITIVES, PRIMITIVES, RELIEF_PRIMITIVES, STRUCTURE_PRIMITIVES, TREE_PRIMITIVES, WORLD_PRIMITIVES } from "@gaia/primitives";
import { biome, bush, rock, structure, tree, wildflowers, world } from "@gaia/kinds";
import { sweep, validate } from "@gaia/world";
import { randomSlots } from "@gaia/world/testing";
import { mergeParts, realize, realizeWorld, triangleCount } from "@gaia/realize";

const lib = new Library(FLORA_PRIMITIVES);
/** Every tree and bush blueprint from the sweeps of their parts, each frame with each crown. */
const trees = sweep(tree, new Library(TREE_PRIMITIVES), { pairs: [["form", "crown"]] }).blueprints;
const bushes = sweep(bush, new Library(BUSH_PRIMITIVES), { pairs: [["form", "crown"]] }).blueprints;
/** A plant by the parts that shape it and their settings, as a failure names it. */
const named = (bp: Blueprint): string =>
  ["form", "crown", "bloom", "drift"].flatMap((slot) => (bp.slots[slot] === undefined ? [] : [`${bp.slots[slot].use} (${Object.values(bp.slots[slot].params).flat().join(", ")})`])).join(" with ");
const facts = { scale: 1, age: 120 };
const bytes = (a: ArrayBufferView): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

function buffersOf(part: Part): Buffer[] {
  const c = part.channels;
  return [part.positions, part.normals, part.indices, part.shade, c.loss, c.droop, c.wither, c.glow, c.pivot].map(bytes);
}

describe("realize", () => {
  // Builds 34 plants, some near the tree budget: about a second alone, several when the suite runs in parallel.
  it("gives byte-identical buffers and the same look for the same blueprints and seed", { timeout: 30_000 }, () => {
    // One plant for each frame and crown uses every part a tree or bush can have. The second pass builds them in
    // the other order, so anything one build leaves behind for the next shows as a difference.
    const onePerPair = (bps: readonly Blueprint[]): Blueprint[] => [...new Map(bps.map((b) => [`${b.slots.form?.use} ${b.slots.crown?.use}`, b])).values()];
    const plants = [...onePerPair(trees).map((b) => [b, tree] as const), ...onePerPair(bushes).map((b) => [b, bush] as const)];
    const build = ([blueprint, k]: (typeof plants)[number]) => realize(blueprint, k, lib, { seed: seedOf("src/app.ts"), facts });
    const first = plants.map(build);
    const again = [...plants].reverse().map(build).reverse();
    first.forEach((a, n) => {
      const b = again[n]!;
      const name = named(plants[n]![0]);
      expect(b.parts.length, name).toBe(a.parts.length);
      a.parts.forEach((part, i) => {
        const other = buffersOf(b.parts[i] as Part);
        buffersOf(part).forEach((buf, k) => expect(buf.equals(other[k] as Buffer), name).toBe(true));
      });
      expect(b.motion, name).toEqual(a.motion);
      expect(b.palette, name).toEqual(a.palette);
    });
    const lands = new Library([...WORLD_PRIMITIVES, ...BIOME_PRIMITIVES, ...RELIEF_PRIMITIVES]);
    const r = rand(seedOf("same looks"));
    for (let i = 0; i < 6; i++) {
      const sky = { blueprint: blueprintOf("world", randomSlots(world, lands, () => r.next())), kind: world };
      const land = { blueprint: blueprintOf("biome", randomSlots(biome, lands, () => r.next())), kind: biome };
      expect(realizeWorld(sky, land, lands, seedOf("lab/world"), 12.5)).toEqual(realizeWorld(sky, land, lands, seedOf("lab/world"), 12.5));
    }
  });

  it("keeps every tree under 40k triangles", () => {
    const over = trees.filter((bp) => triangleCount(realize(bp, tree, lib, { seed: 11, facts: { scale: 1.4, age: 0 } }).parts) >= 40_000);
    expect(over.map(named)).toEqual([]);
  });
});

describe("structures", () => {
  const structureLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
  const facts = { size: 1.25, floors: 2, reach: 1 };

  // Builds 80 whole buildings at their largest: about 3 s alone, longer when the suite runs in parallel.
  it("keeps any building in the type space within 32k triangles and 12 draw calls, at its largest", () => {
    const r = rand(99);
    for (let i = 0; i < 80; i++) {
      const bp = blueprintOf(structure.id, randomSlots(structure, structureLib, () => r.next()));
      const built = realize(bp, structure, structureLib, { seed: i, facts });
      expect(triangleCount(built.parts), JSON.stringify(bp.slots)).toBeLessThan(32_000);
      expect(mergeParts(built.parts).length).toBeLessThanOrEqual(12);
      // Merging keeps every triangle.
      expect(triangleCount(mergeParts(built.parts))).toBe(triangleCount(built.parts));
    }
  }, 30_000);
});

describe("the understory", () => {
  const all = new Library(PRIMITIVES);
  const bushLib = new Library(BUSH_PRIMITIVES);
  /** A part at one end of every setting: each scale's lowest level and each choice's first key, or the highest and the last. */
  const atEnd = (p: AnyPrimitive, high: boolean): Record<string, string | boolean | string[]> =>
    Object.fromEntries(
      Object.entries(p.params).map(([name, f]) => {
        const pick = <T>(xs: readonly T[]): T => xs[high ? xs.length - 1 : 0] as T;
        return [name, f.type === "scale" ? pick(f.levels).words : f.type === "choice" ? pick(Object.keys(f.options)) : f.type === "flag" ? high : high ? Object.keys(f.members) : []];
      }),
    );
  /** Every bush frame with every crown, its settings all at their lowest and then all at their highest. */
  const extremes = bushLib.forRole("Skeleton").flatMap((frame) =>
    bushLib.forRole("Foliage").flatMap((crown) =>
      [false, true].map((high) =>
        blueprintOf(bush.id, {
          form: { use: frame.id, params: atEnd(frame, high) },
          bark: { use: "bark@1", params: atEnd(bushLib.get("bark@1"), high) },
          crown: { use: crown.id, params: atEnd(crown, high) },
          motion: { use: "sway@1", params: atEnd(bushLib.get("sway@1"), high) },
          palette: { use: "palette@1", params: atEnd(bushLib.get("palette@1"), high) },
        }),
      ),
    ),
  );
  const groups = [
    { blueprints: [...bushes, ...extremes], kind: bush },
    { blueprints: sweep(rock, all).blueprints, kind: rock },
    { blueprints: sweep(wildflowers, all).blueprints, kind: wildflowers },
  ];
  for (const { blueprints, kind } of groups) {
    it(`builds every ${kind.id} part valid and light enough to place by the hundred`, () => {
      const over: string[] = [];
      for (const blueprint of blueprints) {
        expect(validate(blueprint, kind, all), named(blueprint)).toEqual([]);
        const parts = realize(blueprint, kind, all, { seed: 11, facts: { scale: 1.3, age: 0 } }).parts;
        expect(parts.length, named(blueprint)).toBeGreaterThan(0);
        if (triangleCount(parts) >= 12_000) over.push(named(blueprint));
      }
      expect(over).toEqual([]);
    });
  }
});
