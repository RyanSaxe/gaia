import { describe, expect, it } from "vitest";
import { TERRAIN, groundLook, ownershipOf, placeAt, vitalityAt, vitalityOver } from "@gaia/terrain";
import { areaVitality } from "@gaia/world";
import { openedWorld, provingWorld } from "./code-world.ts";
import { groundSites, ownerVitality } from "./place.ts";

const doc = provingWorld();
const code = openedWorld(doc);
/** Each area's vitality, every file under it pooled by size. */
const pooled = areaVitality(doc.world.patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
/** The owner of a point's ground: its file's patch, its area's lot, or the wild. `groundAt` below gives that ground's vitality. */
const ownerOf = (x: number, z: number): string => {
  const here = placeAt(doc.world, x, z);
  return here.area.depth < 0 ? "wild" : (here.file?.path ?? `lot:${here.area.path}`);
};
const groundAt = (x: number, z: number): number => {
  const here = placeAt(doc.world, x, z);
  return here.file?.vitality ?? (here.area.depth < 0 ? 1 : (pooled.get(here.area.path) ?? 1));
};
/** Offsets up to 30 m around a point. Where the land's warp bunches the ground, a neighbor's cell can be nearer than it looks, so a point counts as clear of every edge only this far in. */
const AROUND = [10, 20, 30].flatMap((r) => Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4) * r, Math.sin((k * Math.PI) / 4) * r] as const));
const clearOfEdges = (x: number, z: number): boolean => {
  const owner = ownerOf(x, z);
  return AROUND.every(([dx, dz]) => ownerOf(x + dx, z + dz) === owner);
};
/** The ground's vitality field as the page builds it: each sample's owner, weighted by each owner's vitality. */
const own = ownershipOf(groundSites(code.layout), doc.world, doc.world.size + TERRAIN.skirt * 2);
const tables = ownerVitality(doc.world, (path) => doc.world.patches.find((p) => p.path === path)?.vitality ?? 1);
const groundField = vitalityOver(own, tables.ground);
const waterField = vitalityOver(own, tables.area);

describe("the proving ground", () => {
  it("dries the ground of its low-vitality area and grove, keeps its high-vitality ground green, and clouds the low-vitality area's water", () => {
    const looks = new Map<string, { blades: number; dry: number; bare: number; water: number; count: number }>();
    let inside = 0;
    const half = doc.world.size / 2 - 20;
    for (let x = -half; x <= half; x += 4) {
      for (let z = -half; z <= half; z += 4) {
        const here = placeAt(doc.world, x, z);
        if (here.area.depth < 0) continue;
        const v = vitalityAt(own, groundField, x, z);
        // Away from its edges, the ground has exactly its file's vitality, or on a lot its area's.
        if (clearOfEdges(x, z)) {
          inside++;
          expect(Math.abs(v - groundAt(x, z)), `${ownerOf(x, z)} at ${x}, ${z}`).toBeLessThan(0.01);
        }
        const look = groundLook(v);
        for (const key of [here.area.path.split("/")[0] ?? "", here.file?.path ?? ""]) {
          const sum = looks.get(key) ?? { blades: 0, dry: 0, bare: 0, water: 0, count: 0 };
          looks.set(key, { blades: sum.blades + look.blades, dry: sum.dry + look.dry, bare: sum.bare + look.bare, water: sum.water + vitalityAt(own, waterField, x, z), count: sum.count + 1 });
        }
      }
    }
    expect(inside).toBeGreaterThan(100);
    const mean = (key: string) => {
      const sum = looks.get(key)!;
      return { blades: sum.blades / sum.count, dry: sum.dry / sum.count, bare: sum.bare / sum.count, water: sum.water / sum.count };
    };
    // The "ruins" area has low vitality throughout: its grass thins, its ground dries, bare earth opens and its water clouds.
    const ruins = mean("ruins");
    expect(ruins.blades).toBeLessThan(0.65);
    expect(ruins.dry).toBeGreaterThan(0.7);
    expect(ruins.bare).toBeGreaterThan(0.3);
    expect(ruins.water).toBeLessThan(0.1);
    for (const area of ["moor", "crossings"]) {
      const thriving = mean(area);
      expect(thriving.blades, area).toBeGreaterThan(0.97);
      expect(thriving.dry, area).toBeLessThan(0.05);
      // Bare earth shows only where a declining neighbor's ground eases across the border, as the attic's does into the
      // moor.
      expect(thriving.bare, area).toBeLessThan(0.005);
      expect(thriving.water, area).toBeGreaterThan(0.9);
    }
    // A low-vitality grove in a healthy area is one dry patch, while its neighbor's ground stays green.
    expect(mean("mixed/failing-grove.ts").dry).toBeGreaterThan(0.6);
    expect(mean("mixed/steady.ts").dry).toBeLessThan(0.1);
  });
});
