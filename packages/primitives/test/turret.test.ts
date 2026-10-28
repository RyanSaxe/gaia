// Checks that where a turret stands over a corner of the main body, the main
// roof's eave runs into it, and no corner of the covering pokes out through
// the turret's angled face.

import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type BuildingPlan, type Built, rand } from "@gaia/schema";
import { cottagePlan, thatch, tiles } from "@gaia/primitives";
import { resolveParams } from "@gaia/realize";

type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;
const build = (p: AnyPrimitive, stored: Readonly<Record<string, string | boolean | readonly string[]>>, seed: number, input: unknown): unknown =>
  (p.build as Erased)(resolveParams(p, stored, rand(seed), p.id), { rand: rand(seed).fork(p.id), facts: { size: 1, floors: 1 } }, input);

const ROOFS = [
  ["tiles", tiles, { covering: "pantiles", chimney: "none" }],
  ["thatch", thatch, { thickness: "deep and soft", chimney: "none" }],
] as const;

describe("a turret", () => {
  // Builds 162 houses and their roofs, a few seconds alone and more on a busy machine.
  it.each(ROOFS)("takes the main roof's %s eave into it, never through its angled face", { timeout: 30_000 }, (_name, roof, params) => {
    for (const shape of ["long", "snug", "gable-fronted"]) {
      for (const form of ["gabled", "hipped", "half-hipped"]) {
        for (const overhang of ["neat and close", "sheltering", "deep and low"]) {
          for (const seed of [1, 2, 3]) {
            // A single block, so every covering but the cone's is the main roof's.
            const plan = build(cottagePlan, { massing: "a single block", shape, size: "modest", storeys: "two storeys", heights: "level", roof: form, roofline: "steep", attachments: ["turret"], windows: "several", base: "on a stone plinth", character: "gently settled" }, seed, null) as BuildingPlan;
            const [main, turret] = plan.masses as [BuildingPlan["masses"][number], BuildingPlan["masses"][number]];
            const sx = Math.sign(turret.x - main.x);
            const sz = Math.sign(turret.z - main.z);
            const corner = { x: main.x + (sx * main.width) / 2, z: main.z + (sz * main.depth) / 2 };
            const covering = (build(roof, { ...params, overhang }, seed, plan) as Built).parts.find((p) => p.swatch === "roof");
            if (covering === undefined) throw new Error("no covering");
            let through = 0;
            for (let v = 0; v < covering.shade.length; v++) {
              const [x, y, z] = [covering.positions[v * 3] as number, covering.positions[v * 3 + 1] as number, covering.positions[v * 3 + 2] as number];
              // Skip the cone's own covering, above the turret's walls, and fallen covering on the ground.
              if (y > plan.floor + turret.wallHeight - 1 || (covering.channels.grow?.[v] ?? 0) > 0) continue;
              if (sx * (x - corner.x) <= 0 || sz * (z - corner.z) <= 0) continue;
              if (Math.abs(x - turret.x) < turret.width / 2 && Math.abs(z - turret.z) < turret.width / 2 && (sx * (x - turret.x) + sz * (z - turret.z)) / Math.SQRT2 > turret.width / 2) through++;
            }
            expect(through, `${shape}, ${form}, ${overhang}, seed ${seed}`).toBe(0);
          }
        }
      }
    }
  });
});
