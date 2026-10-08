// How land divides into cells. A point belongs to the site nearest to it,
// measured from the point moved by a gentle domain warp and less each site's
// reach, so cells are organic: their borders curve and wander instead of
// running straight. One rule serves the terrain's regions (whose landforms
// and covers change where their cells meet), `placeAt`, and the layout of a
// world from code, so an area's land, its cover and its name always agree.

import { fbm } from "@gaia/primitives";

/** One site of a division of the land; a larger `reach` claims more ground before a neighbor's begins. */
export interface LandSite {
  readonly x: number;
  readonly z: number;
  readonly reach?: number;
}

/**
 * How far cell borders wander from straight lines, meters, and over what
 * wavelength: a broad sway that bends a region's whole side, and a fine one
 * that makes a small cell's edge wander like a field's.
 */
export const LAND_WARP = { amount: 34, wavelength: 150, fine: 5, fineWavelength: 34 } as const;

const WARP_SEEDS = [5101, 5203, 5309, 5407] as const;

/** A point moved by the domain warp that makes cell borders curve and wander. */
export function warpPoint(x: number, z: number): [number, number] {
  const u = x / LAND_WARP.wavelength;
  const v = z / LAND_WARP.wavelength;
  const fu = x / LAND_WARP.fineWavelength;
  const fv = z / LAND_WARP.fineWavelength;
  return [
    x + LAND_WARP.amount * fbm(WARP_SEEDS[0], u, v, 2, 0.4) + LAND_WARP.fine * fbm(WARP_SEEDS[2], fu, fv, 2, 0.5),
    z + LAND_WARP.amount * fbm(WARP_SEEDS[1], u, v, 2, 0.4) + LAND_WARP.fine * fbm(WARP_SEEDS[3], fu, fv, 2, 0.5),
  ];
}

/** Side of a lookup cell, meters. */
const CELL = 16;
/** How far past its outermost sites a lookup grid reaches, meters; beyond it a lookup reads every site. */
const MARGIN = 220;

interface Grid {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  /** Per lookup cell, where its candidates start in `ids` (and end at the next cell's start). */
  readonly starts: Int32Array;
  readonly ids: Int32Array;
}

const grids = new WeakMap<readonly LandSite[], Grid>();

/** Per lookup cell, the sites that could be nearest somewhere in it. */
function gridOf(sites: readonly LandSite[]): Grid {
  const had = grids.get(sites);
  if (had !== undefined) return had;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let maxReach = 0;
  for (const s of sites) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
    maxReach = Math.max(maxReach, Math.abs(s.reach ?? 0));
  }
  const x0 = minX - MARGIN;
  const z0 = minZ - MARGIN;
  const nx = Math.max(1, Math.ceil((maxX + MARGIN - x0) / CELL));
  const nz = Math.max(1, Math.ceil((maxZ + MARGIN - z0) / CELL));
  // Sites bucketed by lookup cell, so each cell reads only the sites around it.
  const bucket: number[][] = Array.from({ length: nx * nz }, () => []);
  sites.forEach((s, k) => (bucket[Math.floor((s.z - z0) / CELL) * nx + Math.floor((s.x - x0) / CELL)] as number[]).push(k));
  const starts = new Int32Array(nx * nz + 1);
  const ids: number[] = [];
  const near: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const ax = x0 + i * CELL;
      const az = z0 + j * CELL;
      const lo = (s: LandSite): number => Math.hypot(Math.max(ax - s.x, 0, s.x - ax - CELL), Math.max(az - s.z, 0, s.z - az - CELL)) - (s.reach ?? 0);
      const hi = (s: LandSite): number => Math.hypot(Math.max(Math.abs(s.x - ax), Math.abs(s.x - ax - CELL)), Math.max(Math.abs(s.z - az), Math.abs(s.z - az - CELL))) - (s.reach ?? 0);
      // Grow a ring of buckets until it holds a site, then read every bucket that could hold a nearer one.
      let bestHi = Infinity;
      let ring = 0;
      const span = Math.max(nx, nz);
      for (; ring <= span && bestHi === Infinity; ring++) {
        for (let dj = -ring; dj <= ring; dj++) {
          for (let di = -ring; di <= ring; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
            for (const k of bucket[(j + dj) * nx + (i + di)] ?? []) if (i + di >= 0 && i + di < nx) bestHi = Math.min(bestHi, hi(sites[k] as LandSite));
          }
        }
      }
      const reachOut = Math.ceil((bestHi + 2 * maxReach) / CELL) + 1;
      near.length = 0;
      for (let dj = -reachOut; dj <= reachOut; dj++) {
        if (j + dj < 0 || j + dj >= nz) continue;
        for (let di = -reachOut; di <= reachOut; di++) {
          if (i + di < 0 || i + di >= nx) continue;
          for (const k of bucket[(j + dj) * nx + (i + di)] as number[]) near.push(k);
        }
      }
      for (const k of near) bestHi = Math.min(bestHi, hi(sites[k] as LandSite));
      starts[j * nx + i] = ids.length;
      near.sort((a, b) => a - b);
      for (const k of near) if (lo(sites[k] as LandSite) <= bestHi) ids.push(k);
    }
  }
  starts[nx * nz] = ids.length;
  const grid = { x0, z0, nx, nz, starts, ids: Int32Array.from(ids) };
  grids.set(sites, grid);
  return grid;
}

/** The site nearest to an already warped point (wx, wz), less its reach. Ties keep the lower index. */
export function nearestSite(sites: readonly LandSite[], wx: number, wz: number): number {
  const g = gridOf(sites);
  const i = Math.floor((wx - g.x0) / CELL);
  const j = Math.floor((wz - g.z0) / CELL);
  let best = 0;
  let nearest = Infinity;
  const visit = (k: number): void => {
    const s = sites[k] as LandSite;
    const d = Math.hypot(wx - s.x, wz - s.z) - (s.reach ?? 0);
    if (d < nearest || (d === nearest && k < best)) {
      nearest = d;
      best = k;
    }
  };
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) {
    for (let k = 0; k < sites.length; k++) visit(k);
    return best;
  }
  const c = j * g.nx + i;
  for (let n = g.starts[c] as number; n < (g.starts[c + 1] as number); n++) visit(g.ids[n] as number);
  return best;
}

/** Which site's cell holds (x, z): the nearest to the warped point, less its reach. */
export function siteAt(sites: readonly LandSite[], x: number, z: number): number {
  const [wx, wz] = warpPoint(x, z);
  return nearestSite(sites, wx, wz);
}
