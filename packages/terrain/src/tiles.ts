// The land a tile at a time, as the whole world holds it once its things
// stand: composed and fitted from the plan alone (`bakeTile`), then leveled
// under the buildings' pads, the landmarks' footings and the trails' treads
// exactly as standing the world leveled it, and measured against the ways.
// Every step is decided by each sample's own place, so a tile baked alone
// holds the same bytes as the whole world's land holds there, and a page can
// let a tile go and bake it again when the person comes back.

import { type Lattice, worldOf, worldOfZ } from "./lattice.ts";
import { type PadEdit, applyPad } from "./site.ts";
import { type DiscEdit, applyDisc } from "./landmarks.ts";
import { TRAILS, type Way, type WayEdit, applyWay, trailField, trailPlaces } from "./paths.ts";
import { SHORE_CAP, shoreField } from "./water.ts";
import { TILE, type Terrain, type TerrainPlan, type TerrainTile, bakeTile, frameOf } from "./world.ts";

/** What standing a world's things did to its land, in order: each building's pad, each landmark's footing, then each way's tread. */
export interface LandEdits {
  readonly pads: readonly PadEdit[];
  readonly discs: readonly DiscEdit[];
  readonly ways: readonly WayEdit[];
}

/** A tile of the land with its things' edits done, and the trails measured over it. */
export interface StoodTile extends TerrainTile {
  /** Each sample's signed distance to the nearest way's edge (`trailField`). */
  readonly trailField: Float32Array;
  /** Which ways each sample lies on and how far along them (`trailPlaces`), two per sample. */
  readonly trailPlaces: Float32Array;
}

/** A tile as a lattice of its own, its samples where the world's lattice holds them. */
export function tileLattice(plan: TerrainPlan, tile: TerrainTile): Lattice {
  const world = frameOf(plan.spec);
  return { n: tile.n, spacing: world.spacing * tile.stride, origin: worldOf(world, tile.x0), originZ: worldOfZ(world, tile.z0), heights: tile.heights };
}

/**
 * Bakes tile (`x0`, `z0`) from `plan` alone and does `edits` to it, in order,
 * then measures it against `ways`: the same bytes as the whole world's land
 * and its trail fields hold there once its things stand. With a `stride`, it
 * takes every stride-th sample, as a coarser level of the land: the same
 * except where the shore, measured between its own samples, differs. Its
 * trail places name a way out to `placeReach` past its edge.
 */
export function standTile(plan: TerrainPlan, edits: LandEdits, ways: readonly Way[], x0: number, z0: number, size: number = TILE.size, stride = 1, placeReach: number = TRAILS.reach): StoodTile {
  const tile = bakeTile(plan, x0, z0, size, stride);
  const land = { lattice: tileLattice(plan, tile), waterLevel: tile.waterLevel, shore: tile.shore };
  for (const pad of edits.pads) applyPad(land.lattice, pad);
  for (const disc of edits.discs) applyDisc(land.lattice, disc);
  for (const way of edits.ways) applyWay(land, way);
  return { ...tile, trailField: trailField(land, ways), trailPlaces: trailPlaces(land, ways, placeReach) };
}

/**
 * Tile (`x0`, `z0`) cut from `t`, a whole world's land with its things
 * stood, as `standTile` bakes it from the plan: every stride-th sample, the
 * shore of a coarser tile measured between its own samples, and the trails
 * measured over it, their places reaching `placeReach`. A bake that still
 * holds its whole world answers a tile at once this way, where baking it
 * alone would compose it again.
 */
export function cutTile(t: Terrain, ways: readonly Way[], x0: number, z0: number, size: number, stride = 1, placeReach: number = TRAILS.reach): StoodTile {
  const l = t.lattice;
  const m = stride === 1 ? 0 : Math.ceil(SHORE_CAP / (l.spacing * stride)) + 1;
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
  // A coarser tile measures its shore between its own samples, as its bake does; a tile of every sample takes the world's own.
  const coarseShore = stride === 1 ? null : shoreField({ n: side, spacing: l.spacing * stride, origin: 0, heights }, heights, waterLevel);
  const count = size * size;
  const out = {
    heights: new Float32Array(count),
    waterLevel: new Float32Array(count),
    shore: new Float32Array(count),
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
      out.region[k] = t.region[w] as number;
      out.coverRegions.set(t.coverRegions.subarray(w * 4, w * 4 + 4), k * 4);
      out.coverShares.set(t.coverShares.subarray(w * 4, w * 4 + 4), k * 4);
    }
  }
  const lattice: Lattice = { n: size, spacing: l.spacing * stride, origin: worldOf(l, x0), originZ: worldOfZ(l, z0), heights: out.heights };
  const land = { lattice, waterLevel: out.waterLevel, shore: out.shore };
  return { x0, z0, n: size, stride, ...out, trailField: trailField(land, ways), trailPlaces: trailPlaces(land, ways, placeReach) };
}
