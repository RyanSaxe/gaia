// Where a building stands and how it meets the ground. A site is chosen on
// dry, gentle ground near water, facing its door toward it; then a pad is
// leveled into the baked lattice under the house and its yard, blending
// back into the land over a few meters, so the walls, the walk and the grass
// all stand on the same flat ground and nothing floats.

import type { BuildingPlan } from "@gaia/schema";
import { heightAt, worldOf } from "./lattice.ts";
import { surfaceHalfWidth } from "./water.ts";
import { DRY, type Terrain } from "./world.ts";

export interface BuildingSite {
  readonly x: number;
  readonly z: number;
  /** Rotation about y; the door faces (sin yaw, cos yaw). */
  readonly yaw: number;
  /** The leveled pad's height: the building's ground. */
  readonly level: number;
}

/** A capsule of ground from (ax, az) to (bx, bz), in world meters. */
export interface Capsule {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly radius: number;
}

/** Meters over which a pad blends back into the land. */
export const PAD_BLEND = 7;

/** A rectangle in the building's own frame, such as the reach of a mill wheel or a tower beside the house. */
export interface Extent {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/** The yard in the building's own frame: the house, a margin around it, the walk out front, and anything beside it. */
function yardOf(plan: BuildingPlan, beside: Extent | null = null): Extent {
  const yard = { x0: -plan.width / 2 - 1.2, x1: plan.width / 2 + 1.2, z0: -plan.depth / 2 - 1.2, z1: plan.depth / 2 + 5.8 };
  if (beside === null) return yard;
  return { x0: Math.min(yard.x0, beside.x0 - 1), x1: Math.max(yard.x1, beside.x1 + 1), z0: Math.min(yard.z0, beside.z0 - 1), z1: Math.max(yard.z1, beside.z1 + 1) };
}

/** A point in the building's frame, in the world, as Three's rotation about y places it. */
export function siteToWorld(site: BuildingSite, lx: number, lz: number): [number, number] {
  const c = Math.cos(site.yaw);
  const s = Math.sin(site.yaw);
  return [site.x + lx * c + lz * s, site.z - lx * s + lz * c];
}

function worldToSite(site: BuildingSite, x: number, z: number): [number, number] {
  const c = Math.cos(site.yaw);
  const s = Math.sin(site.yaw);
  const dx = x - site.x;
  const dz = z - site.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** True when (x, z) is within `margin` of the building's walls. */
export function insideFootprint(plan: BuildingPlan, site: BuildingSite, x: number, z: number, margin: number): boolean {
  const [lx, lz] = worldToSite(site, x, z);
  return Math.abs(lx) < plan.width / 2 + margin && Math.abs(lz) < plan.depth / 2 + margin;
}

/** The yard's samples, every `step` meters, in the world. */
function yardSamples(plan: BuildingPlan, site: BuildingSite, step: number, grow = 0, beside: Extent | null = null): [number, number][] {
  const y = yardOf(plan, beside);
  const out: [number, number][] = [];
  for (let lz = y.z0 - grow; lz <= y.z1 + grow + 1e-6; lz += step) {
    for (let lx = y.x0 - grow; lx <= y.x1 + grow + 1e-6; lx += step) out.push(siteToWorld(site, lx, lz));
  }
  return out;
}

/**
 * The gentlest dry spot near the middle reach of a stream, its door facing
 * the water; without streams, the gentlest dry spot inside the world. A
 * site keeps `apart` meters from every site already `taken`, and its yard
 * covers `beside` too.
 */
export function findSite(t: Terrain, plan: BuildingPlan, taken: readonly BuildingSite[] = [], apart = 30, beside: Extent | null = null): BuildingSite {
  const half = t.spec.size / 2 - 34;
  const candidates: { x: number; z: number; yaw: number }[] = [];
  for (const stream of t.streams) {
    const st = stream.stations;
    for (let k = Math.floor(st.length * 0.3); k < st.length * 0.65; k += 3) {
      const a = st[k - 1];
      const b = st[k + 1];
      const s = st[k];
      if (a === undefined || b === undefined || s === undefined) continue;
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      for (const side of [-1, 1]) {
        for (const d of [12, 14.5, 17]) {
          const off = surfaceHalfWidth(s) + d + plan.depth / 2;
          const x = s.x + (-tz / l) * off * side;
          const z = s.z + (tx / l) * off * side;
          candidates.push({ x, z, yaw: Math.atan2(s.x - x, s.z - z) });
        }
      }
    }
  }
  const everywhere: { x: number; z: number; yaw: number }[] = [];
  for (let z = -half; z <= half; z += 12) for (let x = -half; x <= half; x += 12) everywhere.push({ x, z, yaw: Math.atan2(-x, -z) });
  // Beside the water first; anywhere in the world when the banks are full.
  return gentlest(t, plan, candidates, taken, apart, beside, half) ?? gentlest(t, plan, everywhere, taken, apart, beside, half) ?? { x: 0, z: 0, yaw: 0, level: heightAt(t.lattice, 0, 0) };
}

function gentlest(t: Terrain, plan: BuildingPlan, candidates: readonly { x: number; z: number; yaw: number }[], taken: readonly BuildingSite[], apart: number, beside: Extent | null, half: number): BuildingSite | null {
  let best: BuildingSite | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (Math.abs(c.x) > half || Math.abs(c.z) > half) continue;
    if (taken.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < apart)) continue;
    const site: BuildingSite = { ...c, level: 0 };
    const pts = yardSamples(plan, site, 1.5, 0, beside);
    if (yardSamples(plan, site, 2, 2.5, beside).some(([x, z]) => heightAt(t.lattice, x, z, t.waterLevel) > DRY / 2)) continue;
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    for (const [x, z] of pts) {
      const h = heightAt(t.lattice, x, z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      sum += h;
    }
    if (hi - lo < bestScore) {
      bestScore = hi - lo;
      best = { ...c, level: sum / pts.length };
    }
  }
  return best;
}

/** Levels the lattice under the yard to the site's level, blending back to the land over PAD_BLEND meters. */
export function levelPad(t: Terrain, plan: BuildingPlan, site: BuildingSite, beside: Extent | null = null): void {
  const l = t.lattice;
  const y = yardOf(plan, beside);
  const cx = (y.x0 + y.x1) / 2;
  const cz = (y.z0 + y.z1) / 2;
  const hx = (y.x1 - y.x0) / 2;
  const hz = (y.z1 - y.z0) / 2;
  const reach = Math.hypot(hx, hz) + PAD_BLEND + Math.hypot(cx, cz);
  const i0 = Math.max(0, Math.floor((site.x - reach - l.origin) / l.spacing));
  const i1 = Math.min(l.n - 1, Math.ceil((site.x + reach - l.origin) / l.spacing));
  const k0 = Math.max(0, Math.floor((site.z - reach - l.origin) / l.spacing));
  const k1 = Math.min(l.n - 1, Math.ceil((site.z + reach - l.origin) / l.spacing));
  for (let iz = k0; iz <= k1; iz++) {
    for (let ix = i0; ix <= i1; ix++) {
      const [lx, lz] = worldToSite(site, worldOf(l, ix), worldOf(l, iz));
      const dx = Math.max(0, Math.abs(lx - cx) - hx);
      const dz = Math.max(0, Math.abs(lz - cz) - hz);
      const u = Math.min(1, Math.hypot(dx, dz) / PAD_BLEND);
      const w = 1 - u * u * (3 - 2 * u);
      if (w <= 0) continue;
      const i = iz * l.n + ix;
      l.heights[i] = (l.heights[i] as number) + (site.level - (l.heights[i] as number)) * w;
    }
  }
}

/** Ground kept clear of grass: the house's floor and the walk out from its door. */
export function clearingsOf(plan: BuildingPlan, site: BuildingSite): Capsule[] {
  const long = plan.width >= plan.depth;
  const r = Math.min(plan.width, plan.depth) / 2 + 0.1;
  const run = Math.abs(plan.width - plan.depth) / 2;
  const [ax, az] = siteToWorld(site, long ? -run : 0, long ? 0 : -run);
  const [bx, bz] = siteToWorld(site, long ? run : 0, long ? 0 : run);
  const out: Capsule[] = [{ ax, az, bx, bz, radius: r }];
  const door = plan.openings.find((o) => o.kind === "door");
  if (door !== undefined) {
    const [wx, wz] = siteToWorld(site, door.position[0], door.position[2] + 0.6);
    const [ex, ez] = siteToWorld(site, door.position[0], door.position[2] + 5.4);
    out.push({ ax: wx, az: wz, bx: ex, bz: ez, radius: 0.85 });
  }
  return out;
}
