// Divides land into cells. A point belongs to the site with the least
// distance minus `reach`, measured from the point after a domain warp, so cell
// borders curve. Terrain regions, `placeAt` and the code world's layout all use
// this rule, so an area's land, its cover and its name agree.

import { fbm } from "@gaia/primitives";

/** One site of a land division. A larger `reach` claims more ground from its neighbors. */
export interface LandSite {
  readonly x: number;
  readonly z: number;
  readonly reach?: number;
}

/**
 * The domain warp's displacement and wavelength in meters. The broad warp
 * (`amount`, `wavelength`) bends a region's whole side, and the fine warp
 * (`fine`, `fineWavelength`) roughens a small cell's edge.
 */
export const LAND_WARP = { amount: 34, wavelength: 150, fine: 5, fineWavelength: 34 } as const;

const WARP_SEEDS = [5101, 5203, 5309, 5407] as const;

/** Returns (x, z) displaced by the `LAND_WARP` domain warp. */
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

/** Minimum side in meters of a lookup cell. Where sites are sparse, `gridOf` widens cells with the land's area per site. */
const CELL = 16;
/** Meters the lookup grid extends past the outermost sites. A lookup outside the grid reads every site. */
const MARGIN = 220;

interface Grid {
  readonly x0: number;
  readonly z0: number;
  /** Cell side in meters. */
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
  /** Per lookup cell, the index in `ids` where its candidates start. They end at the next cell's start. */
  readonly starts: Int32Array;
  readonly ids: Int32Array;
}

const grids = new WeakMap<readonly LandSite[], Grid>();

/** Builds and caches a grid that lists, per lookup cell, the sites that can be nearest somewhere in it. */
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
  // With few sites over a large land, cells widen with each site's share of the land. A 16 m cell there would search
  // rings of empty cells hundreds of meters out. Cell size changes only which sites a lookup reads.
  const cell = Math.max(CELL, Math.sqrt(((maxX - minX + 2 * MARGIN) * (maxZ - minZ + 2 * MARGIN)) / Math.max(1, sites.length)) / 2);
  const nx = Math.max(1, Math.ceil((maxX + MARGIN - x0) / cell));
  const nz = Math.max(1, Math.ceil((maxZ + MARGIN - z0) / cell));
  // Bucket the sites by lookup cell so each cell reads only nearby sites.
  const bucket: number[][] = Array.from({ length: nx * nz }, () => []);
  sites.forEach((s, k) => (bucket[Math.floor((s.z - z0) / cell) * nx + Math.floor((s.x - x0) / cell)] as number[]).push(k));
  const starts = new Int32Array(nx * nz + 1);
  const ids: number[] = [];
  const near: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const ax = x0 + i * cell;
      const az = z0 + j * cell;
      const lo = (s: LandSite): number => Math.hypot(Math.max(ax - s.x, 0, s.x - ax - cell), Math.max(az - s.z, 0, s.z - az - cell)) - (s.reach ?? 0);
      const hi = (s: LandSite): number => Math.hypot(Math.max(Math.abs(s.x - ax), Math.abs(s.x - ax - cell)), Math.max(Math.abs(s.z - az), Math.abs(s.z - az - cell))) - (s.reach ?? 0);
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
      const reachOut = Math.ceil((bestHi + 2 * maxReach) / cell) + 1;
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
  const grid = { x0, z0, cell, nx, nz, starts, ids: Int32Array.from(ids) };
  grids.set(sites, grid);
  return grid;
}

/** Index of the site with the least distance minus reach from an already warped point (wx, wz). Ties keep the lower index. */
export function nearestSite(sites: readonly LandSite[], wx: number, wz: number): number {
  const g = gridOf(sites);
  const i = Math.floor((wx - g.x0) / g.cell);
  const j = Math.floor((wz - g.z0) / g.cell);
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

/** Index of the site whose cell holds (x, z), measured from the warped point. */
export function siteAt(sites: readonly LandSite[], x: number, z: number): number {
  const [wx, wz] = warpPoint(x, z);
  return nearestSite(sites, wx, wz);
}
