// Where plants may stand and how they meet the ground. A trunk's base, a
// rock or a bush sits at the lowest ground under its footprint, so on a slope
// the downhill side touches the soil and the uphill side is buried, never
// floating; a drift of flowers lies on the ground's plane instead.

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

/**
 * The ground's plane under a footprint, fitted by least squares and then
 * lowered until it lies at or under the ground at every footprint point.
 */
export function groundPlane(l: Lattice, x: number, z: number, radius: number): { y: number; slope: [number, number] } {
  const pts = footprint(x, z, radius);
  let sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0, sh = 0;
  const hs = pts.map(([px, pz]) => heightAt(l, px, pz));
  pts.forEach(([px, pz], i) => {
    const dx = px - x;
    const dz = pz - z;
    const h = hs[i] as number;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
    sxh += dx * h;
    szh += dz * h;
    sh += h;
  });
  const det = sxx * szz - sxz * sxz;
  const gx = det > 1e-9 ? (sxh * szz - szh * sxz) / det : 0;
  const gz = det > 1e-9 ? (szh * sxx - sxh * sxz) / det : 0;
  let y = sh / pts.length;
  let over = 0;
  pts.forEach(([px, pz], i) => {
    over = Math.max(over, y + gx * (px - x) + gz * (pz - z) - (hs[i] as number));
  });
  y -= over;
  return { y, slope: [gx, gz] };
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
