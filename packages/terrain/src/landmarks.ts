// Where a landmark stands. A landmark is meant to be seen from far away, so
// its site is the most prominent gentle, dry ground of its region: a knoll
// or a rise near the region's heart, clear of water and of what already
// stands. Its footprint is then leveled into the baked lattice, blending
// back into the land, as a cottage's pad is.

import { heightAt, slopeAt, worldOf } from "./lattice.ts";
import type { Occupied } from "./scatter.ts";
import { isWet } from "./plants.ts";
import type { Terrain } from "./world.ts";

export interface LandmarkSite {
  readonly x: number;
  readonly z: number;
  /** The leveled footprint's height: the landmark's ground. */
  readonly y: number;
  readonly region: number;
}

export const LANDMARK_SITE = {
  /** Meters between candidate sites. */
  step: 5,
  /** Sites keep this far inside the walkable square's edge, beyond their own radius. */
  margin: 30,
  /** Prominence is measured against the ground this far around, meters. */
  surround: 34,
  /** Steepest ground under the footprint, degrees. */
  maxSlope: 13,
  /** How much a meter from the region's heart costs, in meters of prominence. */
  centrality: 0.014,
  /** Meters over which the leveled footprint blends back into the land. */
  blend: 8,
} as const;

/**
 * The most prominent gentle, dry spot in a region for a landmark of
 * footprint `radius`, keeping clear of `avoid`; null when the region has
 * no room.
 */
export function findLandmarkSite(t: Terrain, region: number, radius: number, avoid: readonly Occupied[]): LandmarkSite | null {
  const l = t.lattice;
  const half = t.spec.size / 2 - LANDMARK_SITE.margin - radius;
  const heart = t.spec.regions[region];
  if (heart === undefined) return null;
  let best: { x: number; z: number; score: number } | null = null;
  for (let z = -half; z <= half; z += LANDMARK_SITE.step) {
    for (let x = -half; x <= half; x += LANDMARK_SITE.step) {
      const ix = Math.round((x - l.origin) / l.spacing);
      const iz = Math.round((z - l.origin) / l.spacing);
      if (t.region[iz * l.n + ix] !== region) continue;
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
      const score = h - around / 12 - LANDMARK_SITE.centrality * Math.hypot(x - heart.x, z - heart.z);
      if (best === null || score > best.score) best = { x, z, score };
    }
  }
  if (best === null) return null;
  return { x: best.x, z: best.z, y: levelDisc(t, best.x, best.z, radius), region };
}

/** Levels a disc of ground to its mean height, blending back to the land; returns that height. */
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
  const reach = radius + LANDMARK_SITE.blend;
  const i0 = Math.max(0, Math.floor((x - reach - l.origin) / l.spacing));
  const i1 = Math.min(l.n - 1, Math.ceil((x + reach - l.origin) / l.spacing));
  const j0 = Math.max(0, Math.floor((z - reach - l.origin) / l.spacing));
  const j1 = Math.min(l.n - 1, Math.ceil((z + reach - l.origin) / l.spacing));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(worldOf(l, i) - x, worldOf(l, j) - z);
      const u = Math.max(0, Math.min(1, (d - radius) / LANDMARK_SITE.blend));
      const w = 1 - u * u * (3 - 2 * u);
      if (w <= 0) continue;
      const k = j * l.n + i;
      l.heights[k] = (l.heights[k] as number) + (level - (l.heights[k] as number)) * w;
    }
  }
  return level;
}
