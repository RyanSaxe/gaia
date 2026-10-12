import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import { Library, type RouteSpec } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { COVER_TAPS, DRY, FULL_WORLD, type TrailEnd, bakeTerrain, planTrails, sampleWorld, trailPlaces } from "@gaia/terrain";
import { CLIP, createGroundTexture } from "./ground.ts";

// Baked once for the file: the full sample world, 1.2 km across, so its far levels hold more than the land.
const terrain = bakeTerrain(sampleWorld(FULL_WORLD), new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]));
const { n, origin, spacing } = terrain.lattice;
// A few trails between neighboring regions' hearts, planned once; their places as the bake gives them.
const STYLE: RouteSpec = { width: 1.4, wear: 0.7, edging: "none", winding: 0.45, crossing: "footbridge" };
const hearts: TrailEnd[] = terrain.spec.regions.map((r) => ({ id: r.id, x: r.x * 0.8, z: r.z * 0.8 }));
const network = planTrails(
  terrain,
  [0, 2, 4, 6].map((a) => ({ id: `${a}`, from: hearts[a] as TrailEnd, to: hearts[a + 1] as TrailEnd, style: STYLE, want: 1 })),
  41,
);
const places = trailPlaces(terrain, network.ways);

type Ground = ReturnType<typeof createGroundTexture>;

/** Level k's texel for the world point (x, z), which must lie on its grid and in its window: its `channels` values. */
function texel(ground: Ground, texture: THREE.DataArrayTexture, channels: number, k: number, x: number, z: number): number[] {
  const unit = spacing * 2 ** k;
  const o = ground.uniforms.uClipOrigin.value[k] as { x: number; y: number };
  const c = Math.round(x / unit) - o.x;
  const r = Math.round(z / unit) - o.y;
  expect(c >= 0 && c < CLIP.size && r >= 0 && r < CLIP.size, `level ${k} holds (${x}, ${z})`).toBe(true);
  const data = texture.image.data as Float32Array | Uint8Array;
  const at = (k * CLIP.size * CLIP.size + r * CLIP.size + c) * channels;
  return Array.from(data.subarray(at, at + channels));
}
/** Whether level k's window holds the world point (x, z). */
function holds(ground: Ground, k: number, x: number, z: number): boolean {
  const unit = spacing * 2 ** k;
  const o = ground.uniforms.uClipOrigin.value[k] as { x: number; y: number };
  const c = Math.round(x / unit) - o.x;
  const r = Math.round(z / unit) - o.y;
  return c >= 0 && c < CLIP.size && r >= 0 && r < CLIP.size;
}
const heightsAt = (g: Ground, k: number, x: number, z: number): number[] => texel(g, g.texture, 4, k, x, z).slice(0, 3);
const regionsAt = (g: Ground, k: number, x: number, z: number): number[] => texel(g, g.uniforms.uCoverRegions.value, COVER_TAPS, k, x, z);
const sharesAt = (g: Ground, k: number, x: number, z: number): number[] => texel(g, g.uniforms.uCoverShares.value, COVER_TAPS, k, x, z);
const placesAt = (g: Ground, k: number, x: number, z: number): number[] => texel(g, g.uniforms.uTrailPlace.value, 2, k, x, z);

/** The land's own sample index at (x, z). */
const indexOf = (x: number, z: number): number => Math.round((z - origin) / spacing) * n + Math.round((x - origin) / spacing);
/** The land's own sample at (x, z): height, water, shore. */
const sample = (x: number, z: number): number[] => {
  const i = indexOf(x, z);
  return [terrain.lattice.heights[i] as number, terrain.waterLevel[i] as number, terrain.shore[i] as number];
};
const taps = (of: Uint8Array, x: number, z: number): number[] => Array.from(of.subarray(indexOf(x, z) * COVER_TAPS, (indexOf(x, z) + 1) * COVER_TAPS));

/** Points of level k's grid near the person and toward its window's edge, on the land. */
function gridPoints(k: number): [number, number][] {
  const unit = spacing * 2 ** k;
  return ([[0, 0], [3, -7], [-90, 41], [120, 120]] as const).map(([dx, dz]) => {
    const x = Math.max(origin, Math.min(-origin, dx * unit));
    const z = Math.max(origin, Math.min(-origin, dz * unit));
    return [Math.trunc(x / unit) * unit, Math.trunc(z / unit) * unit];
  });
}

/** Every 7th point of every way's center line, as world points on level k's grid that its window holds. */
function treadPoints(ground: Ground, k: number): [number, number][] {
  const unit = spacing * 2 ** k;
  const out: [number, number][] = [];
  for (const way of network.ways) {
    for (let p = 0; p < way.points.length / 2; p += 7) {
      const x = Math.round((way.points[p * 2] as number) / unit) * unit;
      const z = Math.round((way.points[p * 2 + 1] as number) / unit) * unit;
      if (holds(ground, k, x, z)) out.push([x, z]);
    }
  }
  return out;
}

describe("the land's clipmap", () => {
  it("holds in each level the land's own samples on that level's grid, as the rings read them", () => {
    const ground = createGroundTexture(terrain);
    for (let k = 0; k < CLIP.levels; k++) for (const [x, z] of gridPoints(k)) expect(heightsAt(ground, k, x, z)).toEqual(sample(x, z));
  });

  it("holds in each level the bake's own cover taps for each sample on that level's grid", () => {
    const ground = createGroundTexture(terrain);
    for (let k = 0; k < CLIP.levels; k++) {
      for (const [x, z] of gridPoints(k)) {
        expect(regionsAt(ground, k, x, z)).toEqual(taps(terrain.coverRegions, x, z));
        expect(sharesAt(ground, k, x, z)).toEqual(taps(terrain.coverShares, x, z));
      }
    }
  });

  it("holds near the person the ways each sample lies on as the bake finds them, and names a way all around every tread on the coarse levels", () => {
    const ground = createGroundTexture(terrain);
    ground.update(terrain, undefined, network.ways);
    const bake = (x: number, z: number): number[] => Array.from(places.subarray(indexOf(x, z) * 2, indexOf(x, z) * 2 + 2));
    let read = 0;
    // The levels whose cells fit within the bake's reach hold its own places, on the tread and off it.
    for (const k of [0, 1]) {
      for (const [x, z] of treadPoints(ground, k)) {
        for (const [dx, dz] of [[0, 0], [3, 0], [0, -5], [9, 9]] as const) {
          const unit = spacing * 2 ** k;
          const [sx, sz] = [x + dx * unit, z + dz * unit];
          if (!holds(ground, k, sx, sz)) continue;
          expect(placesAt(ground, k, sx, sz)).toEqual(bake(sx, sz));
          read++;
        }
      }
    }
    // A coarser level names a way at each corner of its cell around a tread, unless the water covers it,
    // so a far trail reads as worn as from every sample.
    for (let k = 2; k < CLIP.levels; k++) {
      const unit = spacing * 2 ** k;
      for (const way of network.ways) {
        for (let p = 0; p < way.points.length / 2; p += 7) {
          const px = way.points[p * 2] as number;
          const pz = way.points[p * 2 + 1] as number;
          for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
            const x = (Math.floor(px / unit) + cx) * unit;
            const z = (Math.floor(pz / unit) + cz) * unit;
            if (!holds(ground, k, x, z) || (terrain.waterLevel[indexOf(x, z)] as number) > DRY / 2) continue;
            expect(placesAt(ground, k, x, z)[0], `level ${k} names a way at (${x}, ${z})`).toBeGreaterThanOrEqual(0);
            read++;
          }
        }
      }
    }
    expect(read).toBeGreaterThan(100);
  });

  it("lays its levels again around a person who has walked away, still with the land's own samples, covers and ways", () => {
    const ground = createGroundTexture(terrain);
    ground.update(terrain, undefined, network.ways);
    const before = (ground.uniforms.uClipOrigin.value[0] as { x: number }).x;
    // To a point on a tread far enough that level 0 is laid at once; then level 0 reads the land as it is there.
    let [wx, wz] = [0, 0];
    for (const way of network.ways) {
      for (let p = 0; p < way.points.length / 2; p++) {
        const [x, z] = [Math.round(way.points[p * 2] as number), Math.round(way.points[p * 2 + 1] as number)];
        if (Math.hypot(x, z) > Math.hypot(wx, wz) && Math.max(Math.abs(x), Math.abs(z)) < 450) [wx, wz] = [x, z];
      }
    }
    expect(Math.hypot(wx, wz)).toBeGreaterThan(CLIP.urgent * 2);
    ground.follow(wx, wz);
    expect((ground.uniforms.uClipOrigin.value[0] as { x: number }).x).not.toBe(before);
    for (const [x, z] of [[wx, wz], [wx + 30, wz + 40], [wx - 50, wz - 50]] as const) {
      expect(heightsAt(ground, 0, x, z)).toEqual(sample(x, z));
      expect(regionsAt(ground, 0, x, z)).toEqual(taps(terrain.coverRegions, x, z));
      expect(sharesAt(ground, 0, x, z)).toEqual(taps(terrain.coverShares, x, z));
      expect(placesAt(ground, 0, x, z)).toEqual(Array.from(places.subarray(indexOf(x, z) * 2, indexOf(x, z) * 2 + 2)));
    }
    expect(placesAt(ground, 0, wx, wz)[0]).toBeGreaterThanOrEqual(0);
  });
});
