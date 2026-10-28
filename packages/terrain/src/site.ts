// Chooses building sites and levels a pad under each. A site is dry, gentle
// ground near water with its door facing the water, and a building whose
// feature needs running water sits on a stream's bank with its wheel in a pit
// in the stream. The pad levels the baked lattice under the house and yard and
// blends back to the land, so the walls, the walk and the grass share one flat
// ground.

import type { BuildingPlan, Built } from "@gaia/schema";
import { type Lattice, heightAt, worldOf, worldOfZ } from "./lattice.ts";
import { surfaceHalfWidth } from "./water.ts";
import { DRY, type Terrain, regionAt } from "./world.ts";
import { BUILDING_MARGIN, withinLand } from "./edge.ts";
import { waterDepthAt } from "./walk.ts";

export interface BuildingSite {
  readonly x: number;
  readonly z: number;
  /** Rotation about y. The door faces (sin yaw, cos yaw). */
  readonly yaw: number;
  /** The leveled pad's height, which is the building's ground level. */
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

/** A rectangle in the building's own frame, such as the bounds of a mill wheel or a tower beside the house. */
export interface Extent {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/** The bounds of a feature's solid parts in the house's frame, or null when it has none. */
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

/** The bounds of a feature's turning parts in the house's frame, such as a mill's wheel, or null when nothing turns. */
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

/**
 * The yard in the building's own frame: the house with a margin, the walk out front from its door, which a porch puts
 * past the front wall, and anything `beside` it.
 */
function yardOf(plan: BuildingPlan, beside: Extent | null = null): Extent {
  const door = plan.openings.find((o) => o.kind === "door");
  const front = Math.max(plan.depth / 2, door?.position[2] ?? -Infinity);
  const yard = { x0: -plan.width / 2 - 1.2, x1: plan.width / 2 + 1.2, z0: -plan.depth / 2 - 1.2, z1: front + 5.8 };
  if (beside === null) return yard;
  return { x0: Math.min(yard.x0, beside.x0 - 1), x1: Math.max(yard.x1, beside.x1 + 1), z0: Math.min(yard.z0, beside.z0 - 1), z1: Math.max(yard.z1, beside.z1 + 1) };
}

/** Converts a point in the building's frame to world x, z, as Three's rotation about y places it. */
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

/** A building's site and its yard in its own frame, as a `PadEdit` holds them. */
export type Yard = Pick<PadEdit, "site" | "yard">;

/** Whether two yards overlap, by a separating axis test on both buildings' axes. */
export function yardsMeet(a: Yard, b: Yard): boolean {
  const corners = ({ site, yard: y }: Yard): [number, number][] => [siteToWorld(site, y.x0, y.z0), siteToWorld(site, y.x1, y.z0), siteToWorld(site, y.x1, y.z1), siteToWorld(site, y.x0, y.z1)];
  const ca = corners(a);
  const cb = corners(b);
  // Each building's own x and z axes in world space, as `siteToWorld` turns them.
  const axes = [a.site.yaw, b.site.yaw].flatMap((yaw): [number, number][] => [[Math.cos(yaw), -Math.sin(yaw)], [Math.sin(yaw), Math.cos(yaw)]]);
  return axes.every(([nx, nz]) => {
    const pa = ca.map(([x, z]) => x * nx + z * nz);
    const pb = cb.map(([x, z]) => x * nx + z * nz);
    return Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa);
  });
}

/** World points over the yard every `step` meters, with the yard grown by `grow` on every side. */
function yardSamples(plan: BuildingPlan, site: BuildingSite, step: number, grow = 0, beside: Extent | null = null): [number, number][] {
  const y = yardOf(plan, beside);
  const out: [number, number][] = [];
  for (let lz = y.z0 - grow; lz <= y.z1 + grow + 1e-6; lz += step) {
    for (let lx = y.x0 - grow; lx <= y.x1 + grow + 1e-6; lx += step) out.push(siteToWorld(site, lx, lz));
  }
  return out;
}

/** A candidate building position and door yaw. */
type Spot = { readonly x: number; readonly z: number; readonly yaw: number };

/** Spots on rings every 2 m from `r0` to `r1` meters out from a lot's center, each in four yaws starting from facing the world's center. */
function ringSpots(lot: Circle, r0: number, r1: number): Spot[] {
  const spots: Spot[] = [];
  for (let r = r0; r <= r1; r += 2) {
    const count = r === 0 ? 1 : Math.ceil((Math.PI * 2 * r) / 3);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      const x = lot.x + Math.cos(a) * r;
      const z = lot.z + Math.sin(a) * r;
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) spots.push({ x, z, yaw: yaw + Math.atan2(-lot.x, -lot.z) });
    }
  }
  return spots;
}

/**
 * Finds a building site. Without a lot, it is the gentlest dry spot near the
 * middle reach of a stream, with its door facing the water, or without
 * streams the gentlest dry spot inside the world. On a lot laid out for it
 * (`within`), it is the gentlest dry spot on the lot, or the nearest past it.
 * A site keeps `apart` meters from every `taken` site, at most 12 m on a lot,
 * where its yard also stays off every `laid` yard. Its yard covers `beside`.
 */
export function findSite(t: Terrain, plan: BuildingPlan, taken: readonly BuildingSite[] = [], apart = 30, beside: Extent | null = null, within: Circle | null = null, laid: readonly PadEdit[] = []): BuildingSite {
  const half = t.spec.size / 2 - BUILDING_MARGIN;
  const everywhere = (): Spot[] => {
    const spots: Spot[] = [];
    for (let z = -half; z <= half; z += 12) for (let x = -half; x <= half; x += 12) if (withinLand(t.spec, x, z, BUILDING_MARGIN)) spots.push({ x, z, yaw: Math.atan2(-x, -z) });
    return spots;
  };
  if (within !== null) {
    // On a lot, take the gentlest dry spot whose center lies on the lot, with its door in one of four yaws from facing
    // the world's center. With none free, take the lot's center, unless the house would be in water or its yard meets
    // a laid one.
    const middle: BuildingSite = { x: within.x, z: within.z, yaw: Math.atan2(-within.x, -within.z), level: heightAt(t.lattice, within.x, within.z) };
    const clear = !laid.some((p) => yardsMeet(p, { site: middle, yard: yardOf(plan, beside) }));
    const onLot = gentlest(t, plan, ringSpots(within, 0, within.radius), taken, Math.min(apart, 12), beside, half, laid) ?? (inWater(t, plan, middle) || !clear ? null : middle);
    if (onLot !== null) return onLot;
    // Otherwise take the gentlest dry spot in the nearest band of ground past the lot, then anywhere.
    for (let r = within.radius + 2; r <= within.radius + 60; r += 12) {
      const past = gentlest(t, plan, ringSpots(within, r, r + 10), taken, Math.min(apart, 12), beside, half, laid);
      if (past !== null) return past;
    }
    return gentlest(t, plan, everywhere(), taken, Math.min(apart, 12), beside, half, laid) ?? middle;
  }
  const candidates: Spot[] = [];
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
  // Try beside the water first, then anywhere in the world when the banks are full.
  return gentlest(t, plan, candidates, taken, apart, beside, half) ?? gentlest(t, plan, everywhere(), taken, apart, beside, half) ?? { x: 0, z: 0, yaw: 0, level: heightAt(t.lattice, 0, 0) };
}

/**
 * Whether water is above `level` at any of the four samples of the lattice cell holding (x, z), the samples
 * `waterDepthAt` reads there. The water surface interpolated across the cell is no guide, because a dry sample's level
 * is `DRY` and outweighs a wet one.
 */
function wetAbove(t: Terrain, x: number, z: number, level: number): boolean {
  const l = t.lattice;
  const ix = Math.min(l.n - 2, Math.max(0, Math.floor((x - l.origin) / l.spacing)));
  const iz = Math.min(l.n - 2, Math.max(0, Math.floor((z - (l.originZ ?? l.origin)) / l.spacing)));
  for (const i of [iz * l.n + ix, iz * l.n + ix + 1, (iz + 1) * l.n + ix, (iz + 1) * l.n + ix + 1]) {
    const surface = t.waterLevel[i] as number;
    if (surface > DRY / 2 && surface > level) return true;
  }
  return false;
}

/**
 * Whether water would stand in a site's house once its pad is leveled, meaning the water surface is above the pad
 * somewhere under the house. It samples at most a meter apart from wall to wall, both walls included.
 */
function inWater(t: Terrain, plan: BuildingPlan, site: BuildingSite): boolean {
  const across = Math.ceil(plan.width);
  const along = Math.ceil(plan.depth);
  for (let k = 0; k <= along; k++) {
    const lz = -plan.depth / 2 + (plan.depth * k) / along;
    for (let i = 0; i <= across; i++) {
      const lx = -plan.width / 2 + (plan.width * i) / across;
      if (wetAbove(t, ...siteToWorld(site, lx, lz), site.level)) return true;
    }
  }
  return false;
}

function gentlest(t: Terrain, plan: BuildingPlan, candidates: readonly Spot[], taken: readonly BuildingSite[], apart: number, beside: Extent | null, half: number, laid: readonly PadEdit[] = []): BuildingSite | null {
  const yard = yardOf(plan, beside);
  let best: BuildingSite | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (Math.abs(c.x) > half || !withinLand(t.spec, c.x, c.z, BUILDING_MARGIN)) continue;
    if (taken.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < apart)) continue;
    const site: BuildingSite = { ...c, level: 0 };
    if (laid.some((p) => yardsMeet(p, { site, yard }))) continue;
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

/** The data of one pad leveled by `levelPad`, so a tile baked alone can apply it again. */
export interface PadEdit {
  readonly site: BuildingSite;
  /** The yard in the building's own frame. */
  readonly yard: Extent;
  /** For a house on a stream's bank, the signed x of its wall on the water's side, in its own frame. Ground past it stays unchanged except for the pit. */
  readonly wall?: number;
  /** For a house on a stream's bank, the pit its wheel turns in, in its own frame, its floor no higher than `level`. */
  readonly pit?: Extent & { readonly level: number };
}

/**
 * Levels the lattice under the yard to the site's level, blending back to the land over `PAD_BLEND` meters, and
 * returns the edit. A site on a bank (`BankSite`) leaves the ground past its wall on the water's side unchanged.
 */
export function levelPad(t: Terrain, plan: BuildingPlan, site: BuildingSite | BankSite, beside: Extent | null = null): PadEdit {
  const edit = { site, yard: yardOf(plan, beside), ...("wall" in site ? { wall: site.wall, pit: site.pit } : {}) };
  applyPad(t.lattice, edit);
  return edit;
}

/** A site on a stream's bank, with the signed x of its wall on the water's side in the building's frame, and its wheel's pit. */
export interface BankSite extends BuildingSite {
  readonly wall: number;
  readonly pit: Extent & { readonly level: number };
}

/**
 * How a building whose feature needs running water sits on a stream's bank, in meters. Its wall on the wheel's side
 * is one of `gaps` from the water's edge, so the wheel turns over the water. Its other sides keep `margin` from any
 * water, as every yard does. Its pad is within `even` of all the ground under the house or, where no bank is that
 * even, within `blended`, the most the pad's blend can carry back to the land over `PAD_BLEND` while staying walkable
 * at 30 degrees. The pad is at most `above` and at least `below` over the water, so the wheel, sunk below the floor,
 * dips into the stream. The wheel turns in a pit `pit` below the water. The wheel's foot stands in water at least
 * `foot` deep or, where no bank offers that, in any water. A trickle one or two lattice samples wide is that thin near
 * its edge, and the pit deepens it under the wheel.
 */
export const BANK_SITE = { gaps: [0.2, 0.3], margin: 2.5, even: 1, blended: (PAD_BLEND * Math.tan(Math.PI / 6)) / 1.5, above: 0.3, below: 0.1, pit: 0.45, foot: 0.05 } as const;

/** A bank site for a building whose feature needs running water. `score` is its distance from its lot plus the unevenness of its ground. */
export interface BankSpot {
  readonly site: BankSite;
  readonly score: number;
}

/**
 * Every bank spot where a building whose feature (`beside`, with its turning `wheel`) needs running water could stand.
 * `along` picks the streams: those through `region`, the whole river that rises in `region`, or any stream. At each
 * spot the house is dry, the yard's other sides keep `BANK_SITE.margin` from water, and the pad is within `limit`
 * meters of the ground under it and low enough for the wheel to dip in. The wheel's foot is in water deeper than
 * `foot` with the stream running past it, `taken` sites are 12 m away, and the yard stays off every `laid` yard.
 */
export function bankSpots(t: Terrain, plan: BuildingPlan, beside: Extent, wheel: Extent, region: number, options: { readonly along?: "region" | "river" | "any"; readonly limit?: number; readonly foot?: number; readonly taken?: readonly BuildingSite[]; readonly within?: Circle | null; readonly laid?: readonly PadEdit[] } = {}): BankSpot[] {
  const { along = "region", limit = BANK_SITE.even, foot = BANK_SITE.foot, taken = [], within = null, laid = [] } = options;
  const half = t.spec.size / 2 - BUILDING_MARGIN;
  const yard = yardOf(plan, beside);
  // The wheel's side, that side's wall, the wheel's center, and how far the feature beside the house reaches.
  const side = wheel.x0 + wheel.x1 >= 0 ? 1 : -1;
  const wall = (side * plan.width) / 2;
  const reach = Math.max(Math.abs(beside.x0), Math.abs(beside.x1));
  const wheelX = (wheel.x0 + wheel.x1) / 2;
  const wheelZ = (wheel.z0 + wheel.z1) / 2;
  const streams =
    along === "any"
      ? t.streams
      : along === "region"
      ? t.streams.filter((s) => s.stations.some((q) => regionAt(t.spec, q.x, q.z) === region))
      : t.streams.filter((s) => {
          // Match on the river's source, since a small region's river can leave it within its first few meters.
          const head = s.stations[0];
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
        // Step from the stream's center toward this bank to find the water's edge.
        const nx = (-(b.z - a.z) / tl) * toward;
        const nz = ((b.x - a.x) / tl) * toward;
        let edge = 0;
        while (edge < 15 && waterDepthAt(t, s.x + nx * edge, s.z + nz * edge) > 0) edge += 0.25;
        if (edge >= 15) continue;
        for (const gap of BANK_SITE.gaps) {
          const off = edge + gap + plan.width / 2;
          const x = s.x + nx * off;
          const z = s.z + nz * off;
          if (Math.abs(x) > half || Math.abs(z) > half || !withinLand(t.spec, x, z, BUILDING_MARGIN)) continue;
          if (taken.some((o) => Math.hypot(o.x - x, o.z - z) < 12)) continue;
          // Turn the wheel's side to face the water. The house's +x runs along (cos yaw, -sin yaw).
          const yaw = Math.atan2(nz / side, -nx / side);
          const at = { x, z, yaw, level: 0, wall };
          if (laid.some((p) => yardsMeet(p, { site: at, yard }))) continue;
          const site = (lx: number, lz: number): [number, number] => siteToWorld(at, lx, lz);
          // The wheel's foot, where its paddles dip, must be in water, and the stream must run on past it. The pit
          // below carries water under the rest of the wheel.
          const wet = (lx: number, lz: number, deeper: number = BANK_SITE.foot): boolean => waterDepthAt(t, ...site(lx, lz)) > deeper;
          if (!wet(wheelX, wheelZ, foot) || !wet(side * (reach + 0.6), wheelZ)) continue;
          // The house must be dry, and the yard keeps `BANK_SITE.margin` from water except on the wheel's side.
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
          // The pad is the ground's mean under the house, capped low enough over the water that the wheel dips in.
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
 * Finds a bank site for a building whose feature (`beside`, with its turning `wheel`) needs running water. It takes the
 * spot nearest its lot (`within`) on a stream through `region` (`bankSpots`), then anywhere along the river that rises
 * in `region`. Failing both, it retries on ground as uneven as the pad's blend can carry (`BANK_SITE.blended`), then
 * with the wheel's foot in any water. When those banks are all taken, as a small area's crowded mills can take them,
 * it takes the free bank spot nearest its lot on any stream. It never puts a wheel on dry ground or a house in water,
 * and returns null when no stream has such a spot.
 */
export function findBankSite(t: Terrain, plan: BuildingPlan, beside: Extent, wheel: Extent, region: number, taken: readonly BuildingSite[] = [], within: Circle | null = null, laid: readonly PadEdit[] = []): BankSite | null {
  for (const foot of [BANK_SITE.foot, 0]) {
    for (const limit of [BANK_SITE.even, BANK_SITE.blended]) {
      for (const along of ["region", "river"] as const) {
        let best: BankSpot | null = null;
        for (const spot of bankSpots(t, plan, beside, wheel, region, { along, limit, foot, taken, within, laid })) if (best === null || spot.score < best.score) best = spot;
        if (best !== null) return best.site;
      }
    }
  }
  for (const foot of [BANK_SITE.foot, 0]) {
    for (const limit of [BANK_SITE.even, BANK_SITE.blended]) {
      for (const along of ["any"] as const) {
        let best: BankSpot | null = null;
        for (const spot of bankSpots(t, plan, beside, wheel, region, { along, limit, foot, taken, within, laid })) if (best === null || spot.score < best.score) best = spot;
        if (best !== null) return best.site;
      }
    }
  }
  return null;
}

/**
 * Levels a pad into `l`, which may be the world's lattice or any window of
 * it. Each sample's change depends only on its own position and the pad, so
 * a window gets the same bytes the world's lattice has there.
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
      // On a bank, ground past the wall on the water's side stays unchanged except for the wheel's pit.
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
