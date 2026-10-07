// Where plants may stand and how they meet the ground. A trunk's base sits at
// the lowest ground under its footprint, so on a slope the downhill side
// touches the soil and the uphill side is buried, never floating.

import { rand } from "@gaia/schema";
import { type Lattice, heightAt, slopeAt } from "./lattice.ts";
import { DRY, type Terrain } from "./world.ts";

/** Plants stand only on ground gentler than this, degrees. */
export const PLANT_SLOPE = 24;
/** And at least this far from any water, meters. */
const WATER_CLEARANCE = 4;

/**
 * How far below the lowest ground a plant's origin sits. A trunk leans a
 * little, so its bottom ring rises up to about 8 cm on one side.
 */
export const PLANT_SINK = 0.12;

/** The height a plant's origin takes at (x, z), for a trunk base of `radius` meters. */
export function groundedBase(l: Lattice, x: number, z: number, radius: number): number {
  let low = heightAt(l, x, z);
  for (let ring = 0.5; ring <= 1; ring += 0.5) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      low = Math.min(low, heightAt(l, x + Math.cos(a) * radius * ring, z + Math.sin(a) * radius * ring));
    }
  }
  return low - PLANT_SINK;
}

export function isWet(t: Terrain, x: number, z: number, clearance = WATER_CLEARANCE): boolean {
  for (let k = 0; k < 9; k++) {
    const a = (k / 8) * Math.PI * 2;
    const r = k === 8 ? 0 : clearance;
    if (heightAt(t.lattice, x + Math.cos(a) * r, z + Math.sin(a) * r, t.waterLevel) > DRY / 2) return true;
  }
  return false;
}

export interface Spot {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly region: number;
}

/** Seeded plant spots in small groves: dry, gentle ground inside the walkable square. */
export function scatterPlants(t: Terrain, count: number, seed: number, trunkRadius = 0.7): Spot[] {
  const r = rand(seed);
  const half = t.spec.size / 2 - 24;
  const spots: Spot[] = [];
  const minGap = 7;
  let tries = 0;
  while (spots.length < count && tries < count * 200) {
    tries++;
    // Groves: most plants start near an earlier one.
    const anchor = spots.length > 0 && r.next() < 0.6 ? spots[Math.floor(r.next() * spots.length)] : undefined;
    const x = anchor === undefined ? r.range(-half, half) : anchor.x + r.range(-14, 14);
    const z = anchor === undefined ? r.range(-half, half) : anchor.z + r.range(-14, 14);
    if (Math.abs(x) > half || Math.abs(z) > half) continue;
    if (slopeAt(t.lattice, x, z) > PLANT_SLOPE) continue;
    if (isWet(t, x, z)) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < minGap)) continue;
    const l = t.lattice;
    const ix = Math.round((x - l.origin) / l.spacing);
    const iz = Math.round((z - l.origin) / l.spacing);
    spots.push({ x, z, y: groundedBase(l, x, z, trunkRadius), region: t.region[iz * l.n + ix] ?? 0 });
  }
  return spots;
}
