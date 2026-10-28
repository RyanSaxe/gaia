// Checks that each landmark's seed picks proportions within the band of its
// answer, and that no answer's band overlaps its neighbour's. Measured on the
// built geometry, every seed of a shallow dome is lower than any seed of a
// high one, every close-set colonnade closer than any evenly spaced one, and
// every straight tower plumber than any tapering one.

import { describe, expect, it } from "vitest";
import { type Built, type Part, rand } from "@gaia/schema";
import { lookoutTower, rotunda } from "@gaia/primitives";
import { resolveParams } from "@gaia/realize";

type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;
type Primitive = typeof rotunda | typeof lookoutTower;

const SEEDS = Array.from({ length: 16 }, (_, k) => k + 1);
/** A measure's range divided by its mean. */
const spread = (seen: readonly number[]): number => (Math.max(...seen) - Math.min(...seen)) / (seen.reduce((a, x) => a + x, 0) / seen.length);

/** Builds `p` from `stored` with the build's seed `seed`, every scale at the same value. */
const buildOf = (p: Primitive, stored: Record<string, string>, seed: number): Built =>
  (p.build as Erased)(resolveParams(p, stored, rand(1), p.id), { rand: rand(seed).fork(p.id), facts: { scale: 1 } }, null) as Built;

/** Every vertex of a part visible at full vitality, as [x, y, z, distance from the y axis]. Fallen stone that grows in is left out. */
function standing(part: Part): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let v = 0; v < part.shade.length; v++) {
    if ((part.channels.grow?.[v] ?? 0) > 0) continue;
    const [x, y, z] = [part.positions[v * 3] as number, part.positions[v * 3 + 1] as number, part.positions[v * 3 + 2] as number];
    out.push([x, y, z, Math.hypot(x, z)]);
  }
  return out;
}

/** A build's solid part of `swatch`, such as a column or wall, rather than a walkable one. */
const partOf = (built: Built, swatch: string): Part => {
  const part = built.parts.find((p) => p.swatch === swatch && p.collision === "solid");
  if (part === undefined) throw new Error(`No solid ${swatch} part.`);
  return part;
};

/** The height of a rotunda's dome halfway out from its center to its foot, over its foot's radius. */
function domeAtHalf(built: Built): number {
  const roof = standing(partOf(built, "roof"));
  const foot = Math.max(...roof.map((q) => q[3]));
  const spring = Math.min(...roof.map((q) => q[1]));
  return (Math.max(...roof.filter((q) => q[3] > 0.42 * foot && q[3] < 0.58 * foot).map((q) => q[1])) - spring) / foot;
}

/** The clear space between two of a rotunda's `columns`, in column widths, measured across the shafts halfway up. */
function openness(columns: number): (built: Built) => number {
  return (built) => {
    const stone = standing(partOf(built, "masonry"));
    // The columns stand on the floor, and nothing else is halfway up them. Their shafts' faces run one drum, 1.6 m, at a time.
    const floor = 3 * 0.34;
    const top = Math.max(...stone.filter((q) => q[3] > 5).map((q) => q[1]));
    const middle = floor + (top - floor) * 0.4;
    const slice = stone.filter((q) => Math.abs(q[1] - middle) < 0.9).map((q) => q[3]);
    const [inner, outer] = [Math.min(...slice), Math.max(...slice)];
    const [ring, girth] = [(inner + outer) / 2, outer - inner];
    return ((Math.PI * 2 * ring) / columns - girth) / girth;
  };
}

/** How much a round tower narrows from a fifth of its height to three fifths, over its radius at the lower. */
function narrowing(built: Built): number {
  const stone = standing(partOf(built, "masonry"));
  const height = Math.max(...built.parts.flatMap((p) => standing(p).map((q) => q[1])));
  const at = (share: number): number => Math.max(...stone.filter((q) => Math.abs(q[1] - share * height) < 0.3).map((q) => q[3]));
  return 1 - at(0.6) / at(0.2);
}

/** Fields whose answers differ in a visible proportion, with that proportion as built and the answers from least to most. */
const LOOKS: readonly { readonly p: Primitive; readonly field: string; readonly words: readonly string[]; readonly answers: Record<string, string>; readonly measure: (built: Built) => number }[] = [
  { p: rotunda, field: "roof", words: ["a shallow dome", "a high dome"], answers: { columns: "eight", steps: "three broad steps" }, measure: domeAtHalf },
  { p: lookoutTower, field: "profile", words: ["straight", "tapering"], answers: { height: "a lookout tower", plan: "round", galleries: "none", crown: "a conical roof", masonry: "dressed blocks" }, measure: narrowing },
];

describe("a landmark's seed", () => {
  // Builds two or three answers from sixteen seeds each, several seconds alone and more on a busy machine.
  it.each(LOOKS.map((l) => [`${l.p.id} ${l.field}`, l] as const))("keeps every seed of %s inside its word, short of the next word's look", { timeout: 60_000 }, (_name, look) => {
    const ranges = look.words.map((word) => {
      const seen = SEEDS.map((seed) => look.measure(buildOf(look.p, { ...look.answers, [look.field]: word }, seed)));
      // The seed varies the measure within each answer by more than a twentieth of its mean.
      expect(spread(seen), word).toBeGreaterThan(0.05);
      return { word, least: Math.min(...seen), most: Math.max(...seen) };
    });
    for (let k = 1; k < ranges.length; k++) expect((ranges[k - 1] as (typeof ranges)[number]).most, `${ranges[k - 1]?.word} under ${ranges[k]?.word}`).toBeLessThan((ranges[k] as (typeof ranges)[number]).least);
  });

  it("spaces a rotunda's columns as its count's words ask, every seed: close-set, evenly or wide apart", { timeout: 60_000 }, () => {
    const counts = { twelve: 12, eight: 8, six: 6 } as const;
    const ranges = (Object.keys(counts) as (keyof typeof counts)[]).map((columns) => {
      const seen = SEEDS.map((seed) => openness(counts[columns])(buildOf(rotunda, { columns, roof: "an open ring", steps: "three broad steps" }, seed)));
      expect(spread(seen), columns).toBeGreaterThan(0.05);
      return { columns, least: Math.min(...seen), most: Math.max(...seen) };
    });
    for (let k = 1; k < ranges.length; k++) expect((ranges[k - 1] as (typeof ranges)[number]).most, `${ranges[k - 1]?.columns} under ${ranges[k]?.columns}`).toBeLessThan((ranges[k] as (typeof ranges)[number]).least);
  });
});
