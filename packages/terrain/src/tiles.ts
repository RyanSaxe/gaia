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
import { type Way, type WayEdit, applyWay, trailField, trailPlaces } from "./paths.ts";
import { TILE, type TerrainPlan, type TerrainTile, bakeTile, latticeOf } from "./world.ts";

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
  const world = latticeOf(plan.spec);
  return { n: tile.n, spacing: world.spacing, origin: worldOf(world, tile.x0), originZ: worldOfZ(world, tile.z0), heights: tile.heights };
}

/**
 * Bakes tile (`x0`, `z0`) from `plan` alone and does `edits` to it, in order,
 * then measures it against `ways`: the same bytes as the whole world's land
 * and its trail fields hold there once its things stand.
 */
export function standTile(plan: TerrainPlan, edits: LandEdits, ways: readonly Way[], x0: number, z0: number, size: number = TILE.size): StoodTile {
  const tile = bakeTile(plan, x0, z0, size);
  const land = { lattice: tileLattice(plan, tile), waterLevel: tile.waterLevel, shore: tile.shore };
  for (const pad of edits.pads) applyPad(land.lattice, pad);
  for (const disc of edits.discs) applyDisc(land.lattice, disc);
  for (const way of edits.ways) applyWay(land, way);
  return { ...tile, trailField: trailField(land, ways), trailPlaces: trailPlaces(land, ways) };
}
