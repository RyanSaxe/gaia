// A roof's covering never stands on nothing. A piece of covering can last
// down to any vitality, because each piece reads its own noise, so wherever
// the covering lies a timber of the roof's frame must still stand under it,
// wherever the building's vitality has brought both.

import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type BuildingPlan, type Built, type Part, rand } from "@gaia/schema";
import { cottagePlan, thatch, tiles } from "@gaia/primitives";
import { applyVitality, resolveParams } from "@gaia/realize";

type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;
const build = (p: AnyPrimitive, stored: Readonly<Record<string, string | boolean | readonly string[]>>, seed: number, input: unknown): unknown =>
  (p.build as Erased)(resolveParams(p, stored, rand(seed), p.id), { rand: rand(seed).fork(p.id), facts: { size: 1, floors: 1 } }, input);

/** The cells of ground the frame is sorted into, meters: a point of covering looks for timbers this far around it. */
const REACH = 0.5;
/** How far a point of covering may lie from the nearest timber: the ridge roll of the thickest thatch over its ridge beam. */
const BELOW = 1.3;
/** How much further from a timber a point of covering may move as both sag and fall, than it lay while whole. */
const LIFT = 0.15;
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
 * The covering's points with no timber under them at vitality `v`: no timber lies within `BELOW` of the point that
 * also lay within it while the roof was whole and has not sunk away from it by more than `LIFT` since.
 */
function unsupported(built: Built, plan: BuildingPlan, v: number): string[] {
  const { whole, now, cells } = frameAt(built, v);
  const out: string[] = [];
  for (const part of built.parts.filter((p) => p.swatch === "roof") as Part[]) {
    const at = applyVitality(part, v).positions;
    for (let i = 0; i < part.shade.length; i++) {
      // The covering's upper surface, standing on the roof; what lies on the ground has fallen.
      if ((part.normals[i * 3 + 1] as number) < 0.2 || (part.channels.grow?.[i] ?? 0) > 0 || (part.positions[i * 3 + 1] as number) < plan.floor + 1) continue;
      const p: [number, number, number] = [at[i * 3] as number, at[i * 3 + 1] as number, at[i * 3 + 2] as number];
      const rest: [number, number, number] = [part.positions[i * 3] as number, part.positions[i * 3 + 1] as number, part.positions[i * 3 + 2] as number];
      let nearest = Infinity;
      const held = (cells.get(`${Math.floor(p[0] / REACH)},${Math.floor(p[2] / REACH)}`) ?? []).some((id) => {
        const gap = distance(p, now[id] as number[]);
        nearest = Math.min(nearest, gap);
        return gap <= BELOW && gap <= distance(rest, whole[id] as number[]) + LIFT;
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

describe("a roof's frame", () => {
  // Builds 36 houses with every roof form and attachment, and poses each at four vitalities: a few seconds alone.
  it.each(ROOFS)("stands under every piece of %s covering at every vitality", { timeout: 60_000 }, (_name, roof, params) => {
    for (const form of ["gabled", "hipped", "half-hipped"]) {
      for (const massing of ["a single block", "an L", "a T"]) {
        for (const attachments of [["lean-to"], ["turret", "porch"]]) {
          for (const seed of [1, 2]) {
            const plan = build(cottagePlan, { massing, shape: "long", size: "modest", storeys: "two storeys", heights: "level", roof: form, roofline: "steep", attachments, windows: "several", base: "on a stone plinth", character: "gently settled" }, seed, null) as BuildingPlan;
            const built = build(roof, params, seed, plan) as Built;
            for (const v of VITALITIES) {
              const left = unsupported(built, plan, v);
              expect(left, `${form}, ${massing}, ${attachments.join(" and ")}, seed ${seed}, vitality ${v}: ${left.length} points with no frame under them, such as ${left.slice(0, 3).join(" ")}`).toEqual([]);
            }
          }
        }
      }
    }
  });
});
