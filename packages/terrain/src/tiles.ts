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
 * A stood tile as a `Terrain` of its own: the land a tile's things are stood
 * on, read as they read the whole world's land. Its relief report is empty:
 * only the whole world can measure that.
 */
export function tileTerrain(plan: TerrainPlan, tile: StoodTile): Terrain {
  return {
    spec: plan.spec,
    lattice: tileLattice(plan, tile),
    waterLevel: tile.waterLevel,
    shore: tile.shore,
    region: tile.region,
    coverRegions: tile.coverRegions,
    coverShares: tile.coverShares,
    streams: plan.streams,
    ponds: plan.ponds.map((p) => p.pond),
    fit: plan.fit,
    mean: plan.mean,
    pondDepths: plan.ponds.map((p) => p.depth),
    report: { min: 0, max: 0, range: 0, maxSlope: 0, walkShare: 1, maxStep: 0 },
    landforms: plan.landforms,
  };
}
