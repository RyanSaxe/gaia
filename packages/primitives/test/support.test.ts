// Ruin obeys gravity, and so does everything that grows. Every landmark and
// every building put together from the structure primitives is checked at
// vitalities from tired to ruined: no piece may stand on nothing, and a piece
// that falls must come to rest. Every plant put together from the flora
// primitives is checked healthy, tired and failing, in still air and in a
// strong gust: every leaf, flower and twig is carried by what it grows on.
// Every plant and drift of wildflowers also keeps its shape in that gust: the
// wind turns pieces about their joints, so no triangle stretches, splits or
// folds. A new primitive in these roles is covered as soon as it is in
// PRIMITIVES.

import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type Built, type BuildingPlan, type Field, Library, type Part, rand } from "@gaia/schema";
import { PRIMITIVES } from "@gaia/primitives";
import { FLUTTERS, type WindState, applyVitality, gustAt, resolveParams, unsupportedAt } from "@gaia/realize";

const lib = new Library(PRIMITIVES);
const facts = { scale: 1, age: 120 };
/** Vitalities from tired to ruined, each falling inside some pieces' collapse. */
const VITALITIES = [0.62, 0.45, 0.3, 0.2, 0.12, 0.06];
/** Buildings are many times larger, so they are held at fewer. */
const BUILDING_VITALITIES = [0.45, 0.2, 0.06];
/** A building is its plan and one primitive in each of these roles. */
const BUILDING_ROLES = ["Walls", "Roof", "Openings", "Dressing", "Feature"] as const;
/**
 * A great tree's crown and twigs hang from joints the flora primitives share
 * with every tree, so trees answer to flora's rules, not these.
 */
const TREES = new Set(["great-tree@1"]);
/** Plants are held healthy, tired and failing. */
const FLORA_VITALITIES = [1, 0.5, 0.15];
/** A whole plant's triangles: a tree's crown, bark and blossoms together. */
const PLANT_BUDGET = 40_000;
/** A great tree stands alone, one to a region, so its crown and its great frame may take more. */
const GREAT_TREE_BUDGET = 80_000;

type Stored = Record<string, string | boolean | string[]>;
type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;

/** The lowest, middle and highest level of every scale, with every choice option cycled through (as the contract test samples). */
function samples(p: AnyPrimitive): Stored[] {
  const options = Math.max(3, ...(Object.values(p.params) as Field[]).map((f) => (f.type === "choice" ? Object.keys(f.options).length : 0)));
  return Array.from({ length: options }, (_, i) => [0, 0.5, 1][i % 3] as number).map((at, i) => {
    const out: Stored = {};
    for (const [name, f] of Object.entries(p.params) as [string, Field][]) {
      if (f.type === "scale") out[name] = f.levels[Math.round(at * (f.levels.length - 1))]?.words ?? "";
      else if (f.type === "choice") {
        const keys = Object.keys(f.options);
        out[name] = keys[i % keys.length] ?? "";
      } else if (f.type === "flag") out[name] = i % 2 === 0;
      else out[name] = Object.keys(f.members).filter((_, k) => (k + i) % 2 === 0);
    }
    return out;
  });
}

function build(p: AnyPrimitive, stored: Stored, input: unknown, seed: number): unknown {
  const params = resolveParams(p, stored, rand(seed), p.id);
  return (p.build as Erased)(params, { rand: rand(seed).fork(p.id), facts }, input);
}

const describeFloaters = (parts: readonly Part[], v: number, moving = true): string[] =>
  unsupportedAt(parts, v, { moving }).map((u) => `${parts[u.part]?.swatch} ${u.why} at (${u.at.map((c) => c.toFixed(1)).join(", ")}), vitality ${v}`);

describe.each(lib.forRole("Landmark").filter((p) => !TREES.has(p.id)).map((p) => [p.id, p] as const))("%s", (_id, p) => {
  it.each(samples(p).map((s, i) => [i, s] as const))("leaves no piece on nothing at any vitality, whole or partway gone (sample %i)", (i, s) => {
    const parts = (build(p, s, null, 5 + i) as Built).parts as Part[];
    expect(VITALITIES.flatMap((v) => describeFloaters(parts, v))).toEqual([]);
  }, 20_000);
});

describe("buildings", () => {
  const plans: BuildingPlan[] = lib.forRole("Footprint").flatMap((p) => samples(p).map((s, i) => build(p, s, null, 13 + i) as BuildingPlan));
  // Each plan with each walls primitive, the other roles cycled, so every structure primitive is built several ways.
  const cases = plans.flatMap((plan, i) => lib.forRole("Walls").map((_, k) => [i, k, plan] as const));
  it.each(cases)("leave no standing piece on nothing, and every fallen piece at rest (plan %i, walls %i)", (i, k, plan) => {
    const parts: Part[] = [];
    for (const role of BUILDING_ROLES) {
      const choices = lib.forRole(role);
      const p = role === "Walls" ? choices[k] : role === "Feature" ? [undefined, ...choices][(i + k) % (choices.length + 1)] : choices[(i + k) % choices.length];
      if (p === undefined) continue;
      parts.push(...((build(p, samples(p)[(i + k) % samples(p).length] as Stored, plan, 7 + i) as Built).parts as Part[]));
    }
    expect(BUILDING_VITALITIES.flatMap((v) => describeFloaters(parts, v, false))).toEqual([]);
  }, 20_000);
});

/**
 * The gustiest world's strongest gust in ten minutes over a supple plant: the
 * most any plant bends. That world blows at strength 1.55, and its gusts come
 * from the wind field; 2 leaves room to spare.
 */
const GUST: WindState = (() => {
  let time = 0;
  for (let t = 0; t < 600; t += 0.05) if (gustAt(0, 0, t) > gustAt(0, 0, time)) time = t;
  return { time, strength: 2, sway: 0.9, frequency: 1.1, height: 6, at: [0, 0, 0], seed: 0.3 };
})();
/** Moments through that gust, so each level is caught near the top of its swing. */
const GUST_MOMENTS = [0, 0.35, 0.7, 1.05, 1.4].map((dt) => ({ ...GUST, time: GUST.time + dt }));

/** How far a triangle's edge may stretch or shrink in the wind, as a ratio: a smooth bend changes it a little. */
const STRETCH = 1.25;

/** Each triangle of `parts`, healthy, whose edge stretches or shrinks past `STRETCH` or which turns over, in each of `moments`. */
function misshapen(parts: readonly Part[], moments: readonly WindState[]): string[] {
  const out: string[] = [];
  const at = (a: Float32Array, i: number): [number, number, number] => [a[i * 3] as number, a[i * 3 + 1] as number, a[i * 3 + 2] as number];
  const sub = (a: number[], b: number[]): number[] => [(a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number), (a[2] as number) - (b[2] as number)];
  const cross = (a: number[], b: number[]): number[] => [(a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number), (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number), (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number)];
  const dot = (a: number[], b: number[]): number => (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
  for (const part of parts) {
    const rest = applyVitality(part, 1).positions;
    for (const wind of moments) {
      const moved = applyVitality(part, 1, undefined, { state: wind, flutter: FLUTTERS.has(part.swatch) }).positions;
      for (let t = 0; t < part.indices.length && out.length < 5; t += 3) {
        const ids = [part.indices[t], part.indices[t + 1], part.indices[t + 2]] as number[];
        const r = ids.map((i) => at(rest, i));
        const m = ids.map((i) => at(moved, i));
        const where = `${part.swatch} triangle at (${(r[0] as number[]).map((c) => c.toFixed(2)).join(", ")}), ${wind.time.toFixed(2)} s`;
        for (let e = 0; e < 3; e++) {
          const lr = Math.hypot(...sub(r[e] as number[], r[(e + 1) % 3] as number[]));
          const lm = Math.hypot(...sub(m[e] as number[], m[(e + 1) % 3] as number[]));
          if (lr > 0.002 && (lm > lr * STRETCH || lm < lr / STRETCH)) {
            out.push(`${where}: an edge goes from ${lr.toFixed(3)} m to ${lm.toFixed(3)} m`);
            break;
          }
        }
        const nr = cross(sub(r[1] as number[], r[0] as number[]), sub(r[2] as number[], r[0] as number[]));
        const nm = cross(sub(m[1] as number[], m[0] as number[]), sub(m[2] as number[], m[0] as number[]));
        if (Math.hypot(...nr) > 1e-5 && dot(nr, nm) < 0) out.push(`${where}: it turns over`);
      }
    }
  }
  return out;
}

describe("plants", () => {
  const skeletons = lib.forRole("Skeleton").flatMap((p) => samples(p).map((s, i) => build(p, s, null, 21 + i)));
  const bark = lib.forRole("Surface")[0] as AnyPrimitive;
  const bloom = lib.forRole("Ornament")[0] as AnyPrimitive;
  // Each crown on frames of every kind, with bark under it and blossoms on it, cycling their words.
  const cases = lib.forRole("Foliage").flatMap((crown) => samples(crown).map((s, i) => [crown.id, i, crown, s] as const));
  const plantOf = (crown: AnyPrimitive, s: Stored, i: number): Part[] => {
    const frame = skeletons[(i * 5 + crown.id.length) % skeletons.length];
    const built = build(crown, s, frame, 9 + i) as Built;
    const flowers = build(bloom, samples(bloom)[i % 3] as Stored, built.anchors, 4 + i) as Built;
    return [...((build(bark, samples(bark)[i % 3] as Stored, frame, 3) as Built).parts as Part[]), ...(built.parts as Part[]), ...(flowers.parts as Part[])];
  };
  it.each(cases)("%s carries every leaf, flower and twig at any vitality, in still air and a gust (sample %i)", (_id, i, crown, s) => {
    const parts = plantOf(crown, s, i);
    const height = Math.max(...parts.map((p) => p.positions.reduce((m, y, k) => (k % 3 === 1 ? Math.max(m, y) : m), 0.3)));
    const floaters = FLORA_VITALITIES.flatMap((v) => [...describeFloaters(parts, v), ...unsupportedAt(parts, v, { wind: { ...GUST, height } }).map((u) => `${parts[u.part]?.swatch} ${u.why} in the gust at (${u.at.map((c) => c.toFixed(1)).join(", ")}), vitality ${v}`)]);
    expect(floaters).toEqual([]);
    expect(parts.reduce((n, p) => n + p.indices.length / 3, 0)).toBeLessThanOrEqual(PLANT_BUDGET);
  }, 60_000);
  it.each(samples(lib.get("great-tree@1")).map((s, i) => [i, s] as const))("a great tree carries every leaf and twig at any vitality, in still air and a gust (sample %i)", (i, s) => {
    const parts = (build(lib.get("great-tree@1"), s, null, 5 + i) as Built).parts as Part[];
    const floaters = FLORA_VITALITIES.flatMap((v) => [...describeFloaters(parts, v), ...unsupportedAt(parts, v, { wind: { ...GUST, height: 20 } }).map((u) => `${parts[u.part]?.swatch} ${u.why} in the gust at (${u.at.map((c) => c.toFixed(1)).join(", ")}), vitality ${v}`)]);
    expect(floaters).toEqual([]);
    expect(parts.reduce((n, p) => n + p.indices.length / 3, 0)).toBeLessThanOrEqual(GREAT_TREE_BUDGET);
    // A great tree carries up to 80,000 triangles and is checked six ways: up to a minute alone.
  }, 240_000);
  it.each(cases)("%s keeps its shape in the gust: no triangle stretches, splits or folds (sample %i)", (_id, i, crown, s) => {
    const parts = plantOf(crown, s, i);
    const height = Math.max(...parts.map((p) => p.positions.reduce((m, y, k) => (k % 3 === 1 ? Math.max(m, y) : m), 0.3)));
    expect(misshapen(parts, GUST_MOMENTS.map((g) => ({ ...g, height })))).toEqual([]);
  }, 60_000);
  it.each(samples(lib.get("great-tree@1")).map((s, i) => [i, s] as const))("a great tree's leaves reach across its whole crown (sample %i)", (i, s) => {
    const parts = (build(lib.get("great-tree@1"), s, null, 5 + i) as Built).parts as Part[];
    const spanOf = (swatch: string, axis: number): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of parts.filter((q) => q.swatch === swatch)) {
        for (let k = axis; k < p.positions.length; k += 3) {
          lo = Math.min(lo, p.positions[k] as number);
          hi = Math.max(hi, p.positions[k] as number);
        }
      }
      return hi > lo ? hi - lo : 0;
    };
    // Leaves on every limb tip span at least most of what the limbs and roots span.
    for (const axis of [0, 2]) if (spanOf("leaf", axis) > 0) expect(spanOf("leaf", axis)).toBeGreaterThan(0.85 * spanOf("bark", axis));
  }, 30_000);
  it.each(samples(lib.get("great-tree@1")).map((s, i) => [i, s] as const))("a great tree keeps its shape in the gust (sample %i)", (i, s) => {
    const parts = (build(lib.get("great-tree@1"), s, null, 5 + i) as Built).parts as Part[];
    expect(misshapen(parts, GUST_MOMENTS.map((g) => ({ ...g, height: 20 })))).toEqual([]);
  }, 120_000);
  const drifts = lib.forRole("Drift").flatMap((p) => samples(p).map((s, i) => [p.id, i, p, s] as const));
  it.each(drifts)("%s keeps every stem, leaf and flower whole in the gust (sample %i)", (_id, i, p, s) => {
    const parts = (build(p, s, null, 11 + i) as Built).parts as Part[];
    const height = Math.max(...parts.map((q) => q.positions.reduce((m, y, k) => (k % 3 === 1 ? Math.max(m, y) : m), 0.3)));
    expect(misshapen(parts, GUST_MOMENTS.map((g) => ({ ...g, height })))).toEqual([]);
  }, 60_000);
});
