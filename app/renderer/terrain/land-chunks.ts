// The land in chunks, as the land workers bake it for the page: a square of
// one level of the land around the person (`land.ts`), from the world's plan
// and what standing its things did to it, and nothing else. Level k holds
// every 2^k-th sample of the world's lattice, so a chunk of level 0 holds the
// stood land's own samples and a coarser chunk the same samples farther apart
// (`standTile`). No Three.js and no DOM: a worker runs it.

import { DRY, type LandEdits, SHORE_CAP, type StoodTile, TRAILS, type Terrain, type TerrainPlan, type Way, cutTile, frameOf, standTile } from "@gaia/terrain";

/** What a land worker needs to bake any chunk of a world: its plan, what standing did to it, and its ways. */
export interface LandSource {
  readonly plan: TerrainPlan;
  readonly edits: LandEdits;
  readonly ways: readonly Way[];
}

/** Samples a side of a chunk; every level's window is a whole number of them. */
export const CHUNK = 64;

/**
 * How far past its edge a way names the samples of level k, `spacing`
 * meters apart at level 0. The shaders read a way's wear only within 2 m of
 * its edge (`edge < 2.0`), from the corners of the level's cell around the
 * point, which lie up to a cell's diagonal away. So a coarse level names the
 * way that far out, with a meter to spare, and a far trail reads as worn as
 * it does from every sample. Levels whose cells fit within `TRAILS.reach`
 * hold the places `trailPlaces` gives.
 */
export const placeReach = (k: number, spacing: number): number => Math.max(TRAILS.reach, 3 + 2 ** k * spacing * Math.SQRT2);

/** One chunk of level `k`: its samples (cx · CHUNK, cz · CHUNK) on in that level's grid, row by row. */
export interface Chunk {
  readonly k: number;
  readonly cx: number;
  readonly cz: number;
  /** Height, water level, distance to the water and signed distance to a trail's edge per sample, four floats each: the ground texture's layout. */
  readonly ground: Float32Array;
  readonly region: Uint8Array;
  readonly coverRegions: Uint8Array;
  readonly coverShares: Uint8Array;
  /** Which ways each sample lies on and how far along them (`trailPlaces`), two per sample. */
  readonly trailPlaces: Float32Array;
}

/** The world lattice's column (or row) that level `k`'s grid point `u` holds: where the ground texture has always taken it. */
export function latticeIndex(frame: { readonly origin: number; readonly spacing: number }, k: number, u: number): number {
  return u * 2 ** k + Math.round(-frame.origin / frame.spacing);
}

/** Whether every sample of chunk (cx, cz) of level `k` lies past the world's lattice, where only the wild land is. */
export function chunkPastLand(plan: TerrainPlan, k: number, cx: number, cz: number): boolean {
  const frame = frameOf(plan.spec);
  const past = (c: number): boolean => {
    const first = latticeIndex(frame, k, c * CHUNK);
    const last = latticeIndex(frame, k, c * CHUNK + CHUNK - 1);
    return last < 0 || first > frame.n - 1;
  };
  return past(cx) || past(cz);
}

/** A chunk past the land: no water, no trails, level with the land's mean. Nothing reads the land there; the wild land is drawn instead. */
export function emptyChunk(plan: TerrainPlan, k: number, cx: number, cz: number): Chunk {
  const count = CHUNK * CHUNK;
  const ground = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) ground.set([plan.mean, DRY, SHORE_CAP, TRAILS.reach], i * 4);
  const shares = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) shares[i * 4] = 255;
  return { k, cx, cz, ground, region: new Uint8Array(count), coverRegions: new Uint8Array(count * 4), coverShares: shares, trailPlaces: new Float32Array(count * 2).fill(-1) };
}

/** A stood tile of a chunk's samples, packed as the chunk carries them. */
function chunkOf(k: number, cx: number, cz: number, tile: StoodTile): Chunk {
  const count = CHUNK * CHUNK;
  const ground = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    ground[i * 4] = tile.heights[i] as number;
    ground[i * 4 + 1] = tile.waterLevel[i] as number;
    ground[i * 4 + 2] = tile.shore[i] as number;
    ground[i * 4 + 3] = tile.trailField[i] as number;
  }
  return { k, cx, cz, ground, region: tile.region, coverRegions: tile.coverRegions, coverShares: tile.coverShares, trailPlaces: tile.trailPlaces };
}

/** Bakes chunk (cx, cz) of level `k` from `source` alone: the stood land's samples there. */
export function standChunk(source: LandSource, k: number, cx: number, cz: number): Chunk {
  const { plan } = source;
  if (chunkPastLand(plan, k, cx, cz)) return emptyChunk(plan, k, cx, cz);
  const frame = frameOf(plan.spec);
  return chunkOf(k, cx, cz, standTile(plan, source.edits, source.ways, latticeIndex(frame, k, cx * CHUNK), latticeIndex(frame, k, cz * CHUNK), CHUNK, 2 ** k, placeReach(k, frame.spacing)));
}

/** Chunk (cx, cz) of level `k` cut from `whole`, a world's whole stood land, which a bake still holds: what `standChunk` bakes there. */
export function cutChunk(whole: Terrain, source: LandSource, k: number, cx: number, cz: number): Chunk {
  const { plan } = source;
  if (chunkPastLand(plan, k, cx, cz)) return emptyChunk(plan, k, cx, cz);
  const frame = frameOf(plan.spec);
  return chunkOf(k, cx, cz, cutTile(whole, source.ways, latticeIndex(frame, k, cx * CHUNK), latticeIndex(frame, k, cz * CHUNK), CHUNK, 2 ** k, placeReach(k, frame.spacing)));
}

/** The buffers a chunk carries between threads. */
export const chunkBuffers = (c: Chunk): ArrayBuffer[] => [c.ground.buffer, c.region.buffer, c.coverRegions.buffer, c.coverShares.buffer, c.trailPlaces.buffer] as ArrayBuffer[];
