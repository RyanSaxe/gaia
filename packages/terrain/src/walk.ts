// Walking at eye height, one pure step at a time. A person wades through
// shallow water more slowly and never walks into water deep enough to reach
// their eyes: a step that would end there slides along the edge instead. A
// walk to a tapped point goes straight there and ends on arrival, or at the
// edge of deep water in the way.

import { heightAt } from "./lattice.ts";
import { DRY, type Terrain } from "./world.ts";

export const WADE = {
  /** Speed falls by up to this share as the water deepens from `slowFrom` to `slowTo` meters. */
  slow: 0.6,
  slowFrom: 0.1,
  slowTo: 1.1,
  /** No step ends where the water is this deep or deeper; eyes are 1.6 m up. */
  deepest: 1.2,
  /** The walker stays this far inside the walkable square's edge, meters. */
  margin: 6,
} as const;

export interface Walker {
  readonly x: number;
  readonly z: number;
}

/** Where the person wants to go: a direction on the ground (length up to 1) and a speed in meters per second. */
export interface Intent {
  readonly dx: number;
  readonly dz: number;
  readonly speed: number;
}

const depthFields = new WeakMap<Terrain, Float32Array>();

/** Water depth per lattice sample, 0 where there is no water: interpolates like the ground does. */
function depthField(t: Terrain): Float32Array {
  let field = depthFields.get(t);
  if (field === undefined) {
    const { heights } = t.lattice;
    field = new Float32Array(heights.length);
    for (let i = 0; i < heights.length; i++) {
      const level = t.waterLevel[i] as number;
      field[i] = level > DRY / 2 ? Math.max(0, level - (heights[i] as number)) : 0;
    }
    depthFields.set(t, field);
  }
  return field;
}

/** Water depth at a point: the water surface minus the ground, never below 0. */
export function waterDepthAt(t: Terrain, x: number, z: number): number {
  return Math.max(0, heightAt(t.lattice, x, z, depthField(t)));
}

const smoothstep = (lo: number, hi: number, x: number): number => {
  const c = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return c * c * (3 - 2 * c);
};

/** The share of full speed left when wading at `depth`. */
export const wadeSpeed = (depth: number): number => 1 - WADE.slow * smoothstep(WADE.slowFrom, WADE.slowTo, depth);

/**
 * One step of walking. Speed falls as the water deepens, and a step that would
 * end where the water is 1.2 m deep or more slides along the edge instead.
 * Eyes stay 1.6 m above the ground, so they never go below the surface.
 */
export function walkStep(t: Terrain, from: Walker, intent: Intent, dt: number): Walker {
  const len = Math.hypot(intent.dx, intent.dz);
  if (len < 1e-9 || dt <= 0 || intent.speed <= 0) return from;
  const k = 1 / Math.max(1, len);
  const dx = intent.dx * k;
  const dz = intent.dz * k;
  const step = intent.speed * wadeSpeed(waterDepthAt(t, from.x, from.z)) * dt;
  const half = t.spec.size / 2 - WADE.margin;
  const clamp = (v: number): number => Math.max(-half, Math.min(half, v));
  const tryStep = (sx: number, sz: number): Walker | null => {
    const x = clamp(from.x + sx * step);
    const z = clamp(from.z + sz * step);
    return waterDepthAt(t, x, z) < WADE.deepest ? { x, z } : null;
  };
  const straight = tryStep(dx, dz);
  if (straight !== null) return straight;
  // Keep only the part of the step that runs along the deep water's edge.
  const e = t.lattice.spacing;
  const px = from.x + dx * step;
  const pz = from.z + dz * step;
  const gx = waterDepthAt(t, px + e, pz) - waterDepthAt(t, px - e, pz);
  const gz = waterDepthAt(t, px, pz + e) - waterDepthAt(t, px, pz - e);
  const g = Math.hypot(gx, gz);
  if (g < 1e-9) return from;
  const nx = gx / g;
  const nz = gz / g;
  const into = dx * nx + dz * nz;
  const tx = dx - into * nx;
  const tz = dz - into * nz;
  // Right at the edge the slide also leans a little away from the deep water,
  // so the curve of the edge cannot pin the walker in place.
  return tryStep(tx, tz) ?? tryStep(tx - nx * 0.4, tz - nz * 0.4) ?? from;
}

export const WALK_TO = {
  /** Walking pace, meters per second. */
  pace: 4.2,
  /** While more than `jogFrom` meters remain the walker jogs at this multiple of the pace, easing back to a walk by `walkWithin`. */
  jog: 1.8,
  jogFrom: 25,
  walkWithin: 15,
  /** A target this close is where the walker stands: the walk ends there, or never starts. */
  reach: 1.5,
  /** A step that gets closer by less than this share of its length ends the walk: deep water or the world's edge turned it too far aside. */
  stall: 0.5,
} as const;

/** One step of a walk to a target, and whether the walk goes on. */
export interface Approach {
  readonly walker: Walker;
  /** `arrived` within `WALK_TO.reach` of the target; `stalled` where deep water or the world's edge stops the walker short of it. */
  readonly state: "walking" | "arrived" | "stalled";
}

/**
 * One step of walking straight toward a point on the ground, through
 * `walkStep`, so wading and deep water work as they do for any walk. A glancing
 * brush with deep water slides past it; water across the way stops the walk at
 * its edge rather than pushing against it forever.
 */
export function walkToward(t: Terrain, from: Walker, target: Walker, dt: number): Approach {
  const ex = target.x - from.x;
  const ez = target.z - from.z;
  const remaining = Math.hypot(ex, ez);
  if (remaining <= WALK_TO.reach) return { walker: from, state: "arrived" };
  const speed = WALK_TO.pace * (1 + (WALK_TO.jog - 1) * smoothstep(WALK_TO.walkWithin, WALK_TO.jogFrom, remaining));
  const full = speed * wadeSpeed(waterDepthAt(t, from.x, from.z)) * dt;
  if (full <= 0) return { walker: from, state: "walking" };
  // A step longer than the way left lands on the target rather than past it.
  const share = Math.min(1, remaining / full);
  const next = walkStep(t, from, { dx: (ex / remaining) * share, dz: (ez / remaining) * share, speed }, dt);
  const left = Math.hypot(target.x - next.x, target.z - next.z);
  if (remaining - left < WALK_TO.stall * full * share) return { walker: from, state: "stalled" };
  return { walker: next, state: left <= WALK_TO.reach ? "arrived" : "walking" };
}
