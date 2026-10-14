// Where a building stands and how it meets the ground. A site is chosen on
// dry, gentle ground near water, facing its door toward it; a building whose
// feature needs running water stands on a stream's bank instead, its wheel
// turning in a pit in the stream. Then a pad is leveled into the baked
// lattice under the house and its yard, blending back into the land over a
// few meters, so the walls, the walk and the grass all stand on the same flat
// ground and nothing floats.

import type { BuildingPlan, Built } from "@gaia/schema";
import { type Lattice, heightAt, worldOf, worldOfZ } from "./lattice.ts";
import { surfaceHalfWidth } from "./water.ts";
import { DRY, type Terrain, regionAt } from "./world.ts";
import { withinLand } from "./edge.ts";
import { waterDepthAt } from "./walk.ts";

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

/** A circle of ground, such as the lot a building or a landmark is laid out on. */
export interface Circle {
  readonly x: number;
  readonly z: number;
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

/** The reach of a feature's solid parts in the house's frame, or null when it has none. */
export function extentOf(feature: Built | undefined): Extent | null {
  if (feature === undefined) return null;
  const box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const part of feature.parts) {
    if (part.collision !== "solid") continue;
    for (let i = 0; i < part.positions.length; i += 3) {
      const x = part.positions[i] as number;
      const z = part.positions[i + 2] as number;
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.z0 = Math.min(box.z0, z);
      box.z1 = Math.max(box.z1, z);
    }
  }
  return Number.isFinite(box.x0) ? box : null;
}

/** The reach of a feature's turning parts in the house's frame, such as a mill's wheel, or null when nothing of it turns. */
export function turningExtent(feature: Built | undefined): Extent | null {
  if (feature === undefined) return null;
  const box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const part of feature.parts) {
    const spin = part.channels.spin;
    if (spin === undefined) continue;
    for (let i = 0; i < part.positions.length; i += 3) {
      if (spin[i] === 0 && spin[i + 1] === 0 && spin[i + 2] === 0) continue;
      box.x0 = Math.min(box.x0, part.positions[i] as number);
      box.x1 = Math.max(box.x1, part.positions[i] as number);
      box.z0 = Math.min(box.z0, part.positions[i + 2] as number);
      box.z1 = Math.max(box.z1, part.positions[i + 2] as number);
    }
  }
  return Number.isFinite(box.x0) ? box : null;
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
export function findSite(t: Terrain, plan: BuildingPlan, taken: readonly BuildingSite[] = [], apart = 30, beside: Extent | null = null, within: Circle | null = null): BuildingSite {
  const half = t.spec.size / 2 - 34;
  if (within !== null) {
    // A lot laid out for it: the gentlest dry spot whose middle lies on the lot, its door facing the lot's middle or the water.
    const spots: { x: number; z: number; yaw: number }[] = [];
    for (let r = 0; r <= within.radius; r += 2) {
      const count = r === 0 ? 1 : Math.ceil((Math.PI * 2 * r) / 3);
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2;
        const x = within.x + Math.cos(a) * r;
        const z = within.z + Math.sin(a) * r;
        for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) spots.push({ x, z, yaw: yaw + Math.atan2(-within.x, -within.z) });
      }
    }
    return gentlest(t, plan, spots, taken, Math.min(apart, 12), beside, half) ?? { x: within.x, z: within.z, yaw: Math.atan2(-within.x, -within.z), level: heightAt(t.lattice, within.x, within.z) };
  }
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
  for (let z = -half; z <= half; z += 12) for (let x = -half; x <= half; x += 12) if (withinLand(t.spec, x, z, 34)) everywhere.push({ x, z, yaw: Math.atan2(-x, -z) });
  // Beside the water first; anywhere in the world when the banks are full.
  return gentlest(t, plan, candidates, taken, apart, beside, half) ?? gentlest(t, plan, everywhere, taken, apart, beside, half) ?? { x: 0, z: 0, yaw: 0, level: heightAt(t.lattice, 0, 0) };
}

function gentlest(t: Terrain, plan: BuildingPlan, candidates: readonly { x: number; z: number; yaw: number }[], taken: readonly BuildingSite[], apart: number, beside: Extent | null, half: number): BuildingSite | null {
  let best: BuildingSite | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (Math.abs(c.x) > half || !withinLand(t.spec, c.x, c.z, 34)) continue;
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

/** A pad leveled into the land, as data: what `levelPad` did, so a tile of the land baked alone can do it again. */
export interface PadEdit {
  readonly site: BuildingSite;
  /** The yard in the building's own frame. */
  readonly yard: Extent;
  /** For a house on a stream's bank, its wall on the water's side, as a signed x in its own frame: past it the bank and the stream are left as they lie. */
  readonly wall?: number;
  /** For a house on a stream's bank, the pit its wheel turns in, in its own frame, its floor no higher than `level`. */
  readonly pit?: Extent & { readonly level: number };
}

/**
 * Levels the lattice under the yard to the site's level, blending back to the land over PAD_BLEND meters; returns
 * what it did. A site on a bank (`BankSite`) leaves the ground past its wall on the water's side as it lies.
 */
export function levelPad(t: Terrain, plan: BuildingPlan, site: BuildingSite | BankSite, beside: Extent | null = null): PadEdit {
  const edit = { site, yard: yardOf(plan, beside), ...("wall" in site ? { wall: site.wall, pit: site.pit } : {}) };
  applyPad(t.lattice, edit);
  return edit;
}

/** A site on a stream's bank: its wall on the water's side, as a signed x in the building's own frame, and the pit its wheel turns in. */
export interface BankSite extends BuildingSite {
  readonly wall: number;
  readonly pit: Extent & { readonly level: number };
}

/**
 * How a building whose feature needs running water stands on a stream's bank: its wall on the wheel's side this far
 * from the water's edge, meters, so the wheel turns over the water; its other sides as far from any water as every
 * other building's yard; and its pad within `even` meters of all the ground under the house, or, where no bank is
 * that even, within `blended`: the most its pad's blend can carry back to the land over PAD_BLEND meters while the
 * blend stays walkable (30 degrees). Its pad lies no higher than `above` over the water, so the wheel, sunk below
 * its floor, dips into the stream, and its wheel turns in a pit `pit` meters below the water.
 */
export const BANK_SITE = { gaps: [0.2, 0.3], margin: 2.5, even: 1, blended: (PAD_BLEND * Math.tan(Math.PI / 6)) / 1.5, above: 0.3, below: 0.1, pit: 0.45 } as const;

/** A spot on a stream's bank where a building whose feature needs running water could stand, and how far it lies from its lot plus how uneven its ground is. */
export interface BankSpot {
  readonly site: BankSite;
  readonly score: number;
}

/**
 * Every spot on the banks of the streams through `region` (or, `along` its river, the river that rises there, its
 * whole reach) where a building whose feature (`beside`, its `wheel` turning) needs running water could stand: the house dry, its yard's
 * other sides as far from water as every yard keeps (`BANK_SITE.margin`), its pad within `limit` meters of the
 * ground under it and low enough over the water for the wheel to dip in, the wheel turning in the stream and the
 * stream running on past it, and `taken` sites 12 m away.
 */
export function bankSpots(t: Terrain, plan: BuildingPlan, beside: Extent, wheel: Extent, region: number, options: { readonly along?: "region" | "river"; readonly limit?: number; readonly taken?: readonly BuildingSite[]; readonly within?: Circle | null } = {}): BankSpot[] {
  const { along = "region", limit = BANK_SITE.even, taken = [], within = null } = options;
  const half = t.spec.size / 2 - 34;
  // The wheel's side, its wall, where the wheel turns, and how far out what stands beside the house reaches.
  const side = wheel.x0 + wheel.x1 >= 0 ? 1 : -1;
  const wall = (side * plan.width) / 2;
  const reach = Math.max(Math.abs(beside.x0), Math.abs(beside.x1));
  const wheelX = (wheel.x0 + wheel.x1) / 2;
  const wheelZ = (wheel.z0 + wheel.z1) / 2;
  const streams =
    along === "region"
      ? t.streams.filter((s) => s.stations.some((q) => regionAt(t.spec, q.x, q.z) === region))
      : t.streams.filter((s) => {
          const head = s.stations[Math.min(s.stations.length - 1, 8)];
          return head !== undefined && regionAt(t.spec, head.x, head.z) === region;
        });
  const spots: BankSpot[] = [];
  for (const stream of streams) {
    const st = stream.stations;
    for (let k = 1; k + 1 < st.length; k++) {
      const s = st[k] as (typeof st)[number];
      if (along === "region" && regionAt(t.spec, s.x, s.z) !== region) continue;
      const a = st[k - 1] as (typeof st)[number];
      const b = st[k + 1] as (typeof st)[number];
      const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      for (const toward of [-1, 1]) {
        // From the stream's middle toward this bank, to the water's edge.
        const nx = (-(b.z - a.z) / tl) * toward;
        const nz = ((b.x - a.x) / tl) * toward;
        let edge = 0;
        while (edge < 15 && waterDepthAt(t, s.x + nx * edge, s.z + nz * edge) > 0) edge += 0.25;
        if (edge >= 15) continue;
        for (const gap of BANK_SITE.gaps) {
          const off = edge + gap + plan.width / 2;
          const x = s.x + nx * off;
          const z = s.z + nz * off;
          if (Math.abs(x) > half || Math.abs(z) > half || !withinLand(t.spec, x, z, 34)) continue;
          if (taken.some((o) => Math.hypot(o.x - x, o.z - z) < 12)) continue;
          // The wheel's side faces the water: the house's +x runs (cos yaw, -sin yaw), toward the stream on that side.
          const yaw = Math.atan2(nz / side, -nx / side);
          const at = { x, z, yaw, level: 0, wall };
          const site = (lx: number, lz: number): [number, number] => siteToWorld(at, lx, lz);
          // The wheel's foot, where its paddles dip, turns in the water, and the stream runs on past it; the pit it turns
          // in (below) carries the water under the rest of it.
          const wet = (lx: number, lz: number): boolean => waterDepthAt(t, ...site(lx, lz)) > 0.05;
          if (!wet(wheelX, wheelZ) || !wet(side * (reach + 0.6), wheelZ)) continue;
          // The house is dry; its yard keeps the margin every yard keeps from water, but on the wheel's side.
          const y = yardOf(plan, null);
          let dry = true;
          for (let lz = y.z0 - BANK_SITE.margin; lz <= y.z1 + BANK_SITE.margin + 1e-6 && dry; lz += 1) {
            for (let lx = y.x0 - BANK_SITE.margin; lx <= y.x1 + BANK_SITE.margin + 1e-6; lx += 1) {
              if (side * lx > plan.width / 2 - 1e-6) continue;
              if (waterDepthAt(t, ...site(lx, lz)) > 0) {
                dry = false;
                break;
              }
            }
          }
          for (let lz = -plan.depth / 2; lz <= plan.depth / 2 + 1e-6 && dry; lz += 0.5) if (waterDepthAt(t, ...site(wall, lz)) > 0) dry = false;
          if (!dry) continue;
          // Its pad: the ground's mean under the house, but low enough over the water that the wheel dips in.
          const water = heightAt(t.lattice, ...site(wheelX, wheelZ), t.waterLevel);
          let sum = 0;
          let count = 0;
          let lo = Infinity;
          let hi = -Infinity;
          for (let lz = -plan.depth / 2; lz <= plan.depth / 2 + 1e-6; lz += 1) {
            for (let lx = -plan.width / 2; lx <= plan.width / 2 + 1e-6; lx += 1) {
              const h = heightAt(t.lattice, ...site(lx, lz));
              sum += h;
              count++;
              lo = Math.min(lo, h);
              hi = Math.max(hi, h);
            }
          }
          const level = Math.min(sum / count, water + BANK_SITE.above);
          const uneven = Math.max(hi - level, level - lo);
          if (level < water + BANK_SITE.below || uneven > limit) continue;
          // The wheel turns in a pit in the stream's bed, which the stream fills.
          const pit = { x0: wheel.x0 - 0.15, x1: wheel.x1 + 0.15, z0: wheel.z0 - 0.1, z1: wheel.z1 + 0.1, level: water - BANK_SITE.pit };
          spots.push({ site: { ...at, level, pit }, score: (within === null ? 0 : Math.hypot(x - within.x, z - within.z)) + uneven });
        }
      }
    }
  }
  return spots;
}

/**
 * Where a building whose feature (`beside`, its `wheel` turning) needs running water stands: the bank spot nearest its lot (`within`) on
 * a stream through `region` (`bankSpots`); failing that, anywhere along the river that rises in `region`; failing
 * both, the same on ground as uneven as its pad's blend can carry (`BANK_SITE.blended`). It never stands a wheel on
 * dry ground nor a house in the water: null when no stream offers such a spot.
 */
export function findBankSite(t: Terrain, plan: BuildingPlan, beside: Extent, wheel: Extent, region: number, taken: readonly BuildingSite[] = [], within: Circle | null = null): BankSite | null {
  for (const limit of [BANK_SITE.even, BANK_SITE.blended]) {
    for (const along of ["region", "river"] as const) {
      let best: BankSpot | null = null;
      for (const spot of bankSpots(t, plan, beside, wheel, region, { along, limit, taken, within })) if (best === null || spot.score < best.score) best = spot;
      if (best !== null) return best.site;
    }
  }
  return null;
}

/**
 * Levels a pad into `l`, which may be the world's lattice or any window of
 * it: each sample moves by what its own place and the pad say, so a window
 * gets the same bytes as the world's lattice holds there.
 */
export function applyPad(l: Lattice, edit: PadEdit): void {
  const { site, yard: y } = edit;
  const cx = (y.x0 + y.x1) / 2;
  const cz = (y.z0 + y.z1) / 2;
  const hx = (y.x1 - y.x0) / 2;
  const hz = (y.z1 - y.z0) / 2;
  const reach = Math.hypot(hx, hz) + PAD_BLEND + Math.hypot(cx, cz);
  const oz = l.originZ ?? l.origin;
  const i0 = Math.max(0, Math.floor((site.x - reach - l.origin) / l.spacing));
  const i1 = Math.min(l.n - 1, Math.ceil((site.x + reach - l.origin) / l.spacing));
  const k0 = Math.max(0, Math.floor((site.z - reach - oz) / l.spacing));
  const k1 = Math.min(l.n - 1, Math.ceil((site.z + reach - oz) / l.spacing));
  const wall = edit.wall;
  for (let iz = k0; iz <= k1; iz++) {
    for (let ix = i0; ix <= i1; ix++) {
      const [lx, lz] = worldToSite(site, worldOf(l, ix), worldOfZ(l, iz));
      // On a bank, the bank and the stream past the wall on the water's side stay as they lie, but for the wheel's pit.
      if (wall !== undefined && lx * Math.sign(wall) > Math.abs(wall)) {
        const pit = edit.pit;
        if (pit !== undefined && lx >= pit.x0 && lx <= pit.x1 && lz >= pit.z0 && lz <= pit.z1) {
          const i = iz * l.n + ix;
          l.heights[i] = Math.min(l.heights[i] as number, pit.level);
        }
        continue;
      }
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
