import { describe, expect, it } from "vitest";
import { type BuildingPlan, type Built, Library, blueprintOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, RELIEF_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { structure } from "@gaia/kinds";
import { realize } from "@gaia/realize";
import { BANK_SITE, type WorldSpec, bakeTerrain, extentOf, findBankSite, heightAt, levelPad, siteToWorld, turningExtent, waterDepthAt } from "@gaia/terrain";
import { randomWorld } from "@gaia/terrain/testing";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
/** A stone house with a waterwheel. */
const mill = blueprintOf("structure", {
  footprint: {
    use: "cottage-plan@1",
    params: { massing: "a long range", shape: "long", size: "roomy", storeys: "two storeys", heights: "stepped", roof: "gabled", roofline: "steep", attachments: [], windows: "several", base: "on a stone plinth", character: "gently settled" },
  },
  body: { use: "fieldstone@1", params: { stones: "mixed sizes", gables: "boards" } },
  roof: { use: "tiles@1", params: { covering: "shingles", overhang: "sheltering", chimney: "gable" } },
  feature: { use: "waterwheel@1", params: { wheel: "a great wheel", drive: "overshot" } },
  openings: { use: "casements@1", params: { panes: "six panes", shutters: true, door: "plank" } },
  ornaments: { use: "cottage-garden@1", params: { extras: ["lantern", "woodpile"], walk: "flagstones" } },
  palette: { use: "palette@1", params: { family: "teal-gold", contrast: "balanced" } },
});
// The mill is the size of the median building with a wheel in Gaia's world and the proving ground, about 54 m².
const built = realize(mill, structure, new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]), { seed: 7, facts: { size: 0.7, floors: 1 } });
const plan = built.slots.get("footprint")?.output as BuildingPlan;
const beside = extentOf(built.slots.get("feature")?.output as Built | undefined)!;
const turning = turningExtent(built.slots.get("feature")?.output as Built | undefined)!;
/** The wheel: its center in the house's frame, and the lowest its paddles reach below the floor. */
const wheel = (() => {
  let x = 0;
  let z = 0;
  let n = 0;
  let lowest = Infinity;
  for (const part of built.parts) {
    const spin = part.channels.spin;
    if (spin === undefined) continue;
    for (let i = 0; i < part.positions.length; i += 3) {
      if (spin[i] === 0 && spin[i + 1] === 0 && spin[i + 2] === 0) continue;
      x += part.positions[i] as number;
      z += part.positions[i + 2] as number;
      n++;
      lowest = Math.min(lowest, part.positions[i + 1] as number);
    }
  }
  return { x: x / n, z: z / n, lowest };
})();

describe("a building whose wheel needs running water", () => {
  /** Whether a region's land runs water: a valley with a stream that is not a dry bed. */
  const running = (r: WorldSpec["regions"][number]): boolean => {
    const relief = r.biome.slots.relief;
    const stream = (relief?.params as { stream?: string } | undefined)?.stream;
    return relief?.use === "valley@1" && stream !== undefined && stream !== "dry bed";
  };
  // Of fifty random worlds, bakes only the score or so with running water and searches their banks. It takes well under
  // a minute alone, more when other work shares the machine.
  it("finds a bank in every region given running water, in fifty random worlds, its house dry and its wheel in the stream", () => {
    let regions = 0;
    for (let seed = 9000; seed < 9050; seed++) {
      const spec = randomWorld(lib, seed);
      if (!spec.regions.some(running)) continue;
      const t = bakeTerrain(spec, lib);
      spec.regions.forEach((r, ri) => {
        if (!running(r)) return;
        regions++;
        const site = findBankSite(t, plan, beside, turning, ri);
        expect(site, `world ${seed}, region ${r.id}`).not.toBeNull();
        if (site === null) return;
        const at = (lx: number, lz: number): [number, number] => siteToWorld(site, lx, lz);
        // The house is on dry ground, and its pad is close enough to all the ground under it.
        for (let lx = -plan.width / 2; lx <= plan.width / 2; lx += 1) for (let lz = -plan.depth / 2; lz <= plan.depth / 2; lz += 1) {
          expect(waterDepthAt(t, ...at(lx, lz))).toBe(0);
          expect(Math.abs(heightAt(t.lattice, ...at(lx, lz)) - site.level)).toBeLessThanOrEqual(BANK_SITE.blended + 1e-6);
        }
        // Its wheel's paddles reach below the water's surface where the wheel turns.
        const terrain = { ...t, lattice: { ...t.lattice, heights: t.lattice.heights.slice() } };
        levelPad(terrain, plan, site, beside);
        const [x, z] = at(wheel.x, wheel.z);
        expect(site.level + wheel.lowest).toBeLessThan(heightAt(terrain.lattice, x, z, terrain.waterLevel));
        // The pad leaves the stream unchanged, so water still runs under the wheel and past it.
        expect(waterDepthAt(terrain, x, z)).toBeGreaterThan(0);
      });
    }
    expect(regions).toBeGreaterThanOrEqual(15);
  }, 300_000);
});
