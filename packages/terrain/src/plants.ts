// How plants meet the ground. A trunk's base, a rock or a bush sits at the
// lowest ground under its footprint, so on a slope the downhill side touches
// the soil and the uphill side is buried, never floating.

import { type Lattice, heightAt } from "./lattice.ts";
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
  return lowestUnder(l, x, z, radius) - PLANT_SINK;
}

/** Points on the footprint: its center and three rings. */
function footprint(x: number, z: number, radius: number): [number, number][] {
  const out: [number, number][] = [[x, z]];
  for (const ring of [0.35, 0.7, 1]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + ring;
      out.push([x + Math.cos(a) * radius * ring, z + Math.sin(a) * radius * ring]);
    }
  }
  return out;
}

/** The lowest ground under a footprint. */
export function lowestUnder(l: Lattice, x: number, z: number, radius: number): number {
  let low = Infinity;
  for (const [px, pz] of footprint(x, z, radius)) low = Math.min(low, heightAt(l, px, pz));
  return low;
}

export function isWet(t: Terrain, x: number, z: number, clearance = WATER_CLEARANCE): boolean {
  for (let k = 0; k < 9; k++) {
    const a = (k / 8) * Math.PI * 2;
    const r = k === 8 ? 0 : clearance;
    if (heightAt(t.lattice, x + Math.cos(a) * r, z + Math.sin(a) * r, t.waterLevel) > DRY / 2) return true;
  }
  return false;
}
