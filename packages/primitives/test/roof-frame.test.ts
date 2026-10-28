// Checks that a roof's covering always rests on its frame. Each piece of
// covering takes its own noise, so any piece can last down to any vitality,
// and a frame timber must lie under it at every vitality. Near vitality 0 the
// covering lies on that frame instead of hanging its own thickness above it.

import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type BuildingPlan, type Built, type Part, rand } from "@gaia/schema";
import { cottagePlan, granary, thatch, tiles, tower } from "@gaia/primitives";
import { applyVitality, resolveParams } from "@gaia/realize";

type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;
const build = (p: AnyPrimitive, stored: Readonly<Record<string, string | boolean | readonly string[]>>, seed: number, input: unknown): unknown =>
  (p.build as Erased)(resolveParams(p, stored, rand(seed), p.id), { rand: rand(seed).fork(p.id), facts: { size: 1, floors: 1 } }, input);

/** The size in meters of the ground cells the frame is sorted into. A point of covering checks for timbers this far round it. */
const REACH = 0.5;
/** How far a point of covering may lie from the nearest timber, set by the ridge roll of the thickest thatch over its ridge beam. */
const BELOW = 1.3;
/** How much farther from a timber a point of covering may be as both sag and fall, compared with while whole. */
const LIFT = 0.15;
/** By vitality `SETTLED` the covering has settled onto its boards, and every point of it lies within `ON` of a timber: half the rafters' spacing plus a timber's depth. */
const SETTLED = 0.1;
const ON = 0.5;
const VITALITIES = [0.5, 0.25, 0.1, 0.03];

/** The distance from a point to a triangle. */
function distance(p: readonly [number, number, number], t: readonly number[]): number {
  const sub = (u: readonly number[], v: readonly number[]): [number, number, number] => [(u[0] as number) - (v[0] as number), (u[1] as number) - (v[1] as number), (u[2] as number) - (v[2] as number)];
  const dot = (u: readonly number[], v: readonly number[]): number => (u[0] as number) * (v[0] as number) + (u[1] as number) * (v[1] as number) + (u[2] as number) * (v[2] as number);
  const a = t.slice(0, 3);
  const b = t.slice(3, 6);
  const c = t.slice(6, 9);
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  // The nearest point by region of the triangle (Ericson, Real-Time Collision Detection, 5.1.5).
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  const at = (q: readonly number[]): number => Math.hypot(...sub(p, q));
  const on = (s: number, u: number): number => at([0, 1, 2].map((k) => (a[k] as number) + s * (ab[k] as number) + u * (ac[k] as number)));
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return on(d1 / (d1 - d3), 0);
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return on(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return at([0, 1, 2].map((k) => (b[k] as number) + w * ((c[k] as number) - (b[k] as number))));
  }
  const den = 1 / (va + vb + vc);
  return on(vb * den, vc * den);
}

/** The frame's triangles while whole and at vitality `v`, and their indices by the cells of ground they then cover. */
function frameAt(built: Built, v: number): { whole: number[][]; now: number[][]; cells: Map<string, number[]> } {
  const whole: number[][] = [];
  const now: number[][] = [];
  const cells = new Map<string, number[]>();
  for (const part of built.parts.filter((p) => p.swatch === "timber")) {
    const at = applyVitality(part, v).positions;
    for (let i = 0; i < part.indices.length; i += 3) {
      const corner = (from: ArrayLike<number>): number[] => [0, 1, 2].flatMap((k) => [0, 1, 2].map((c) => from[(part.indices[i + k] as number) * 3 + c] as number));
      const t = corner(at);
      const id = now.length;
      whole.push(corner(part.positions));
      now.push(t);
      const xs = [t[0], t[3], t[6]] as number[];
      const zs = [t[2], t[5], t[8]] as number[];
      for (let gi = Math.floor((Math.min(...xs) - REACH) / REACH); gi <= Math.floor((Math.max(...xs) + REACH) / REACH); gi++) {
        for (let gj = Math.floor((Math.min(...zs) - REACH) / REACH); gj <= Math.floor((Math.max(...zs) + REACH) / REACH); gj++) {
          const list = cells.get(`${gi},${gj}`) ?? [];
          list.push(id);
          cells.set(`${gi},${gj}`, list);
        }
      }
    }
  }
  return { whole, now, cells };
}

/**
 * The covering's points with no timber under them at vitality `v`. A timber supports a point when it lies within
 * `BELOW` of it now, lay within `BELOW` while the roof was whole, and has not moved more than `LIFT` farther from it
 * since. From `SETTLED` down the covering has settled onto its boards, and a timber needs only to lie within `ON` of
 * it, except under a lean-to's slope, which caves in whole about its high edge and keeps its thickness.
 */
function unsupported(built: Built, plan: BuildingPlan, v: number): string[] {
  const { whole, now, cells } = frameAt(built, v);
  const out: string[] = [];
  for (const part of built.parts.filter((p) => p.swatch === "roof") as Part[]) {
    const at = applyVitality(part, v).positions;
    for (let i = 0; i < part.shade.length; i++) {
      // Only the covering's upper surface on the roof. Anything on the ground has fallen.
      if ((part.normals[i * 3 + 1] as number) < 0.2 || (part.channels.grow?.[i] ?? 0) > 0 || (part.positions[i * 3 + 1] as number) < plan.floor + 1) continue;
      const p: [number, number, number] = [at[i * 3] as number, at[i * 3 + 1] as number, at[i * 3 + 2] as number];
      const rest: [number, number, number] = [part.positions[i * 3] as number, part.positions[i * 3 + 1] as number, part.positions[i * 3 + 2] as number];
      const settled = v <= SETTLED && (part.channels.fall?.[i * 4 + 3] ?? 0) === 0;
      let nearest = Infinity;
      const held = (cells.get(`${Math.floor(p[0] / REACH)},${Math.floor(p[2] / REACH)}`) ?? []).some((id) => {
        const gap = distance(p, now[id] as number[]);
        nearest = Math.min(nearest, gap);
        return settled ? gap <= ON : gap <= BELOW && gap <= distance(rest, whole[id] as number[]) + LIFT;
      });
      if (!held) out.push(`(${p.map((c) => c.toFixed(2)).join(", ")}) ${nearest.toFixed(2)} m from the frame`);
    }
  }
  return out;
}

const ROOFS = [
  ["tiles", tiles, { covering: "pantiles", chimney: "none", overhang: "sheltering" }],
  ["thatch", thatch, { thickness: "deep and soft", chimney: "none", overhang: "deep and low" }],
] as const;

/** Every house the tests build: every roof form, single, L and T, with a lean-to or a turret and porch. */
const HOUSES = ["gabled", "hipped", "half-hipped"].flatMap((form) =>
  ["a single block", "an L", "a T"].flatMap((massing) =>
    [["lean-to"], ["turret", "porch"]].flatMap((attachments) =>
      [1, 2].map((seed) => ({
        seed,
        what: `${form}, ${massing}, ${attachments.join(" and ")}, seed ${seed}`,
        plan: build(cottagePlan, { massing, shape: "long", size: "modest", storeys: "two storeys", heights: "level", roof: form, roofline: "steep", attachments, windows: "several", base: "on a stone plinth", character: "gently settled" }, seed, null) as BuildingPlan,
      })),
    ),
  ),
);

describe("a roof's frame", () => {
  // Builds 36 houses with every roof form and attachment, and poses each at four vitalities: a few seconds alone.
  it.each(ROOFS)("stands under every piece of %s covering at every vitality", { timeout: 60_000 }, (_name, roof, params) => {
    for (const { seed, what, plan } of HOUSES) {
      const built = build(roof, params, seed, plan) as Built;
      for (const v of VITALITIES) {
        const left = unsupported(built, plan, v);
        expect(left, `${what}, vitality ${v}: ${left.length} points with no frame under them, such as ${left.slice(0, 3).join(" ")}`).toEqual([]);
      }
    }
  });
});

/** Features that carry roofs of their own, each built every way it can be. */
const FEATURES = [
  ["an archive tower's cap", tower, ["a storey above", "tall", "soaring"].flatMap((height) => ["pyramid", "lantern"].map((cap) => ({ height, cap })))],
  ["a granary's roof", granary, ["a small store", "a granary", "a great granary"].flatMap((size) => ["gabled", "hipped"].map((roof) => ({ size, roof })))],
] as const;

describe("a feature's roof", () => {
  // Builds each feature six ways on 18 houses and poses each at four vitalities: about 3 s alone.
  it.each(FEATURES)("stands %s on its own frame at every vitality", { timeout: 30_000 }, (_name, feature, stored) => {
    for (const { seed, what, plan } of HOUSES.filter((h) => h.seed === 1)) {
      for (const params of stored) {
        const built = build(feature, params, seed, plan) as Built;
        for (const v of VITALITIES) {
          const left = unsupported(built, plan, v);
          expect(left, `${what}, ${JSON.stringify(params)}, vitality ${v}: ${left.length} points with no frame under them, such as ${left.slice(0, 3).join(" ")}`).toEqual([]);
        }
      }
    }
  });
});
