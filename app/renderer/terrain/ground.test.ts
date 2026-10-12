import { describe, expect, it } from "vitest";
import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { FULL_WORLD, bakeTerrain, sampleWorld } from "@gaia/terrain";
import { CLIP, createGroundTexture } from "./ground.ts";

// Baked once for the file: the full sample world, 1.2 km across, so its far levels hold more than the land.
const terrain = bakeTerrain(sampleWorld(FULL_WORLD), new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]));
const { n, origin, spacing } = terrain.lattice;

/** Level k's texel for the world point (x, z), which must lie on its grid and in its window: height, water, shore. */
function texel(ground: ReturnType<typeof createGroundTexture>, k: number, x: number, z: number): number[] {
  const unit = spacing * 2 ** k;
  const o = ground.uniforms.uClipOrigin.value[k] as { x: number; y: number };
  const c = Math.round(x / unit) - o.x;
  const r = Math.round(z / unit) - o.y;
  expect(c >= 0 && c < CLIP.size && r >= 0 && r < CLIP.size, `level ${k} holds (${x}, ${z})`).toBe(true);
  const data = ground.texture.image.data as Float32Array;
  const at = (k * CLIP.size * CLIP.size + r * CLIP.size + c) * 4;
  return [data[at] as number, data[at + 1] as number, data[at + 2] as number];
}

/** The land's own sample at (x, z): height, water, shore. */
function sample(x: number, z: number): number[] {
  const i = Math.round((z - origin) / spacing) * n + Math.round((x - origin) / spacing);
  return [terrain.lattice.heights[i] as number, terrain.waterLevel[i] as number, terrain.shore[i] as number];
}

describe("the ground's clipmap", () => {
  it("holds in each level the land's own samples on that level's grid, as the rings read them", () => {
    const ground = createGroundTexture(terrain);
    for (let k = 0; k < CLIP.levels; k++) {
      const unit = spacing * 2 ** k;
      // Points of level k's grid near the person and toward its window's edge, on the land.
      for (const [dx, dz] of [[0, 0], [3, -7], [-90, 41], [120, 120]] as const) {
        const x = Math.max(origin, Math.min(-origin, dx * unit));
        const z = Math.max(origin, Math.min(-origin, dz * unit));
        const gx = Math.trunc(x / unit) * unit;
        const gz = Math.trunc(z / unit) * unit;
        expect(texel(ground, k, gx, gz)).toEqual(sample(gx, gz));
      }
    }
  });

  it("lays a level again around a person who has walked away from it, still with the land's own samples", () => {
    const ground = createGroundTexture(terrain);
    const before = (ground.uniforms.uClipOrigin.value[0] as { x: number }).x;
    // Far enough that level 0 is laid at once; then every level near the new place reads the land as it is there.
    ground.follow(400, -300);
    expect((ground.uniforms.uClipOrigin.value[0] as { x: number }).x).not.toBe(before);
    for (const [x, z] of [[400, -300], [430, -260], [350, -350]] as const) expect(texel(ground, 0, x, z)).toEqual(sample(x, z));
  });
});
