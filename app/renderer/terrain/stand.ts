// What stands on a freshly baked world, worked out from plain data: each
// building's site and leveled pad, the landmarks' sites, the trails between
// them leveled into the ground, the trees and the stones, bushes and flowers
// that stand for code kept off all of these, and the wild land's ring; and who owns each cell's ground, whose
// vitality the ground shows. It levels the lattice and says how
// (`Stand.edits`), so a tile of the land baked alone is leveled the same.
// No Three.js and no DOM: the bake worker runs it, and the same terrain and
// request give the same stand on any thread.

import { type Blueprint, type BuildingPlan, type Built, type Library, type RouteSpec, rand, seedOf } from "@gaia/schema";
import { areaVitality } from "@gaia/world";
import { type BuildingSite, type Capsule, type Circle, clearingsOf, discOf, type EdgeStone, edgeStones, type Extent, findBankSite, findLandmarkSite, findSite, regionAt, groundedBase, heightAt, isWet, type LandEdits, type LandmarkSite, type LandSite, levelPad, levelTrails, type Occupied, type OwnedSite, type PadEdit, type Placement, PLANT_SLOPE, planTrails, scatterPlants, siteAt, siteToWorld, slopeAt, type Terrain, trailDiscs, type TrailEnd, type TrailNetwork, type TrailRequest, type WayEdit, wildsRing, type WildsRing } from "@gaia/terrain";

/** A building to site: its plan, what stands beside it, the name its trails go by, and whether it stands on a stream's bank. */
export interface StandBuilding {
  readonly name: string;
  readonly plan: BuildingPlan;
  readonly beside: Extent | null;
  /** Where its feature turns, for a building whose feature needs running water (`needsBank`): it stands on the bank of its area's stream, its wheel in the water (`findBankSite`). */
  readonly wheel?: Extent | null;
}

/** Whether a building's feature needs running water, so the building stands on a stream's bank. */
export function needsBank(blueprint: Blueprint, lib: Library): boolean {
  const use = blueprint.slots.feature?.use;
  return use !== undefined && (lib.get(use).needs ?? []).includes("running water");
}

/** A landmark's name and how far its footprint reaches at the ground, meters. */
export interface StandLandmark {
  readonly name: string;
  readonly base: number;
}

/** A building's or landmark's lot from a world's layout: the ground kept for it, named by its entity's path. */
export interface StandLot extends Circle {
  readonly id: string;
}

/** One file's patch: its middle and how far its ground reaches. */
export type StandPatch = Circle;

/** The rule of a symbol that stands as a building or a landmark, one of the world's things: the symbols stand none of it. */
export const AS_THING = "thing";

/** A definition, a file or an entity standing as a tree or as one of the understory's blueprints; or, by `AS_THING`, as one of the world's things. */
export interface StandSymbol {
  readonly x: number;
  readonly z: number;
  /** The understory rule and variant it stands as, or "trees" and the flora preset of the tree it stands as. */
  readonly rule: string;
  readonly variant: number;
  /** Its footprint's radius at scale 1, meters (a tree's comes from its crown), and its scale. */
  readonly radius: number;
  readonly scale: number;
  /** Its own vitality. */
  readonly vitality: number;
  /** Its file's patch, by index into `StandCode.patches`: it never stands off it. */
  readonly patch?: number;
}

/**
 * A world laid out from code (`layoutWorld` in @gaia/world): each building
 * and landmark on its entity's lot, each definition on its file's patch as
 * a tree or as part of the understory, and the trails Jev wants between
 * entities. Without it, the sample world's
 * rules place everything.
 */
export interface StandCode {
  /** Each building's lot, in the order of `buildings`. */
  readonly lots: readonly StandLot[];
  /** Each landmark standing for a thing: which of `landmarks`, on which lot. */
  readonly landmarks: readonly { readonly landmark: number; readonly lot: StandLot }[];
  /** Each entity standing as neither a building nor a landmark, by its path: its trails end at its lot's middle. */
  readonly places?: readonly StandLot[];
  readonly patches: readonly StandPatch[];
  /**
   * The land's cells, each part of one patch (its index) or of a lot (-1): a definition stands only on its own patch's cells.
   * `area` indexes the world's areas: the directory whose ground the cell is.
   */
  readonly cells: readonly (LandSite & { readonly patch: number; readonly area: number })[];
  readonly symbols: readonly StandSymbol[];
  /** Trails between lots by id, each with its own route as Jev composed it; the most wanted route first. */
  readonly trails: readonly { readonly from: string; readonly to: string; readonly want: number; readonly style: RouteSpec }[];
}

export interface StandRequest {
  readonly buildings: readonly StandBuilding[];
  /** The landmarks a world may stand; a world with more rises than kinds repeats them. */
  readonly landmarks: readonly StandLandmark[];
  /** The lab's own trail looks, for a world written by hand: between landmarks, from a building's door, and for a loop. A codebase's trails carry their own (`StandCode.trails`). */
  readonly trailStyles: readonly [RouteSpec, RouteSpec, RouteSpec];
  /** How many trees, the scatter's seed, and each build's trunk and crown radius by build: tree i copies a build chosen from i. */
  readonly trees: { readonly count: number; readonly seed: number; readonly presets: number; readonly builds: number; readonly bases: readonly number[]; readonly crowns: readonly number[] };
  readonly code?: StandCode;
}

/** Where one tree stands and which build it copies; `index` is its place among the trees. */
export interface StandTree {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly variant: number;
  readonly scale: number;
  readonly yaw: number;
  /** In a world laid out from code, the definition it stands for, by index into `StandCode.symbols`. */
  readonly symbol?: number;
}

/** A landmark standing on its site; `landmark` indexes the request's landmarks, and `id` is the place its trails name. */
export interface StandingLandmark {
  readonly landmark: number;
  readonly id: string;
  readonly site: LandmarkSite;
}

export interface Stand {
  /** Each building's site, in the request's order. */
  readonly sites: readonly BuildingSite[];
  readonly landmarks: readonly StandingLandmark[];
  /** The paths: the ways of tread, the trails (dependencies) walking them, the junctions and any trail dropped, with why. */
  readonly network: TrailNetwork;
  readonly trees: readonly StandTree[];
  /** Each symbol standing as a stone, a bush or flowers: nothing else stands among them. */
  readonly placements: readonly Placement[];
  /** In a world laid out from code, each symbol's placement in `placements`, or -1 where it stands as a tree or nothing could stand. */
  readonly symbols: readonly number[];
  readonly wilds: WildsRing;
  /** Each way's edging stones, in the order of `network.ways`, set on the stood land, which only the bake's thread holds whole. */
  readonly edging: readonly (readonly EdgeStone[])[];
  /** What standing did to the land, in order, so a tile of it baked alone can be leveled the same (`standTile` in @gaia/terrain). */
  readonly edits: LandEdits;
  /** Milliseconds each step of standing took: the buildings' sites, the landmarks and trails, the trees, the symbols, and the wild ring with the edging stones. */
  readonly took: Readonly<Record<string, number>>;
  /** Each building whose feature needs running water that found no stream's bank to stand on, by name: none in any world the tests know. */
  readonly dry: readonly string[];
}

/** How far a landmark reaches at the ground: its standing pieces within a meter of it, at most 10 m. Fallen stone that grows in at its foot is walked over, so it does not count. */
export function landmarkBase(built: Pick<Built, "parts">): number {
  let base = 1;
  for (const part of built.parts) {
    for (let k = 0; k < part.positions.length; k += 3) {
      if ((part.channels.grow?.[k / 3] ?? 0) > 0) continue;
      if ((part.positions[k + 1] as number) < 1) base = Math.max(base, Math.hypot(part.positions[k] as number, part.positions[k + 2] as number));
    }
  }
  return Math.min(base, 10);
}

/**
 * Who owns each cell's ground (`groundOwners` in @gaia/terrain): a file's
 * patch by its index, or an area's own ground (a lot) as the number of
 * patches plus its area's index, so the ground takes its file's vitality or,
 * on a lot, its area's.
 */
export function groundSites(code: Pick<StandCode, "cells" | "patches">): OwnedSite[] {
  return code.cells.map((c) => ({ x: c.x, z: c.z, ...(c.reach === undefined ? {} : { reach: c.reach }), owner: c.patch >= 0 ? c.patch : code.patches.length + c.area }));
}

/**
 * Each owner's vitality, numbered as `groundSites` numbers them: on its
 * ground (a file's own, or on a lot its area's, every file under the area
 * pooled by size: `areaVitality` in @gaia/world), and on the water of the
 * area its ground lies in, which follows that area's pooled vitality.
 */
export function ownerVitality(
  world: { readonly patches: readonly { readonly path: string; readonly area: string; readonly radius: number }[]; readonly areas: readonly { readonly path: string }[] },
  vitalityOf: (file: string) => number,
): { ground: Float32Array; area: Float32Array } {
  const pooled = areaVitality(world.patches.map((p) => ({ area: p.area, vitality: vitalityOf(p.path), size: p.radius * p.radius })));
  const count = world.patches.length;
  const ground = new Float32Array(count + world.areas.length);
  const area = new Float32Array(count + world.areas.length);
  world.patches.forEach((p, j) => {
    ground[j] = vitalityOf(p.path);
    area[j] = pooled.get(p.area) ?? 1;
  });
  world.areas.forEach((a, k) => {
    ground[count + k] = pooled.get(a.path) ?? 1;
    area[count + k] = pooled.get(a.path) ?? 1;
  });
  return { ground, area };
}

/**
 * The vitality each placement shows, in the order of `Stand.placements`:
 * that of the symbol it stands for (`symbolVitality`, by its index in
 * `StandCode.symbols`), so it follows a live change in vitality.
 */
export function understoryVitality(stand: Pick<Stand, "placements" | "symbols">, symbolVitality: (symbol: number) => number): Float32Array {
  const shown = new Float32Array(stand.placements.length).fill(1);
  stand.symbols.forEach((i, k) => {
    if (i >= 0) shown[i] = symbolVitality(k);
  });
  return shown;
}

/** The middle of a building's door along its front wall, in its own frame. */
const doorOf = (plan: BuildingPlan): number => plan.openings.find((o) => o.kind === "door")?.position[0] ?? 0;

/** Where a person stops to read a building's sign and look at it. */
export function standOf(plan: BuildingPlan, site: BuildingSite): { x: number; z: number } {
  const [x, z] = siteToWorld(site, doorOf(plan) + 0.5, plan.depth / 2 + 6.6);
  return { x, z };
}

/** Where a building's signboard stands, facing anyone coming up its walk. */
export function signOf(plan: BuildingPlan, site: BuildingSite): { x: number; z: number; yaw: number } {
  const [x, z] = siteToWorld(site, doorOf(plan) + 1.35, plan.depth / 2 + 4.9);
  return { x, z, yaw: site.yaw };
}

function local(site: BuildingSite, x: number, z: number): [number, number] {
  const c = Math.cos(site.yaw);
  const s = Math.sin(site.yaw);
  const dx = x - site.x;
  const dz = z - site.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** True where a building's walls or what stands beside it lie within `margin` meters. */
export function blockedBy(b: { readonly plan: BuildingPlan; readonly beside: Extent | null }, site: BuildingSite, x: number, z: number, margin: number): boolean {
  const [lx, lz] = local(site, x, z);
  const inHouse = Math.abs(lx) < b.plan.width / 2 + margin && Math.abs(lz) < b.plan.depth / 2 + margin;
  const e = b.beside;
  return inHouse || (e !== null && lx > e.x0 - margin && lx < e.x1 + margin && lz > e.z0 - margin && lz < e.z1 + margin);
}

/** How far a building's walls and what stands beside it reach from its middle, meters. */
function reachOf(b: { readonly plan: BuildingPlan; readonly beside: Extent | null }): number {
  const house = Math.hypot(b.plan.width, b.plan.depth) / 2;
  const e = b.beside;
  return e === null ? house : Math.max(house, Math.hypot(Math.max(-e.x0, e.x1), Math.max(-e.z0, e.z1)));
}

/** Ground under a building, along its walk and under what stands beside it, where nothing grows. */
export function buildingClearings(b: { readonly plan: BuildingPlan; readonly beside: Extent | null }, site: BuildingSite): Capsule[] {
  const out = clearingsOf(b.plan, site);
  const e = b.beside;
  if (e !== null) {
    const wide = e.x1 - e.x0 >= e.z1 - e.z0;
    const r = Math.min(e.x1 - e.x0, e.z1 - e.z0) / 2 + 0.3;
    const cx = (e.x0 + e.x1) / 2;
    const cz = (e.z0 + e.z1) / 2;
    const run = Math.abs(e.x1 - e.x0 - (e.z1 - e.z0)) / 2;
    const [ax, az] = siteToWorld(site, wide ? cx - run : cx, wide ? cz : cz - run);
    const [bx, bz] = siteToWorld(site, wide ? cx + run : cx, wide ? cz : cz + run);
    out.push({ ax, az, bx, bz, radius: r });
  }
  return out;
}

/** The landmarks a world of `regions` regions stands: a few, more for more regions. */
const landmarkCount = (regions: number): number => Math.min(regions, Math.max(2, Math.round(Math.sqrt(regions) * 1.4)));

/** How far trees keep from a landmark's middle: a great tree's crown needs room. */
/** The sizes a crowded definition tries, largest first, before it is left out: its own, then a little smaller. */
const SHRINKS = [1, 0.75, 0.55] as const;

const treeClearance = (lm: StandLandmark): number => lm.base + (lm.name.startsWith("Great") ? 12 : 5);

/**
 * Picks landmark sites on regions spread apart, farthest first from the
 * buildings and then from every landmark placed, plans the trails Jev would
 * want between every place (a spanning tree by distance, then a loop or two)
 * and levels their treads into the ground.
 */
function settleWays(t: Terrain, req: StandRequest, sites: readonly BuildingSite[]): { landmarks: StandingLandmark[]; network: TrailNetwork; ways: WayEdit[] } {
  const homes = req.buildings.map((b, i) => ({ ...b, site: sites[i] as BuildingSite }));
  const around = (b: (typeof homes)[number], margin: number): Occupied => ({ x: b.site.x, z: b.site.z, radius: Math.hypot(b.plan.width, b.plan.depth) / 2 + margin });
  const door = (b: (typeof homes)[number]): TrailEnd => ({ id: b.name, ...standOf(b.plan, b.site) });
  const regions = t.spec.regions;
  const want = req.landmarks.length === 0 ? 0 : landmarkCount(regions.length);
  const spacing = t.spec.size * 0.24;
  const placed: StandingLandmark[] = [];
  const avoid: Occupied[] = homes.map((b) => around(b, 22));
  const taken = new Set<number>();
  while (placed.length < want && taken.size < regions.length) {
    let pick = -1;
    let far = -1;
    regions.forEach((r, i) => {
      if (taken.has(i)) return;
      const d = Math.min(...homes.map((b) => Math.hypot(r.x - b.site.x, r.z - b.site.z)), ...placed.map((s) => Math.hypot(r.x - s.site.x, r.z - s.site.z)));
      if (d > far) {
        far = d;
        pick = i;
      }
    });
    taken.add(pick);
    const k = placed.length % req.landmarks.length;
    const lm = req.landmarks[k] as StandLandmark;
    const site = findLandmarkSite(t, pick, lm.base + 1.5, avoid);
    if (site === null) continue;
    placed.push({ landmark: k, id: `${lm.name} ${placed.length + 1}`, site });
    avoid.push({ x: site.x, z: site.z, radius: spacing });
  }
  const places: TrailEnd[] = [...homes.map(door), ...placed.map((s) => ({ id: s.id, x: s.site.x, z: s.site.z }))];
  const foot = (p: TrailEnd, toward: TrailEnd, i: number): TrailEnd => {
    if (i < homes.length) return p;
    const lm = req.landmarks[placed[i - homes.length]?.landmark ?? 0];
    const d = Math.hypot(toward.x - p.x, toward.z - p.z) || 1;
    const r = (lm?.base ?? 2) + 1.8;
    return { id: p.id, x: p.x + ((toward.x - p.x) / d) * r, z: p.z + ((toward.z - p.z) / d) * r };
  };
  const edges: [number, number, number][] = [];
  for (let a = 0; a < places.length; a++) for (let b = a + 1; b < places.length; b++) edges.push([a, b, Math.hypot(places[a]!.x - places[b]!.x, places[a]!.z - places[b]!.z)]);
  edges.sort((p, q) => p[2] - q[2]);
  const group = places.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i] as number)));
  const requests: TrailRequest[] = [];
  let loops = 0;
  for (const [a, b] of edges) {
    const joined = root(a) !== root(b);
    if (!joined && loops >= Math.floor(places.length / 3)) continue;
    if (joined) group[root(a)] = root(b);
    else loops++;
    const pa = places[a] as TrailEnd;
    const pb = places[b] as TrailEnd;
    const style = joined ? (a < homes.length ? req.trailStyles[1] : req.trailStyles[0]) : req.trailStyles[2];
    requests.push({ id: `${pa.id}->${pb.id}`, from: foot(pa, pb, a), to: foot(pb, pa, b), style, want: joined ? 0.9 - requests.length * 0.02 : 0.45 });
  }
  const keepOut: Occupied[] = [
    ...homes.map((b) => around(b, 0.6)),
    ...placed.map((s) => ({ x: s.site.x, z: s.site.z, radius: (req.landmarks[s.landmark]?.base ?? 2) + 0.8 })),
  ];
  const network = planTrails(t, requests, 41, keepOut);
  return { landmarks: placed, network, ways: levelTrails(t, network.ways) };
}

/**
 * A world laid out from code: each building on its lot, each landmark on
 * its lot, and the trails Jev wants between them, leveled into the ground.
 */
function settleCode(t: Terrain, req: StandRequest, code: StandCode, sites: readonly BuildingSite[]): { landmarks: StandingLandmark[]; network: TrailNetwork; ways: WayEdit[] } {
  const homes = req.buildings.map((b, i) => ({ ...b, site: sites[i] as BuildingSite, id: code.lots[i]?.id ?? b.name }));
  const avoid: Occupied[] = homes.map((b) => ({ x: b.site.x, z: b.site.z, radius: reachOf(b) + 2 }));
  const landmarks: StandingLandmark[] = [];
  const ids: string[] = [];
  for (const { landmark, lot } of code.landmarks) {
    const lm = req.landmarks[landmark];
    if (lm === undefined) continue;
    const site = findLandmarkSite(t, 0, lm.base + 1.5, avoid, lot);
    if (site === null) continue;
    landmarks.push({ landmark, id: lot.id, site });
    ids.push(lot.id);
    avoid.push({ x: site.x, z: site.z, radius: lm.base + 2 });
  }
  // A trail ends at a building's door, at a landmark's foot facing the mean way to its trails' other ends, one spot per
  // place so they share it, or for an entity that stands as neither, at its lot's middle.
  const end = (id: string, toward: { x: number; z: number } | null): TrailEnd | null => {
    const home = homes.find((b) => b.id === id);
    if (home !== undefined) return { id, ...standOf(home.plan, home.site) };
    const k = ids.indexOf(id);
    const s = landmarks[k];
    if (s === undefined) {
      const place = code.places?.find((p) => p.id === id);
      return place === undefined ? null : { id, x: place.x, z: place.z };
    }
    if (toward === null) return { id, x: s.site.x, z: s.site.z };
    const d = Math.hypot(toward.x - s.site.x, toward.z - s.site.z) || 1;
    const r = (req.landmarks[s.landmark]?.base ?? 2) + 1.8;
    return { id, x: s.site.x + ((toward.x - s.site.x) / d) * r, z: s.site.z + ((toward.z - s.site.z) / d) * r };
  };
  const toward = new Map<string, { x: number; z: number }>();
  for (const w of code.trails) {
    const a = end(w.from, null);
    const b = end(w.to, null);
    if (a === null || b === null) continue;
    for (const [p, q] of [[a, b], [b, a]] as const) {
      const d = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const s = toward.get(p.id) ?? { x: 0, z: 0 };
      toward.set(p.id, { x: s.x + (q.x - p.x) / d, z: s.z + (q.z - p.z) / d });
    }
  }
  const spot = (id: string): TrailEnd | null => {
    const at = end(id, null);
    const dir = toward.get(id);
    return at === null || dir === undefined ? at : end(id, { x: at.x + dir.x, z: at.z + dir.z });
  };
  const requests: TrailRequest[] = code.trails.flatMap((w) => {
    const from = spot(w.from);
    const to = spot(w.to);
    if (from === null || to === null) return [];
    return [{ id: `${w.from}->${w.to}`, from, to, style: w.style, want: w.want }];
  });
  const keepOut: Occupied[] = [
    ...homes.map((b) => ({ x: b.site.x, z: b.site.z, radius: Math.hypot(b.plan.width, b.plan.depth) / 2 + 0.6 })),
    ...landmarks.map((s) => ({ x: s.site.x, z: s.site.z, radius: (req.landmarks[s.landmark]?.base ?? 2) + 0.8 })),
  ];
  const network = planTrails(t, requests, 41, keepOut);
  return { landmarks, network, ways: levelTrails(t, network.ways) };
}

/** Fewest meters between trunks, whatever the crowns. */
const TRUNK_GAP = 4.5;

/** Stands everything on a finished bake, leveling the lattice under the buildings and the trails first. */
export function standWorld(t: Terrain, req: StandRequest): Stand {
  const took: Record<string, number> = {};
  let since = performance.now();
  const mark = (step: string): void => {
    const now = performance.now();
    took[step] = Math.round(now - since);
    since = now;
  };
  const code = req.code;
  const sites: BuildingSite[] = [];
  const pads: PadEdit[] = [];
  const dry: string[] = [];
  req.buildings.forEach((b, i) => {
    const lot = code?.lots[i] ?? null;
    let site: BuildingSite = findSite(t, b.plan, sites, 30, b.beside, lot, pads);
    // A building whose wheel needs running water stands on the bank of its own area's stream.
    if (b.wheel !== undefined && b.wheel !== null && b.beside !== null) {
      const bank = findBankSite(t, b.plan, b.beside, b.wheel, regionAt(t.spec, lot?.x ?? site.x, lot?.z ?? site.z), sites, lot, pads);
      if (bank === null) dry.push(b.name);
      else site = bank;
    }
    pads.push(levelPad(t, b.plan, site, b.beside));
    sites.push(site);
  });
  mark("sites");
  const { landmarks, network, ways } = code === undefined ? settleWays(t, req, sites) : settleCode(t, req, code, sites);
  mark("ways");

  // Trees keep off the trails and their cairns, out of the buildings and out from under a landmark.
  const clear: Occupied[] = [...trailDiscs(network, 1.6), ...landmarks.map((s) => ({ x: s.site.x, z: s.site.z, radius: treeClearance(req.landmarks[s.landmark] as StandLandmark) }))];
  const blocked = (x: number, z: number): boolean => req.buildings.some((b, k) => blockedBy(b, sites[k] as BuildingSite, x, z, 6)) || clear.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius);
  const { count, seed, presets, builds, bases, crowns } = req.trees;
  // In a world from code every tree is a definition, stood with the rest of them below.
  const trees: StandTree[] =
    code !== undefined
      ? []
      : scatterPlants(t, count, seed).flatMap((s, i): StandTree[] => {
          if (blocked(s.x, s.z)) return [];
          const variant = (i % presets) * builds + (Math.floor(i / presets) % builds);
          const scale = 0.85 + ((i * 37) % 10) / 22;
          const base = (bases[variant] ?? 0.5) * scale;
          return [{ index: i, x: s.x, y: groundedBase(t.lattice, s.x, s.z, base), z: s.z, variant, scale, yaw: i * 1.7 }];
        });

  mark("trees");
  // No stone, bush or flowers stands in a building, on its walk, on a trail or under a landmark.
  const homes = req.buildings.flatMap((b, k) =>
    buildingClearings(b, sites[k] as BuildingSite).flatMap((c) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(c.bx - c.ax, c.bz - c.az)));
      return Array.from({ length: steps + 1 }, (_, j) => ({ x: c.ax + ((c.bx - c.ax) * j) / steps, z: c.az + ((c.bz - c.az) * j) / steps, radius: c.radius + 0.5 }));
    }),
  );
  const occupied: Occupied[] = [
    ...trees.map((tr) => ({ x: tr.x, z: tr.z, radius: 1.6 })),
    ...homes,
    ...trailDiscs(network, 0.5),
    ...landmarks.map((s) => ({ x: s.site.x, z: s.site.z, radius: (req.landmarks[s.landmark]?.base ?? 2) + 1 })),
  ];
  // A file's definitions stand where the layout put them, kept off water, steep ground and whatever else stands:
  // the largest first, so a file's landmark keeps its plot, each moved a little where its spot is taken (elsewhere
  // on its patch if nothing near is clear, never off it), and stood a size smaller rather than left out. One that
  // stands as a tree keeps its crown's width from every other, so each tree reads as one thing. Where its whole
  // patch lies in that room, under a great tree's crown say, it stands in it: a stone, a bush or flowers under a
  // crown and as near a house, a trail or a landmark as anything stands, a tree under another's crown. Every one
  // stands.
  const standing: Placement[] = [];
  /** The crowns of the trees stood so far, which nothing else that stands for code stands under. */
  const crowned: Occupied[] = [];
  const treeBuild = (sym: StandSymbol): number => sym.variant * builds + Math.floor(rand(seedOf(`tree:${sym.x.toFixed(2)},${sym.z.toFixed(2)}`)).next() * builds);
  const crownOf = (sym: StandSymbol): number => Math.max(TRUNK_GAP / 2, (crowns[treeBuild(sym)] ?? 4) * 0.55);
  const footprint = (sym: StandSymbol): number => (sym.rule === "trees" ? crownOf(sym) : sym.radius) * sym.scale;
  const syms = code?.symbols ?? [];
  const cells = code?.cells ?? [];
  const symbols = syms.map(() => -1);
  const order = syms.map((_, i) => i).sort((a, b) => footprint(syms[b] as StandSymbol) - footprint(syms[a] as StandSymbol) || a - b);
  for (const i of order) {
    const sym = syms[i] as StandSymbol;
    if (sym.rule === AS_THING) continue;
    const tree = sym.rule === "trees";
    let at: [number, number, number] | null = null;
    // Where it may try: around its plot's middle, then around each of its patch's other cells, nearest first.
    const own = sym.patch === undefined || cells.length === 0 ? [] : cells.filter((c) => c.patch === sym.patch).sort((a, b) => Math.hypot(a.x - sym.x, a.z - sym.z) - Math.hypot(b.x - sym.x, b.z - sym.z));
    for (const crowded of [false, true]) {
      for (const from of [{ x: sym.x, z: sym.z }, ...own]) {
        for (const shrink of SHRINKS) {
          const reach = footprint(sym) * shrink;
          const clash = (x: number, z: number): boolean =>
            (sym.patch !== undefined && cells.length > 0 && cells[siteAt(cells, x, z)]?.patch !== sym.patch) ||
            isWet(t, x, z) ||
            slopeAt(t.lattice, x, z) > (tree ? PLANT_SLOPE : 24) ||
            ((!crowded || tree) && blocked(x, z)) ||
            occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + reach) ||
            (!crowded && crowned.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + reach));
          for (let k = 0; at === null && k <= 24; k++) {
            const a = k * 2.4;
            const x = from.x + Math.cos(a) * k * 0.6;
            const z = from.z + Math.sin(a) * k * 0.6;
            if (!clash(x, z)) at = [x, z, shrink];
          }
          if (at !== null) break;
        }
        if (at !== null) break;
      }
      if (at !== null) break;
    }
    // With no room anywhere on its patch even so, it stands where the layout put it, at its smallest.
    const [x, z, shrink] = at ?? [sym.x, sym.z, SHRINKS[SHRINKS.length - 1] as number];
    const scale = sym.scale * shrink;
    const reach = footprint(sym) * shrink;
    if (tree) {
      // Nothing else that stands for code stands under a tree's crown.
      const variant = treeBuild(sym);
      trees.push({ index: trees.length, x, y: groundedBase(t.lattice, x, z, (bases[variant] ?? 0.5) * scale), z, variant, scale, yaw: (i * 2.399) % (Math.PI * 2), symbol: i });
      occupied.push({ x, z, radius: 1.6 });
      crowned.push({ x, z, radius: reach });
      continue;
    }
    occupied.push({ x, z, radius: reach + 0.4 });
    standing.push({ rule: sym.rule, variant: sym.variant, x, y: heightAt(t.lattice, x, z) - 0.05, z, yaw: (i * 2.399) % (Math.PI * 2), scale, radius: reach, vitality: sym.vitality });
    symbols[i] = standing.length - 1;
  }
  mark("symbols");
  const wilds = wildsRing(t);
  const edging = network.ways.map((way) => edgeStones(t, way, seedOf(`${way.id}/edging`)));
  mark("wilds");
  return { sites, landmarks, network, trees, placements: standing, symbols, wilds, edging, edits: { pads, discs: landmarks.map((s) => discOf(s.site)), ways }, took, dry };
}
