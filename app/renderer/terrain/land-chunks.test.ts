import { describe, expect, it } from "vitest";
import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { SHORE_CAP, bakeTerrain, planOf } from "@gaia/terrain";
import { FULL_WORLD, sampleWorld } from "@gaia/terrain/testing";
import { CHUNK, cutChunk, latticeIndex, bakeChunk } from "./land-chunks.ts";

// Baked once for the file. The full sample world is 1.2 km across, so its coarser levels' chunks reach past the land.
const terrain = bakeTerrain(
  sampleWorld(FULL_WORLD),
  new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]),
);
const source = {
  plan: planOf(terrain),
  edits: { pads: [], discs: [], ways: [] },
  ways: [],
};
const { n } = terrain.lattice;

interface DiffCounts {
  heights: number;
  water: number;
  region: number;
  covers: number;
}

function inBounds(ix: number, iz: number): boolean {
  return ix >= 0 && iz >= 0 && ix < n && iz < n;
}

function compareSample(
  chunk: ReturnType<typeof bakeChunk>,
  k: number,
  c: number,
  w: number,
  differ: DiffCounts,
): boolean {
  if (chunk.ground[c * 4 + 1] !== terrain.waterLevel[w]) differ.water++;
  if (chunk.region[c] !== terrain.region[w]) differ.region++;
  if (
    chunk.coverShares[c * 4] !== terrain.coverShares[w * 4] ||
    chunk.coverRegions[c * 4] !== terrain.coverRegions[w * 4]
  ) {
    differ.covers++;
  }
  // A coarser level measures the shore between its own samples, so only its samples clear of the water match the land's.
  if (k > 0 && (terrain.shore[w] as number) < SHORE_CAP) return true;
  if (
    chunk.ground[c * 4] !== terrain.lattice.heights[w] ||
    chunk.ground[c * 4 + 2] !== terrain.shore[w]
  ) {
    differ.heights++;
  }
  return false;
}

function expectChunkMatchesTerrain(k: number, cx: number, cz: number): void {
  const frame = terrain.lattice;
  const chunk = bakeChunk(source, k, cx, cz);
  let near = 0;
  const differ: DiffCounts = { heights: 0, water: 0, region: 0, covers: 0 };
  for (let j = 0; j < CHUNK; j++) {
    for (let i = 0; i < CHUNK; i++) {
      const ix = latticeIndex(frame, k, cx * CHUNK + i);
      const iz = latticeIndex(frame, k, cz * CHUNK + j);
      if (!inBounds(ix, iz)) continue;
      if (compareSample(chunk, k, j * CHUNK + i, iz * n + ix, differ)) near++;
    }
  }
  expect(differ, `level ${k}, chunk (${cx}, ${cz})`).toEqual({
    heights: 0,
    water: 0,
    region: 0,
    covers: 0,
  });
  expect(near).toBeLessThan(CHUNK * CHUNK);
}

describe("the land's chunks", () => {
  it("hold each level's samples where the ground texture takes them from the world's lattice", () => {
    for (const [k, cx, cz] of [
      [0, 0, 0],
      [0, -3, 2],
      [1, 1, -2],
      [3, 0, 0],
      [4, -1, -1],
    ] as const) {
      expectChunkMatchesTerrain(k, cx, cz);
    }
    // A land worker bakes a chunk from the plan alone, as the same chunk is cut from the whole world's land.
    for (const [k, cx, cz] of [
      [0, 0, 0],
      [0, -3, 2],
      [1, 1, -2],
      [2, 0, -1],
      [3, 0, 0],
    ] as const) {
      const baked = bakeChunk(source, k, cx, cz);
      const cut = cutChunk(terrain, source, k, cx, cz);
      expect(
        Array.from(cut.ground),
        `level ${k}, chunk (${cx}, ${cz})`,
      ).toEqual(Array.from(baked.ground));
      expect(Array.from(cut.region)).toEqual(Array.from(baked.region));
      expect(Array.from(cut.nearPond)).toEqual(Array.from(baked.nearPond));
      expect(Array.from(cut.coverShares)).toEqual(
        Array.from(baked.coverShares),
      );
      expect(Array.from(cut.trailPlaces)).toEqual(
        Array.from(baked.trailPlaces),
      );
    }
  });
});
