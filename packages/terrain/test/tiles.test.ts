import { describe, expect, it } from "vitest";
import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { COVER_TAPS, type OwnedSite, type Terrain, type TerrainPlan, bakeTerrain, bakeTile, composeRows, finishTerrain, landformsOf, latticeOf, ownershipGrid, ownershipOf, ownershipRows, planOf } from "@gaia/terrain";
import { randomWorld, sampleWorld } from "@gaia/terrain/testing";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
// Baked once for the file: the sample world and two random draws, each whole, with the plan the app reads from the
// whole bake to bake a tile alone.
const worlds = [sampleWorld(), randomWorld(lib, 7003), randomWorld(lib, 7011)].map((spec) => {
  const whole = bakeTerrain(spec, lib);
  return { whole, plan: planOf(whole) };
});
/** Small tiles, so a test covers many edges between them cheaply. */
const SIZE = 64;

const bytes = (a: ArrayBufferView): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

/** The tiles worth checking: each corner of the land, every tile water runs through or lies in, and their neighbors, whose shore reaches across the edge. */
function tilesOf(t: Terrain): [number, number][] {
  const { n, origin, spacing } = t.lattice;
  const last = Math.floor((n - 1) / SIZE) * SIZE;
  const at = new Map<string, [number, number]>();
  const add = (x: number, z: number): void => {
    const cx = Math.floor((x - origin) / spacing / SIZE) * SIZE;
    const cz = Math.floor((z - origin) / spacing / SIZE) * SIZE;
    for (const ix of [cx - SIZE, cx, cx + SIZE]) {
      for (const iz of [cz - SIZE, cz, cz + SIZE]) if (ix >= 0 && iz >= 0 && ix < n && iz < n) at.set(`${ix},${iz}`, [ix, iz]);
    }
  };
  for (const [ix, iz] of [[0, 0], [last, 0], [0, last], [last, last]] as const) at.set(`${ix},${iz}`, [ix, iz]);
  for (const s of t.streams) for (const st of s.stations) add(st.x, st.z);
  for (const p of t.ponds) add(p.x, p.z);
  return [...at.values()];
}

/** Whether tile (x0, z0) of `plan`, baked alone, holds the same bytes as `whole` at every sample both have. */
function sameAsWhole(plan: TerrainPlan, whole: Terrain, x0: number, z0: number): void {
  const tile = bakeTile(plan, x0, z0, SIZE);
  const { n } = whole.lattice;
  const width = Math.min(SIZE, n - x0);
  const rows = Math.min(SIZE, n - z0);
  for (let j = 0; j < rows; j++) {
    const w = (z0 + j) * n + x0;
    const t = j * SIZE;
    const row = (a: ArrayBufferView & { subarray(b: number, e: number): ArrayBufferView }, b: ArrayBufferView & { subarray(b: number, e: number): ArrayBufferView }, per: number, what: string): void => {
      expect(bytes(b.subarray(t * per, (t + width) * per)).equals(bytes(a.subarray(w * per, (w + width) * per))), `${what}, tile (${x0}, ${z0}), row ${j}`).toBe(true);
    };
    row(whole.lattice.heights, tile.heights, 1, "heights");
    row(whole.waterLevel, tile.waterLevel, 1, "water");
    row(whole.shore, tile.shore, 1, "shore");
    row(whole.region, tile.region, 1, "region");
    row(whole.coverRegions, tile.coverRegions, COVER_TAPS, "cover regions");
    row(whole.coverShares, tile.coverShares, COVER_TAPS, "cover shares");
  }
}

describe("land baked in tiles", () => {
  it("bakes each tile alone, and the world and its ground's owners in bands on any number of threads, sample for sample as a bake of the whole world holds them", () => {
    let water = 0;
    for (const { whole, plan } of worlds) {
      water += whole.streams.length + whole.ponds.length;
      for (const [x0, z0] of tilesOf(whole)) sameAsWhole(plan, whole, x0, z0);
    }
    // The worlds checked have water, so the tiles must cut it too.
    expect(water).toBeGreaterThan(2);
    // Bands composed apart, in any order, finish into the same world.
    const { whole } = worlds[0]!;
    const w = whole.spec;
    const landforms = landformsOf(w, lib);
    const { n } = latticeOf(w);
    const cuts = [0, 97, 98, 250, n];
    const banded = finishTerrain(w, landforms, cuts.slice(1).map((z1, i) => composeRows(w, landforms, cuts[i]!, z1)).reverse());
    for (const key of ["waterLevel", "shore", "region", "coverRegions", "coverShares"] as const) expect(bytes(banded[key]).equals(bytes(whole[key])), key).toBe(true);
    expect(bytes(banded.lattice.heights).equals(bytes(whole.lattice.heights))).toBe(true);
    expect(banded.streams).toEqual(whole.streams);
    // Who owns the ground, computed in rows apart as the bake's threads do, is who owns it computed whole.
    const size = 300;
    const sites: OwnedSite[] = [];
    for (let x = -144; x <= 144; x += 16) for (let z = -144; z <= 144; z += 16) sites.push({ x, z, owner: Math.hypot(x + 72, z) < 20 ? 2 : x < 0 ? 0 : 1 });
    const own = ownershipOf(sites, { size }, size + 80);
    const grid = ownershipGrid(size + 80);
    const top = ownershipRows(sites, { size }, grid, 0, 40);
    const rest = ownershipRows(sites, { size }, grid, 40, grid.n);
    expect([...top.owners, ...rest.owners]).toEqual([...own.owners]);
    expect([...top.shares, ...rest.shares]).toEqual([...own.shares]);
    // Composes a few dozen small tiles with their margins, and a world in bands. It takes a few seconds alone, and has
    // taken over twenty when the whole suite shares a busy machine.
  }, 60_000);
});
