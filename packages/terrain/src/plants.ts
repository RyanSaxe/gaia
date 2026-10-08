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

/** A grove to grow: its heart, how many trees, how close they stand there, and how far it may reach. */
export interface Grove {
  readonly x: number;
  readonly z: number;
  readonly count: number;
  /** Meters between trunks at the grove's heart; toward its margin they stand farther apart. */
  readonly spacing: number;
  /** The farthest a tree may stand from the heart, meters. */
  readonly reach: number;
  readonly seed: number;
}

/**
 * Where a grove's trees stand: close together around its heart, thinning
 * into scattered trees at its margin, inside an outline of seeded lobes so no
 * two groves share a shape. Candidates fill from the heart outward, each kept
 * clear of the grove's own trees and of whatever `crowded` reports, on ground
 * `fits` accepts; the first tree stands nearest the heart. Pure and seeded.
 */
export function growGrove(g: Grove, fits: (x: number, z: number) => boolean, crowded: (x: number, z: number, gap: number) => boolean = () => false): [number, number][] {
  if (g.count <= 0) return [];
  const r = rand(g.seed);
  const lobes = [2, 3, 5].map((k, i) => ({ k, phase: r.next() * Math.PI * 2, depth: [0.26, 0.16, 0.08][i] as number }));
  const along = (x: number, z: number): number => {
    const dx = x - g.x;
    const dz = z - g.z;
    const a = Math.atan2(dz, dx);
    return Math.hypot(dx, dz) / lobes.reduce((f, l) => f + l.depth * Math.sin(l.k * a + l.phase), 1);
  };
  // How far the close-set heart of the grove reaches, were every tree to stand in it.
  const core = Math.sqrt((g.count * g.spacing * g.spacing * 1.15) / Math.PI);
  const candidates: { x: number; z: number; key: number }[] = [{ x: g.x, z: g.z, key: -1 }];
  for (let i = 0, n = Math.max(32, g.count * 40); i < n; i++) {
    const a = r.next() * Math.PI * 2;
    const d = Math.sqrt(r.next()) * g.reach;
    const x = g.x + Math.cos(a) * d;
    const z = g.z + Math.sin(a) * d;
    // A little play in the order, so the grove's edge is ragged rather than drawn.
    candidates.push({ x, z, key: along(x, z) + r.next() * g.spacing * 0.7 });
  }
  candidates.sort((p, q) => p.key - q.key);
  const out: [number, number][] = [];
  for (const c of candidates) {
    if (out.length >= g.count) break;
    const t = Math.min(1, Math.max(0, (c.key / Math.max(core, 1e-6) - 0.7) / 0.7));
    const gap = g.spacing * (1 + 1.1 * t * t * (3 - 2 * t));
    if (out.some(([x, z]) => Math.hypot(x - c.x, z - c.z) < gap)) continue;
    if (!fits(c.x, c.z) || crowded(c.x, c.z, gap)) continue;
    out.push([c.x, c.z]);
  }
  return out;
}

/** Trunks bucketed into square cells, so a new tree checks only its neighbors for room. */
export function trunkIndex(cell = 16) {
  const cells = new Map<number, [number, number][]>();
  const key = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);
  return {
    add(x: number, z: number): void {
      const k = key(Math.floor(x / cell), Math.floor(z / cell));
      const list = cells.get(k);
      if (list === undefined) cells.set(k, [[x, z]]);
      else list.push([x, z]);
    },
    /** True when a trunk stands closer than `gap` to (x, z). */
    crowded(x: number, z: number, gap: number): boolean {
      const reach = Math.ceil(gap / cell);
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          for (const [tx, tz] of cells.get(key(cx + dx, cz + dz)) ?? []) if (Math.hypot(tx - x, tz - z) < gap) return true;
        }
      }
      return false;
    },
  };
}

/** How a landform's ground carries trees in a world with no code behind it: groves per hectare, trees in each, and how close. */
const GROVES_BY_LANDFORM: Readonly<Record<string, { readonly groves: number; readonly trees: readonly [number, number]; readonly spacing: number }>> = {
  "valley@1": { groves: 0.55, trees: [6, 16], spacing: 8 },
  "rolling-hills@1": { groves: 0.5, trees: [5, 14], spacing: 8.5 },
  "basin@1": { groves: 0.35, trees: [3, 8], spacing: 9 },
  "terraces@1": { groves: 0.3, trees: [3, 8], spacing: 9.5 },
  "meadow@1": { groves: 0.25, trees: [1, 3], spacing: 14 },
  "dunes@1": { groves: 0.15, trees: [1, 4], spacing: 12 },
};

/**
 * Seeded plant spots in a world with no code behind it, as groves and woods
 * with open ground between: each region grows groves by its landform
 * (valleys and hills hold the most, a meadow a few lone trees), each grove
 * close-set at its heart and thinning at its margin, on dry, gentle ground
 * inside the walkable square, up to `count` trees.
 */
export function scatterPlants(t: Terrain, count: number, seed: number, trunkRadius = 0.7): Spot[] {
  const r = rand(seed);
  const l = t.lattice;
  const half = t.spec.size / 2 - 24;
  const regionAt = (x: number, z: number): number => t.region[Math.round((z - l.origin) / l.spacing) * l.n + Math.round((x - l.origin) / l.spacing)] ?? 0;
  const fits = (x: number, z: number): boolean => Math.abs(x) <= half && Math.abs(z) <= half && slopeAt(l, x, z) <= PLANT_SLOPE && !isWet(t, x, z);
  // Grove hearts: seeded spots, each kept by its region's landform, drawn until the grove trees reach `count`.
  const area = (2 * half) ** 2 / 10_000;
  const heart = (): { x: number; z: number; trees: number; spacing: number; seed: number } | null => {
    const x = r.range(-half, half);
    const z = r.range(-half, half);
    const form = GROVES_BY_LANDFORM[t.spec.regions[regionAt(x, z)]?.biome.slots.relief?.use ?? ""] ?? { groves: 0.4, trees: [3, 10] as const, spacing: 9 };
    const keep = r.next();
    const size = r.next();
    const seed = Math.floor(r.next() * 2 ** 30);
    return keep > form.groves / 2 ? null : { x, z, trees: Math.round(form.trees[0] + (form.trees[1] - form.trees[0]) * size * size), spacing: form.spacing, seed };
  };
  const first = Array.from({ length: Math.ceil(area * 2) }, heart).filter((h) => h !== null);
  // Where the land would grow more than `count`, every grove gives up the same share.
  const share = Math.min(1, count / Math.max(1, first.reduce((n, h) => n + h.trees, 0)));
  const index = trunkIndex();
  const spots: Spot[] = [];
  for (let k = 0; spots.length < count && k < first.length + count * 20; k++) {
    const h = k < first.length ? first[k] : heart();
    if (h === null || h === undefined) continue;
    const grown = growGrove({ x: h.x, z: h.z, count: Math.min(count - spots.length, Math.max(1, Math.round(h.trees * share))), spacing: h.spacing, reach: h.spacing * 4 + 10, seed: h.seed }, fits, index.crowded);
    for (const [x, z] of grown) {
      index.add(x, z);
      spots.push({ x, z, y: groundedBase(l, x, z, trunkRadius), region: regionAt(x, z) });
    }
  }
  return spots;
}
