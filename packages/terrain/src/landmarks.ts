// Chooses a landmark's site and levels its footprint. A landmark should be
// visible from far away, so its site is the most prominent gentle, dry ground
// near its region's center, clear of water and earlier placements. The
// footprint is leveled into the baked lattice and blends back into the land,
// as a cottage's pad does.

import { type Lattice, heightAt, slopeAt, worldOf, worldOfZ } from "./lattice.ts";
import type { Occupied } from "./placement.ts";
import type { Circle, OwnGround } from "./site.ts";
import { isWet } from "./plants.ts";
import type { Terrain } from "./world.ts";
import { withinLand } from "./edge.ts";

export interface LandmarkSite {
  readonly x: number;
  readonly z: number;
  /** The leveled footprint's height, which is the landmark's ground level. */
  readonly y: number;
  /** The leveled footprint's radius, meters. */
  readonly radius: number;
  readonly region: number;
}

/** The data of one landmark footprint's leveling, so a tile baked alone can apply it again. */
export interface DiscEdit {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly level: number;
}

/** The edit that leveled a landmark's site. */
export const discOf = (site: LandmarkSite): DiscEdit => ({ x: site.x, z: site.z, radius: site.radius, level: site.y });

export const LANDMARK_SITE = {
  /** Meters between candidate sites. */
  step: 5,
  /** Meters a site keeps inside the walkable square's edge, beyond its own radius. */
  margin: 30,
  /** Radius in meters of the ring of ground that prominence is measured against. */
  surround: 34,
  /** Steepest ground under the footprint, degrees. */
  maxSlope: 13,
  /** Prominence cost in meters per meter of distance from the region's center. */
  centrality: 0.014,
  /** Meters over which the leveled footprint blends back into the land. */
  blend: 8,
} as const;

/** The most prominent gentle, dry spot for a landmark of footprint `radius` clear of `avoid`: in `region`, or on a lot (`within`), on ground `own` holds when it is given. */
function prominentSpot(t: Terrain, region: number, radius: number, avoid: readonly Occupied[], within: Circle | null, own: OwnGround | null): { x: number; z: number; score: number } | null {
  const l = t.lattice;
  const half = t.spec.size / 2 - LANDMARK_SITE.margin - radius;
  const center = within ?? t.spec.regions[region];
  if (center === undefined) return null;
  let best: { x: number; z: number; score: number } | null = null;
  const step = within === null ? LANDMARK_SITE.step : 2;
  const [x0, x1, z0, z1] = within === null ? [-half, half, -half, half] : [Math.max(-half, within.x - within.radius), Math.min(half, within.x + within.radius), Math.max(-half, within.z - within.radius), Math.min(half, within.z + within.radius)];
  for (let z = z0; z <= z1; z += step) {
    for (let x = x0; x <= x1; x += step) {
      const ix = Math.round((x - l.origin) / l.spacing);
      const iz = Math.round((z - l.origin) / l.spacing);
      // On a lot, any region's land counts.
      if (within !== null ? Math.hypot(x - within.x, z - within.z) > within.radius : t.region[iz * l.n + ix] !== region) continue;
      if (own !== null && !own(x, z)) continue;
      if (!withinLand(t.spec, x, z, LANDMARK_SITE.margin + radius)) continue;
      if (avoid.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + radius)) continue;
      let steep = slopeAt(l, x, z);
      for (let k = 0; k < 8 && steep <= LANDMARK_SITE.maxSlope; k++) {
        const a = (k / 8) * Math.PI * 2;
        steep = Math.max(steep, slopeAt(l, x + Math.cos(a) * radius, z + Math.sin(a) * radius));
      }
      if (steep > LANDMARK_SITE.maxSlope) continue;
      if (isWet(t, x, z, radius + 6)) continue;
      const h = heightAt(l, x, z);
      let around = 0;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        around += heightAt(l, x + Math.cos(a) * LANDMARK_SITE.surround, z + Math.sin(a) * LANDMARK_SITE.surround);
      }
      const score = h - around / 12 - LANDMARK_SITE.centrality * Math.hypot(x - center.x, z - center.z);
      if (best === null || score > best.score) best = { x, z, score };
    }
  }
  return best;
}

/**
 * The most prominent gentle, dry spot in a region for a landmark of
 * footprint `radius`, clear of `avoid`. On a lot (`within`), it is the most
 * prominent such spot on the lot, with fallbacks so it always returns a site.
 * With the landmark's own ground (`own`), such as its file's patch, it first
 * takes the most prominent such spot on that ground, nearest the lot.
 * Without a lot, it returns null when the region has no room.
 */
export function findLandmarkSite(t: Terrain, region: number, radius: number, avoid: readonly Occupied[], within: Circle | null = null, own: OwnGround | null = null): LandmarkSite | null {
  if (within !== null && own !== null) {
    for (let r = within.radius; r <= within.radius + 60; r += 6) {
      const mine = prominentSpot(t, region, radius, avoid, { ...within, radius: r }, own);
      if (mine !== null) return { x: mine.x, z: mine.z, y: levelDisc(t, mine.x, mine.z, radius), radius, region };
    }
  }
  const best = prominentSpot(t, region, radius, avoid, within, null);
  if (best !== null) return { x: best.x, z: best.z, y: levelDisc(t, best.x, best.z, radius), radius, region };
  if (within === null) return null;
  // With no such spot on the lot, use the lot's center unless something already occupies it. Then retry on the lot
  // widened 6 m at a time, and at last take the free ground nearest the center, however steep or near the rim.
  const taken = (x: number, z: number): boolean => avoid.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + radius);
  if (taken(within.x, within.z) && within.radius < 60) return findLandmarkSite(t, region, radius, avoid, { ...within, radius: within.radius + 6 });
  let at = { x: within.x, z: within.z };
  if (taken(at.x, at.z)) {
    let near = Infinity;
    for (let z = within.z - within.radius; z <= within.z + within.radius; z++) {
      for (let x = within.x - within.radius; x <= within.x + within.radius; x++) {
        const d = Math.hypot(x - within.x, z - within.z);
        if (d >= near || d > within.radius || !withinLand(t.spec, x, z, radius) || taken(x, z)) continue;
        near = d;
        at = { x, z };
      }
    }
  }
  return { x: at.x, z: at.z, y: levelDisc(t, at.x, at.z, radius), radius, region };
}

/** Levels a disc of ground to its mean height, blending back to the land, and returns that height. */
function levelDisc(t: Terrain, x: number, z: number, radius: number): number {
  const l = t.lattice;
  let sum = 0;
  let n = 0;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    for (const f of [0, 0.5, 1]) {
      sum += heightAt(l, x + Math.cos(a) * radius * f, z + Math.sin(a) * radius * f);
      n++;
    }
  }
  const level = sum / n;
  applyDisc(l, { x, z, radius, level });
  return level;
}

/**
 * Levels a landmark's disc into `l`, which may be the world's lattice or any
 * window of it. Each sample's change depends only on its own position and the
 * disc, so a window gets the same bytes the world's lattice has there.
 */
export function applyDisc(l: Lattice, edit: DiscEdit): void {
  const { x, z, radius, level } = edit;
  const oz = l.originZ ?? l.origin;
  const reach = radius + LANDMARK_SITE.blend;
  const i0 = Math.max(0, Math.floor((x - reach - l.origin) / l.spacing));
  const i1 = Math.min(l.n - 1, Math.ceil((x + reach - l.origin) / l.spacing));
  const j0 = Math.max(0, Math.floor((z - reach - oz) / l.spacing));
  const j1 = Math.min(l.n - 1, Math.ceil((z + reach - oz) / l.spacing));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(worldOf(l, i) - x, worldOfZ(l, j) - z);
      const u = Math.max(0, Math.min(1, (d - radius) / LANDMARK_SITE.blend));
      const w = 1 - u * u * (3 - 2 * u);
      if (w <= 0) continue;
      const k = j * l.n + i;
      l.heights[k] = (l.heights[k] as number) + (level - (l.heights[k] as number)) * w;
    }
  }
}
