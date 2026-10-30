import { describe, expect, it } from "vitest";
import { TERRAIN, ownershipOf, placeAt, vitalityAt, vitalityOver } from "@gaia/terrain";
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

describe("the proving ground", () => {
  it("shows exactly its own code's vitality on the ground, away from its edges", () => {
    let inside = 0;
    const half = doc.world.size / 2 - 20;
    for (let x = -half; x <= half; x += 4) {
      for (let z = -half; z <= half; z += 4) {
        if (placeAt(doc.world, x, z).area.depth < 0 || !clearOfEdges(x, z)) continue;
        // The ground has its file's vitality, or on a lot its area's.
        inside++;
        expect(Math.abs(vitalityAt(own, groundField, x, z) - groundAt(x, z)), `${ownerOf(x, z)} at ${x}, ${z}`).toBeLessThan(0.01);
      }
    }
    expect(inside).toBeGreaterThan(0);
  });
});
