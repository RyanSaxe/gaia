// What stands on a freshly baked world, worked out from plain data: each
// building's site and leveled pad, the landmarks' sites, the trails between
// them leveled into the ground, and the trees and the stones, bushes and
// flowers that stand for code kept off all of these; and who owns each cell's ground, whose
// vitality the ground shows. It levels the lattice and says how
// (`Stand.edits`), so a tile of the land baked alone is leveled the same.
// No Three.js and no DOM: the bake worker runs it, and the same terrain and
// request give the same stand on any thread.

import { type Blueprint, type BuildingPlan, type Built, type Library, type RouteSpec, seedOf } from "@gaia/schema";
import { areaVitality } from "@gaia/world";
import { type BuildingSite, type Capsule, type Circle, clearingsOf, discOf, type EdgeStone, edgeStones, type Extent, findBankSite, findLandmarkSite, findSite, regionAt, groundedBase, groundSlope, heightAt, isWet, type LandEdits, type LandmarkSite, type LandSite, levelPad, levelTrails, type Occupied, type OwnedSite, type PadEdit, type Placement, PLANT_SLOPE, planTrails, siteAt, siteToWorld, slopeAt, type Terrain, trailDiscs, type TrailEnd, type TrailNetwork, type TrailRequest, type WayEdit, waterDepthAt } from "@gaia/terrain";

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

/** How far a landmark's footprint reaches at the ground, meters, and whether it is a great tree, whose crown trees keep clear of. */
export interface StandLandmark {
  readonly base: number;
  readonly tree: boolean;
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
 * entities.
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
  /** Each landmark Jev composed, in the order `StandCode.landmarks` names them. */
  readonly landmarks: readonly StandLandmark[];
  /** Each tree build's trunk and crown radius, by the variant a tree's symbol names: a tree copies its blueprint's one build. */
  readonly trees: { readonly bases: readonly number[]; readonly crowns: readonly number[] };
  readonly code: StandCode;
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
  /** The ground's slope under it, dy/dx and dy/dz, which its copy takes (`Placement.slope`). */
  readonly slope: readonly [number, number];
  /** What it stands for, by index into `StandCode.symbols`. */
  readonly symbol: number;
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
  /** Each way's edging stones, in the order of `network.ways`, set on the stood land, which only the bake's thread holds whole. */
  readonly edging: readonly (readonly EdgeStone[])[];
  /** What standing did to the land, in order, so a tile of it baked alone can be leveled the same (`standTile` in @gaia/terrain). */
  readonly edits: LandEdits;
  /** Milliseconds each step of standing took: the buildings' sites, the landmarks and trails, the symbols and the edging stones. */
  readonly took: Readonly<Record<string, number>>;
  /** Each building whose feature needs running water that found no stream's bank to stand on, by name: none in any world the tests know. */
  readonly dry: readonly string[];
}

/**
 * How far a landmark reaches at the ground: its standing pieces within a meter of it, at most 25 m, as far as a great
 * span's feet. Fallen stone that grows in at its foot is walked over, so it does not count.
 */
export function landmarkBase(built: Pick<Built, "parts">): number {
  let base = 1;
  for (const part of built.parts) {
    for (let k = 0; k < part.positions.length; k += 3) {
      if ((part.channels.grow?.[k / 3] ?? 0) > 0) continue;
      if ((part.positions[k + 1] as number) < 1) base = Math.max(base, Math.hypot(part.positions[k] as number, part.positions[k + 2] as number));
    }
  }
  return Math.min(base, 25);
}

/**
 * Where a landmark meets the ground, in its own frame: a disc round where each piece it stands on meets the ground
 * (a step, a stone, a foot, a tower's lowest blocks, a great tree's roots), from the middle of that footing, leaving
 * out any disc another holds. The grass is cleared under each, however far the landmark reaches. Fallen stone that
 * grows in does not count.
 */
export function landmarkFeet(built: Pick<Built, "parts">): { readonly x: number; readonly z: number; readonly radius: number }[] {
  const feet: { x: number; z: number; radius: number }[] = [];
  for (const part of built.parts) {
    if (part.collision === "none") continue;
    const pieces = new Map<number, number[]>();
    for (let v = 0; v * 3 < part.positions.length; v++) {
      if ((part.channels.grow?.[v] ?? 0) > 0 || (part.positions[v * 3 + 1] as number) >= 0.3) continue;
      const id = part.piece[v * 2] as number;
      let points = pieces.get(id);
      if (points === undefined) pieces.set(id, (points = []));
      points.push(part.positions[v * 3] as number, part.positions[v * 3 + 2] as number);
    }
    for (const points of pieces.values()) {
      let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let k = 0; k < points.length; k += 2) {
        x0 = Math.min(x0, points[k] as number);
        x1 = Math.max(x1, points[k] as number);
        z0 = Math.min(z0, points[k + 1] as number);
        z1 = Math.max(z1, points[k + 1] as number);
      }
      const x = (x0 + x1) / 2;
      const z = (z0 + z1) / 2;
      let reach = 0;
      for (let k = 0; k < points.length; k += 2) reach = Math.max(reach, Math.hypot((points[k] as number) - x, (points[k + 1] as number) - z));
      feet.push({ x, z, radius: reach + 0.2 });
    }
  }
  feet.sort((a, b) => b.radius - a.radius);
  return feet.filter((f, i) => !feet.some((g, k) => k < i && Math.hypot(f.x - g.x, f.z - g.z) + f.radius <= g.radius));
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

/** The sizes a crowded definition tries, largest first, before it is left out: its own, then a little smaller. */
const SHRINKS = [1, 0.75, 0.55] as const;

/** How far trees keep from a landmark's middle: a great tree's crown needs room. */
const treeClearance = (lm: StandLandmark): number => lm.base + (lm.tree ? 12 : 5);

/** How far a trail's end moved out of water keeps from it, meters, and the farthest it moves to find ground that clear. */
const DRY_END = { clearance: 1, reach: 40 } as const;

/** (x, z) when it is dry, or else the nearest point to it whose ground lies `DRY_END.clearance` clear of water, on rings a meter apart; (x, z) when none within `DRY_END.reach` does. */
function dryNear(t: Terrain, x: number, z: number): { x: number; z: number } {
  if (waterDepthAt(t, x, z) === 0) return { x, z };
  for (let r = 1; r <= DRY_END.reach; r++) {
    const steps = Math.ceil(2 * Math.PI * r);
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      if (!isWet(t, x + Math.cos(a) * r, z + Math.sin(a) * r, DRY_END.clearance)) return { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
    }
  }
  return { x, z };
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
  // place so they share it, or for an entity that stands as neither, at its lot's middle. A foot or a lot in water
  // gives way to the nearest dry ground, so no trail begins or ends in water.
  const end = (id: string, toward: { x: number; z: number } | null): TrailEnd | null => {
    const home = homes.find((b) => b.id === id);
    if (home !== undefined) return { id, ...standOf(home.plan, home.site) };
    const k = ids.indexOf(id);
    const s = landmarks[k];
    if (s === undefined) {
      const place = code.places?.find((p) => p.id === id);
      return place === undefined ? null : { id, ...dryNear(t, place.x, place.z) };
    }
    if (toward === null) return { id, x: s.site.x, z: s.site.z };
    const d = Math.hypot(toward.x - s.site.x, toward.z - s.site.z) || 1;
    const r = (req.landmarks[s.landmark]?.base ?? 2) + 1.8;
    return { id, ...dryNear(t, s.site.x + ((toward.x - s.site.x) / d) * r, s.site.z + ((toward.z - s.site.z) / d) * r) };
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
  // A building whose wheel needs running water stands on the bank of its own area's stream, so it is sited before
  // the others, while the banks are free.
  const onBank = (i: number): boolean => {
    const b = req.buildings[i] as StandBuilding;
    return b.wheel !== undefined && b.wheel !== null && b.beside !== null;
  };
  const all = [...req.buildings.keys()];
  const taken: BuildingSite[] = [];
  for (const i of [...all.filter(onBank), ...all.filter((i) => !onBank(i))]) {
    const b = req.buildings[i] as StandBuilding;
    const lot = code.lots[i] ?? null;
    let site: BuildingSite = findSite(t, b.plan, taken, 30, b.beside, lot, pads);
    if (onBank(i)) {
      const bank = findBankSite(t, b.plan, b.beside as Extent, b.wheel as Extent, regionAt(t.spec, lot?.x ?? site.x, lot?.z ?? site.z), taken, lot, pads);
      if (bank === null) dry.push(b.name);
      else site = bank;
    }
    pads.push(levelPad(t, b.plan, site, b.beside));
    taken.push(site);
    sites[i] = site;
  }
  mark("sites");
  const { landmarks, network, ways } = settleCode(t, req, code, sites);
  mark("ways");

  // Trees keep off the trails and their cairns, out of the buildings and out from under a landmark.
  const clear: Occupied[] = [...trailDiscs(network, 1.6), ...landmarks.map((s) => ({ x: s.site.x, z: s.site.z, radius: treeClearance(req.landmarks[s.landmark] as StandLandmark) }))];
  const blocked = (x: number, z: number): boolean => req.buildings.some((b, k) => blockedBy(b, sites[k] as BuildingSite, x, z, 6)) || clear.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius);
  const { bases, crowns } = req.trees;
  // Every tree is a definition, a file or an entity, stood with the rest of them below.
  const trees: StandTree[] = [];
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
  const crownOf = (sym: StandSymbol): number => Math.max(TRUNK_GAP / 2, (crowns[sym.variant] ?? 4) * 0.55);
  const footprint = (sym: StandSymbol): number => (sym.rule === "trees" ? crownOf(sym) : sym.radius) * sym.scale;
  const syms = code.symbols;
  const cells = code.cells;
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
    const slope = groundSlope(t.lattice, x, z);
    if (tree) {
      // Nothing else that stands for code stands under a tree's crown.
      const variant = sym.variant;
      trees.push({ index: trees.length, x, y: groundedBase(t.lattice, x, z, (bases[variant] ?? 0.5) * scale), z, variant, scale, yaw: (i * 2.399) % (Math.PI * 2), slope, symbol: i });
      occupied.push({ x, z, radius: 1.6 });
      crowned.push({ x, z, radius: reach });
      continue;
    }
    occupied.push({ x, z, radius: reach + 0.4 });
    standing.push({ rule: sym.rule, variant: sym.variant, x, y: heightAt(t.lattice, x, z) - 0.05, z, yaw: (i * 2.399) % (Math.PI * 2), scale, radius: reach, vitality: sym.vitality, slope });
    symbols[i] = standing.length - 1;
  }
  mark("symbols");
  const edging = network.ways.map((way) => edgeStones(t, way, seedOf(`${way.id}/edging`)));
  mark("edging");
  return { sites, landmarks, network, trees, placements: standing, symbols, edging, edits: { pads, discs: landmarks.map((s) => discOf(s.site)), ways }, took, dry };
}
