// Bakes the land one tile at a time with every placement's edits applied:
// the plan's fitted ground (`bakeTile`), then the buildings' pads, the
// landmarks' footprints and the trails' treads, then the trail fields. Each
// sample depends only on its own position, so a tile baked alone has the same
// bytes as the whole world's land, and a page can drop a tile and bake it
// again when the person returns.

import { type Lattice, worldOf, worldOfZ } from "./lattice.ts";
import { type PadEdit, applyPad } from "./site.ts";
import { type DiscEdit, applyDisc } from "./landmarks.ts";
import { TRAILS, type Way, type WayEdit, applyWay, trailField, trailPlaces } from "./paths.ts";
import { nearPond, shoreField, shoreMargin } from "./water.ts";
import { TILE, type Terrain, type TerrainPlan, type TerrainTile, bakeTile, frameOf } from "./world.ts";

/** The edits that placing a world's things made to its land, in order: each building's pad, each landmark's footprint, then each way's tread. */
export interface LandEdits {
  readonly pads: readonly PadEdit[];
  readonly discs: readonly DiscEdit[];
  readonly ways: readonly WayEdit[];
}

/** A tile of the land with its edits applied and the trail fields measured over it. */
export interface EditedTile extends TerrainTile {
  /** Each sample's signed distance to the nearest way's edge (`trailField`). */
  readonly trailField: Float32Array;
  /** Which ways each sample lies on and how far along them (`trailPlaces`), two per sample. */
  readonly trailPlaces: Float32Array;
}

/** A tile as its own lattice, positioned where its samples lie in the world's lattice. */
export function tileLattice(plan: TerrainPlan, tile: TerrainTile): Lattice {
  const world = frameOf(plan.spec);
  return { n: tile.n, spacing: world.spacing * tile.stride, origin: worldOf(world, tile.x0), originZ: worldOfZ(world, tile.z0), heights: tile.heights };
}

/**
 * Bakes tile (`x0`, `z0`) from `plan` alone, applies `edits` in order, and
 * measures the trail fields against `ways`. The result has the same bytes as
 * the whole world's land and trail fields there. With a `stride`, it takes
 * every stride-th sample, as a coarser level of the land, and differs only
 * where the shore, measured between its own samples, differs. Its trail
 * places include ways out to `placeReach` past their edge.
 */
export function bakeEditedTile(plan: TerrainPlan, edits: LandEdits, ways: readonly Way[], x0: number, z0: number, size: number = TILE.size, stride = 1, placeReach: number = TRAILS.reach): EditedTile {
  const tile = bakeTile(plan, x0, z0, size, stride);
  const land = { lattice: tileLattice(plan, tile), waterLevel: tile.waterLevel, shore: tile.shore };
  for (const pad of edits.pads) applyPad(land.lattice, pad);
  for (const disc of edits.discs) applyDisc(land.lattice, disc);
  for (const way of edits.ways) applyWay(land, way);
  return { ...tile, trailField: trailField(land, ways), trailPlaces: trailPlaces(land, ways, placeReach) };
}

/**
 * Cuts tile (`x0`, `z0`) from `t`, a whole world's land with its edits
 * applied, matching what `bakeEditedTile` bakes from the plan. It takes every
 * stride-th sample, measures a coarser tile's shore between its own samples,
 * and measures the trail fields with places reaching `placeReach`. A bake
 * that still holds its whole world returns a tile at once this way, where
 * baking it alone would compose it again.
 */
export function cutTile(t: Terrain, ways: readonly Way[], x0: number, z0: number, size: number, stride = 1, placeReach: number = TRAILS.reach): EditedTile {
  const l = t.lattice;
  const m = stride === 1 ? 0 : shoreMargin(l.spacing * stride);
  const side = size + 2 * m;
  const clamp = (i: number): number => Math.max(0, Math.min(l.n - 1, i));
  const cols = Int32Array.from({ length: side }, (_, i) => clamp(x0 + (i - m) * stride));
  const rows = Int32Array.from({ length: side }, (_, j) => clamp(z0 + (j - m) * stride));
  const heights = new Float32Array(side * side);
  const waterLevel = new Float32Array(side * side);
  for (let j = 0; j < side; j++) {
    const r = (rows[j] as number) * l.n;
    for (let i = 0; i < side; i++) {
      const w = r + (cols[i] as number);
      heights[j * side + i] = l.heights[w] as number;
      waterLevel[j * side + i] = t.waterLevel[w] as number;
    }
  }
  // A coarser tile measures its shore between its own samples, as its bake does. A full-resolution tile copies the world's.
  const coarse = { n: side, spacing: l.spacing * stride, origin: worldOf(l, x0 - m * stride), originZ: worldOfZ(l, z0 - m * stride), heights };
  const coarseShore = stride === 1 ? null : shoreField(coarse, heights, waterLevel);
  const coarsePond = coarseShore === null ? null : nearPond(coarse, heights, waterLevel, t.ponds, coarseShore);
  const count = size * size;
  const out = {
    heights: new Float32Array(count),
    waterLevel: new Float32Array(count),
    shore: new Float32Array(count),
    nearPond: new Uint8Array(count),
    region: new Uint8Array(count),
    coverRegions: new Uint8Array(count * 4),
    coverShares: new Uint8Array(count * 4),
  };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      const s = (j + m) * side + i + m;
      const w = (rows[j + m] as number) * l.n + (cols[i + m] as number);
      out.heights[k] = heights[s] as number;
      out.waterLevel[k] = waterLevel[s] as number;
      out.shore[k] = coarseShore === null ? (t.shore[w] as number) : (coarseShore[s] as number);
      out.nearPond[k] = coarsePond === null ? (t.nearPond[w] as number) : (coarsePond[s] as number);
      out.region[k] = t.region[w] as number;
      out.coverRegions.set(t.coverRegions.subarray(w * 4, w * 4 + 4), k * 4);
      out.coverShares.set(t.coverShares.subarray(w * 4, w * 4 + 4), k * 4);
    }
  }
  const lattice: Lattice = { n: size, spacing: l.spacing * stride, origin: worldOf(l, x0), originZ: worldOfZ(l, z0), heights: out.heights };
  const land = { lattice, waterLevel: out.waterLevel, shore: out.shore };
  return { x0, z0, n: size, stride, ...out, trailField: trailField(land, ways), trailPlaces: trailPlaces(land, ways, placeReach) };
}
