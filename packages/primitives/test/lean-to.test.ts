// A lean-to's slope caves in about its high edge as the building fails, and
// the rafters and purlin under it go down with it: none is left standing out
// level where the slope was.

import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type BuildingPlan, type Built, rand } from "@gaia/schema";
import { cottagePlan, thatch, tiles } from "@gaia/primitives";
import { applyVitality, resolveParams } from "@gaia/realize";

type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;
const build = (p: AnyPrimitive, stored: Readonly<Record<string, string | boolean | readonly string[]>>, seed: number, input: unknown): unknown =>
  (p.build as Erased)(resolveParams(p, stored, rand(seed), p.id), { rand: rand(seed).fork(p.id), facts: { size: 1, floors: 1 } }, input);

const ROOFS = [
  ["tiles", tiles, { covering: "pantiles", chimney: "none", overhang: "sheltering" }],
  ["thatch", thatch, { thickness: "plump", chimney: "none", overhang: "sheltering" }],
] as const;

describe("a lean-to", () => {
  it.each(ROOFS)("takes every rafter it keeps under its %s down with its slope as it caves in", (_name, roof, params) => {
    let checked = 0;
    for (const shape of ["long", "snug", "gable-fronted"]) {
      for (const seed of [1, 2, 3, 4]) {
        const plan = build(cottagePlan, { massing: "a single block", shape, size: "modest", storeys: "one storey", heights: "level", roof: "gabled", roofline: "steep", attachments: ["lean-to"], windows: "several", base: "on a stone plinth", character: "gently settled" }, seed, null) as BuildingPlan;
        const lean = plan.masses.find((m) => m.roof === "lean-to");
        if (lean === undefined) continue;
        const timber = (build(roof, params, seed, plan) as Built).parts.find((p) => p.swatch === "timber");
        if (timber === undefined) throw new Error("no timber");
        const posed = applyVitality(timber, 0.1).positions;
        // The lean-to's slope falls across its span (`b`), toward `fall`; its outer half lies away from the wall it leans on.
        const alongX = lean.ridge === "x";
        const halfSpan = (alongX ? lean.depth : lean.width) / 2;
        for (let v = 0; v < timber.shade.length; v++) {
          const [x, y, z] = [timber.positions[v * 3] as number, timber.positions[v * 3 + 1] as number, timber.positions[v * 3 + 2] as number];
          // Only the roof's timbers are in this part, so those over the lean-to's outer half are its rafters and purlin.
          const a = alongX ? x - lean.x : z - lean.z;
          const b = alongX ? z - lean.z : x - lean.x;
          const halfLength = (alongX ? lean.width : lean.depth) / 2;
          // A rafter that is lost shrinks back onto its head instead; every one that stays goes down with the slope.
          if (Math.abs(a) > halfLength || lean.fall * b < 0.3 * halfSpan || (timber.channels.loss[v] ?? 0) > 0) continue;
          checked++;
          expect(y - (posed[v * 3 + 1] as number), `${shape}, seed ${seed}, a timber ${(lean.fall * b).toFixed(2)} m out from the lean-to's middle`).toBeGreaterThan(0.2);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
