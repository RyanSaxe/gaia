// Bakes the land in chunks for the page's clipmap (`land.ts`). A chunk is a
// square of one level, baked from the world's plan and its leveling edits
// alone. Level k has every 2^k-th lattice sample, so a level 0 chunk has the
// leveled land's own samples and a coarser chunk the same samples farther
// apart (`bakeEditedTile`). It uses no Three.js or DOM, because a worker runs it.

import { DRY, type LandEdits, SHORE_CAP, type EditedTile, TRAILS, type Terrain, type TerrainPlan, type Way, cutTile, frameOf, bakeEditedTile } from "@gaia/terrain";

/** What a land worker needs to bake any chunk of a world: its plan, its leveling edits and its ways. */
export interface LandSource {
  readonly plan: TerrainPlan;
  readonly edits: LandEdits;
  readonly ways: readonly Way[];
}

/** Samples per side of a chunk. Every level's window is a whole number of chunks. */
export const CHUNK = 64;

/**
 * How far past its edge, in meters, a way is recorded in the samples of
 * level k, with `spacing` meters between level 0 samples. The shaders read a
 * way's wear only within 2 m of its edge (`edge < 2.0`), from the corners of
 * the level's cell around the point, which can be a cell's diagonal away. So
 * a coarse level records the way that far out, with a meter to spare, and a
 * far trail looks as worn as it does from every sample. Levels whose cells
 * fit within `TRAILS.reach` use the places `trailPlaces` gives.
 */
export const placeReach = (k: number, spacing: number): number => Math.max(TRAILS.reach, 3 + 2 ** k * spacing * Math.SQRT2);

/** One chunk of level `k`: its samples from (cx · CHUNK, cz · CHUNK) onward in that level's grid, row by row. */
export interface Chunk {
  readonly k: number;
  readonly cx: number;
  readonly cz: number;
  /** Height, water level, distance to the water and signed distance to a trail's edge per sample, four floats each: the ground texture's layout. */
  readonly ground: Float32Array;
  readonly region: Uint8Array;
  /** 1 where a sample's nearest water is a pond (`nearPond`), one byte each. */
  readonly nearPond: Uint8Array;
  readonly coverRegions: Uint8Array;
  readonly coverShares: Uint8Array;
  /** Which ways each sample lies on and how far along them (`trailPlaces`), two per sample. */
  readonly trailPlaces: Float32Array;
}

/** The world lattice column or row that level `k`'s grid point `u` samples, matching where the ground texture reads it. */
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

/** A chunk past the land: no water, no trails, level with the land's mean. Nothing reads the land there, since the wild land is drawn instead. */
export function emptyChunk(plan: TerrainPlan, k: number, cx: number, cz: number): Chunk {
  const count = CHUNK * CHUNK;
  const ground = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) ground.set([plan.mean, DRY, SHORE_CAP, TRAILS.reach], i * 4);
  const shares = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) shares[i * 4] = 255;
  return { k, cx, cz, ground, region: new Uint8Array(count), nearPond: new Uint8Array(count), coverRegions: new Uint8Array(count * 4), coverShares: shares, trailPlaces: new Float32Array(count * 2).fill(-1) };
}

/** Packs a leveled tile of a chunk's samples into a `Chunk`. */
function chunkOf(k: number, cx: number, cz: number, tile: EditedTile): Chunk {
  const count = CHUNK * CHUNK;
  const ground = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    ground[i * 4] = tile.heights[i] as number;
    ground[i * 4 + 1] = tile.waterLevel[i] as number;
    ground[i * 4 + 2] = tile.shore[i] as number;
    ground[i * 4 + 3] = tile.trailField[i] as number;
  }
  return { k, cx, cz, ground, region: tile.region, nearPond: tile.nearPond, coverRegions: tile.coverRegions, coverShares: tile.coverShares, trailPlaces: tile.trailPlaces };
}

/** Bakes chunk (cx, cz) of level `k` from `source` alone, giving the leveled land's samples there. */
export function bakeChunk(source: LandSource, k: number, cx: number, cz: number): Chunk {
  const { plan } = source;
  if (chunkPastLand(plan, k, cx, cz)) return emptyChunk(plan, k, cx, cz);
  const frame = frameOf(plan.spec);
  return chunkOf(k, cx, cz, bakeEditedTile(plan, source.edits, source.ways, latticeIndex(frame, k, cx * CHUNK), latticeIndex(frame, k, cz * CHUNK), CHUNK, 2 ** k, placeReach(k, frame.spacing)));
}

/** Cuts chunk (cx, cz) of level `k` from `whole`, a world's whole leveled land that a bake still has. It equals what `bakeChunk` bakes there. */
export function cutChunk(whole: Terrain, source: LandSource, k: number, cx: number, cz: number): Chunk {
  const { plan } = source;
  if (chunkPastLand(plan, k, cx, cz)) return emptyChunk(plan, k, cx, cz);
  const frame = frameOf(plan.spec);
  return chunkOf(k, cx, cz, cutTile(whole, source.ways, latticeIndex(frame, k, cx * CHUNK), latticeIndex(frame, k, cz * CHUNK), CHUNK, 2 ** k, placeReach(k, frame.spacing)));
}

/** The buffers a chunk carries between threads. */
export const chunkBuffers = (c: Chunk): ArrayBuffer[] => [c.ground.buffer, c.region.buffer, c.nearPond.buffer, c.coverRegions.buffer, c.coverShares.buffer, c.trailPlaces.buffer] as ArrayBuffer[];
