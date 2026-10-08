// Ruin obeys gravity. Every landmark and every building put together from
// the structure primitives is checked at vitalities from tired to ruined:
// no piece may stand on nothing, and a piece that falls must come to rest.
// A new primitive in these roles is covered as soon as it is in PRIMITIVES.

import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type Built, type BuildingPlan, type Field, Library, type Part, rand } from "@gaia/schema";
import { PRIMITIVES } from "@gaia/primitives";
import { resolveParams, unsupportedAt } from "@gaia/realize";

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
