// Where the understory stands: rocks in groups, bushes in thickets, flowers
// in drifts, each chosen for its place. A pure, seeded scatter over the baked
// terrain: candidate group sites sit on a jittered grid fixed to the world, so
// a change in one place moves nothing elsewhere; each site reads what kind of
// place it is (under a grove, at a wood's edge, open meadow, dry or steep
// ground, by water) and each rule places groups there by its density for that
// place and region, keeps its members apart, keeps off steep ground and away
// from water, and never overlaps what was placed before it.
// Every placement is grounded so nothing floats: a solid thing sits below the
// lowest ground under its footprint; a drift follows the ground's plane.

import { rand } from "@gaia/schema";
import { heightAt } from "./lattice.ts";
import { type Lattice, slopeAt } from "./lattice.ts";
import { groundPlane, isWet, lowestUnder } from "./plants.ts";
import type { Terrain } from "./world.ts";

/**
 * The kinds of place the understory chooses by: under a grove's canopy, at a
 * wood's edge or a lone tree's foot, open meadow, dry or steep ground, and
 * ground by water.
 */
export type Habitat = "under" | "edge" | "open" | "dry" | "wet";

/** One blueprint a rule may place, and the ground it covers. */
export interface ScatterVariant {
  /** Radius of the footprint at scale 1, meters. */
  readonly radius: number;
  /** Relative chance of being picked. */
  readonly weight: number;
  /** Its chance multiplied by kind of place; absent kinds count 1, and 0 keeps it out. */
  readonly places?: Partial<Record<Habitat, number>>;
}

export interface ScatterRule {
  /** Names what the rule places, such as "rocks"; it seeds the rule's own stream. */
  readonly id: string;
  readonly variants: readonly ScatterVariant[];
  /** Groups per hectare (10,000 m²) of a region's ground, at a region weight of 1. */
  readonly groups: number;
  /** How many members a group has, fewest and most. */
  readonly members: readonly [number, number];
  /** How far members stray from their group's center, meters. */
  readonly spread: number;
  /** "group" picks one variant for a whole group, as a drift of one species; "member" mixes them. */
  readonly mix: "group" | "member";
  /** Smallest and largest scale. */
  readonly scale: readonly [number, number];
  /** Steepest ground under the footprint, degrees. */
  readonly maxSlope: number;
  /** Meters of dry ground kept between the footprint and any water. */
  readonly waterClearance: number;
  /**
   * "lowest" seats a solid thing below the lowest ground under its footprint,
   * buried on the uphill side; "plane" lays a drift on the ground's plane,
   * never above the ground anywhere under it.
   */
  readonly ground: "lowest" | "plane";
  /** How far below that ground the origin sits, meters at scale 1. */
  readonly sink: number;
  /** Density multiplier per region index; absent regions count 1, and 0 keeps the rule out. */
  readonly regions?: readonly number[];
  /** Density multiplier per kind of place; absent kinds count 1. */
  readonly places?: Partial<Record<Habitat, number>>;
}

/** What the understory reads its places from: the trees' crowns, and what a region's open ground counts as. */
export interface ScatterGround {
  /** Each tree's trunk and crown radius. */
  readonly canopy?: readonly Occupied[];
  /** Per region index: open ground there reads as dry heath or damp hollow. */
  readonly open?: readonly (Habitat | undefined)[];
}

/** Something already standing that new placements keep clear of, such as a tree. */
export interface Occupied {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface Placement {
  readonly rule: string;
  readonly variant: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  /** The footprint's radius at this scale, meters. */
  readonly radius: number;
  /** The ground's plane under the footprint, dy/dx and dy/dz. Zero for "lowest" grounding. */
  readonly slope: readonly [number, number];
  readonly region: number;
  /** For a placement that stands for something, such as a function on its file's patch: that thing's vitality, which the copy shows. */
  readonly vitality?: number;
}

/** Placements stay this far inside the walkable square's edge, meters. */
const EDGE_MARGIN = 26;

/** Side of the grid cells that each hold one candidate group site, meters. */
const SITE = 12;

/** How far past a crown a wood's edge reaches, and how near water ground counts as wet, meters. */
const EDGE_REACH = 5;
const WET_REACH = 7;

/** Ground steeper than this, degrees, reads as dry and stony. */
const DRY_SLOPE = 9;

/** Cells of the grid that finds what already stands near a new placement, meters. */
const CELL = 8;

/**
 * What stands where, bucketed into square cells so a new placement checks
 * only its neighbors. It answers exactly as a check against every footprint
 * would: a cell's neighbors reach as far as the widest footprint can.
 */
function standing(first: readonly Occupied[]) {
  const cells = new Map<number, Occupied[]>();
  let widest = 0;
  const key = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);
  const add = (o: Occupied): void => {
    const k = key(Math.floor(o.x / CELL), Math.floor(o.z / CELL));
    const list = cells.get(k);
    if (list === undefined) cells.set(k, [o]);
    else list.push(o);
    widest = Math.max(widest, o.radius);
  };
  for (const o of first) add(o);
  return {
    add,
    /** Calls `visit` with everything standing whose footprint reaches within `extra` meters of (x, z), and its distance. */
    each(x: number, z: number, extra: number, visit: (o: Occupied, d: number) => void): void {
      const reach = Math.ceil((widest + extra) / CELL);
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          for (const o of cells.get(key(cx + dx, cz + dz)) ?? []) {
            const d = Math.hypot(o.x - x, o.z - z);
            if (d < o.radius + extra) visit(o, d);
          }
        }
      }
    },
    /** True when a footprint of `radius` at (x, z) comes closer than 85% of the two radii to anything standing. */
    crowds(x: number, z: number, radius: number): boolean {
      const reach = Math.ceil(((widest + radius) * 0.85) / CELL);
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const list = cells.get(key(cx + dx, cz + dz));
          if (list === undefined) continue;
          for (const o of list) if (Math.hypot(o.x - x, o.z - z) < (o.radius + radius) * 0.85) return true;
        }
      }
      return false;
    },
  };
}

function regionAt(t: Terrain, x: number, z: number): number {
  const l = t.lattice;
  const ix = Math.max(0, Math.min(l.n - 1, Math.round((x - l.origin) / l.spacing)));
  const iz = Math.max(0, Math.min(l.n - 1, Math.round((z - l.origin) / l.spacing)));
  return t.region[iz * l.n + ix] ?? 0;
}

function steepest(l: Lattice, x: number, z: number, radius: number): number {
  let s = slopeAt(l, x, z);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    s = Math.max(s, slopeAt(l, x + Math.cos(a) * radius, z + Math.sin(a) * radius));
  }
  return s;
}

function pickVariant(variants: readonly ScatterVariant[], u: number, place: Habitat): number {
  const weight = (v: ScatterVariant): number => v.weight * (v.places?.[place] ?? 1);
  const total = variants.reduce((n, v) => n + weight(v), 0);
  let acc = 0;
  for (let i = 0; i < variants.length; i++) {
    acc += weight(variants[i] as ScatterVariant);
    if (u * total <= acc) return i;
  }
  return variants.length - 1;
}

/** Reads the kind of place at a point from the trees' crowns, the water and the ground's slope. */
function placesOf(t: Terrain, ground: ScatterGround) {
  const crowns = standing(ground.canopy ?? []);
  const l = t.lattice;
  return (x: number, z: number): Habitat => {
    if (heightAt(l, x, z, t.shore) < WET_REACH) return "wet";
    let over = 0;
    let near = false;
    crowns.each(x, z, EDGE_REACH, (o, d) => {
      if (d < o.radius) over++;
      else if (d < o.radius + EDGE_REACH) near = true;
    });
    if (over >= 2) return "under";
    if (over === 1 || near) return "edge";
    if (slopeAt(l, x, z) > DRY_SLOPE) return "dry";
    return ground.open?.[regionAt(t, x, z)] ?? "open";
  };
}

/**
 * Places every rule's groups, rule by rule; each rule keeps clear of what
 * earlier rules and `occupied` hold. Each candidate site on the world's grid
 * reads its kind of place from `ground`, and a rule groups there with the
 * chance its density, its region's weight and that place give, picking its
 * variants for the place. Pure: the same terrain, rules, seed and ground
 * always give the same placements, and a site's placements depend only on
 * what stands near it.
 */
export function scatterComponents(t: Terrain, rules: readonly ScatterRule[], seed: number, occupied: readonly Occupied[] = [], ground: ScatterGround = {}): Placement[] {
  const l = t.lattice;
  const half = t.spec.size / 2 - EDGE_MARGIN;
  const taken = standing(occupied);
  const placeAt = placesOf(t, ground);
  const sites: { x: number; z: number; region: number; place: Habitat; key: string }[] = [];
  const grid = rand(seed).fork("sites");
  const cells = Math.floor((2 * half) / SITE);
  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const j = grid.fork(`${ix},${iz}`);
      const x = -half + (ix + j.next()) * SITE;
      const z = -half + (iz + j.next()) * SITE;
      sites.push({ x, z, region: regionAt(t, x, z), place: placeAt(x, z), key: `${ix},${iz}` });
    }
  }
  const out: Placement[] = [];
  const root = rand(seed);
  for (const rule of rules) {
    if (rule.variants.length === 0) continue;
    const mine: Placement[] = [];
    const chance = (rule.groups * SITE * SITE) / 10_000;
    for (const site of sites) {
        const g = root.fork(`${rule.id}/${site.key}`);
        if (g.next() >= chance * (rule.regions?.[site.region] ?? 1) * (rule.places?.[site.place] ?? 1)) continue;
        const cx = site.x;
        const cz = site.z;
        const members = rule.members[0] + Math.floor(g.next() * (rule.members[1] - rule.members[0] + 1));
        const groupVariant = pickVariant(rule.variants, g.next(), site.place);
        for (let m = 0, attempts = 0; m < members && attempts < members * 8; attempts++) {
          const a = g.next() * Math.PI * 2;
          // The first member stands at the center; the rest gather toward it.
          const d = m === 0 && attempts === 0 ? 0 : rule.spread * Math.sqrt(g.next());
          const x = cx + Math.cos(a) * d;
          const z = cz + Math.sin(a) * d;
          const variant = rule.mix === "group" ? groupVariant : pickVariant(rule.variants, g.next(), site.place);
          const scale = g.range(rule.scale[0], rule.scale[1]);
          const yaw = g.next() * Math.PI * 2;
          const radius = (rule.variants[variant] as ScatterVariant).radius * scale;
          if (Math.abs(x) > half - radius || Math.abs(z) > half - radius) continue;
          if (taken.crowds(x, z, radius)) continue;
          if (steepest(l, x, z, radius) > rule.maxSlope) continue;
          if (isWet(t, x, z, rule.waterClearance + radius)) continue;
          m++;
          let y: number;
          let slope: [number, number] = [0, 0];
          if (rule.ground === "lowest") {
            y = lowestUnder(l, x, z, radius * 0.85) - rule.sink * scale;
          } else {
            const plane = groundPlane(l, x, z, radius);
            y = plane.y - rule.sink * scale;
            slope = plane.slope;
          }
          const placed: Placement = { rule: rule.id, variant, x, y, z, yaw, scale, radius, slope, region: regionAt(t, x, z) };
          mine.push(placed);
          taken.add({ x, z, radius });
        }
    }
    out.push(...mine);
  }
  return out;
}
