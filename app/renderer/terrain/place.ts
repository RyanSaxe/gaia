// Places everything on a freshly baked world from plain data: each building's
// site and leveled pad, the landmarks' sites, the trails leveled into the
// ground, and the code's trees, stones, bushes and flowers clear of all of
// these. It records how it leveled the lattice (`Placed.edits`), so a tile
// baked alone is leveled the same. It uses no Three.js or DOM, because the
// bake worker runs it, and the same terrain and request give the same result
// on any thread.

import { type Blueprint, type BuildingPlan, type Built, type Library, type RouteSpec, seedOf } from "@gaia/schema";
import { areaVitality } from "@gaia/world";
import { type BuildingSite, type Capsule, type Circle, clearingsOf, discOf, type EdgeStone, edgeStones, type Extent, findBankSite, findLandmarkSite, findSite, regionAt, groundedBase, groundSlope, heightAt, isWet, type LandEdits, type LandmarkSite, type LandSite, levelPad, levelTrails, type Occupied, type OwnedSite, type PadEdit, type Placement, PLANT_SLOPE, planTrails, siteAt, siteToWorld, slopeAt, type Terrain, trailDiscs, type TrailEnd, type TrailNetwork, type TrailRequest, type WayEdit, waterDepthAt } from "@gaia/terrain";

/** A building to site: its plan, what is beside it, the name its trails use, and its wheel if it needs a stream's bank. */
export interface BuildingToPlace {
  readonly name: string;
  readonly plan: BuildingPlan;
  readonly beside: Extent | null;
  /**
   * The extent of its turning feature, for a building whose feature needs running water (`needsBank`). The building
   * goes on the bank of its area's stream with its wheel in the water (`findBankSite`).
   */
  readonly wheel?: Extent | null;
}

/** Whether a building's feature needs running water, which puts the building on a stream's bank. */
export function needsBank(blueprint: Blueprint, lib: Library): boolean {
  const use = blueprint.slots.feature?.use;
  return use !== undefined && (lib.get(use).needs ?? []).includes("running water");
}

/** A landmark's ground radius in meters, and whether it is a great tree, whose crown other trees keep clear of. */
export interface LandmarkToPlace {
  readonly base: number;
  readonly tree: boolean;
}

/** A building's or landmark's lot from the layout: the ground reserved for it, with its entity's path as `id`. */
export interface LayoutLot extends Circle {
  readonly id: string;
}

/** One file's patch: its center and radius. */
export type LayoutPatch = Circle;

/** The `rule` of a symbol that appears as a building or landmark, one of the world's things. `placeWorld` skips these symbols. */
export const AS_THING = "thing";

/** A definition, file or entity that appears as a tree or an understory blueprint, or, with `AS_THING`, as one of the world's things. */
export interface LayoutSymbol {
  readonly x: number;
  readonly z: number;
  /** Its plant group and build index in that group (`OpenedWorld.plants`), or `AS_THING` for a building or landmark. */
  readonly rule: string;
  readonly variant: number;
  /** Its footprint radius at scale 1 in meters, and its scale. `placeWorld` sizes a tree's footprint from its crown instead. */
  readonly radius: number;
  readonly scale: number;
  readonly vitality: number;
  /** Its file's patch, by index into `CodeLayout.patches`. It is never placed off that patch. */
  readonly patch?: number;
}

/**
 * A world laid out from code (`layoutWorld` in @gaia/world): each building
 * and landmark on its entity's lot, each definition on its file's patch as a
 * tree or understory, and the trails Jev chose between entities.
 */
export interface CodeLayout {
  /** Each building's lot, in the order of `buildings`. */
  readonly lots: readonly LayoutLot[];
  /** Each landmark that represents a thing: its index in `landmarks` and its lot. */
  readonly landmarks: readonly { readonly landmark: number; readonly lot: LayoutLot }[];
  /** Each entity that appears as neither a building nor a landmark, by path. Its trails end at its lot's center. */
  readonly places?: readonly LayoutLot[];
  readonly patches: readonly LayoutPatch[];
  /**
   * The land's cells. `patch` is the cell's patch index, or -1 for a lot, and a definition goes only on its own patch's
   * cells. `area` indexes the world's areas, the directory the cell's ground belongs to.
   */
  readonly cells: readonly (LandSite & { readonly patch: number; readonly area: number })[];
  readonly symbols: readonly LayoutSymbol[];
  /** Trails between lots by id, each with the route Jev composed for it, most wanted first. */
  readonly trails: readonly { readonly from: string; readonly to: string; readonly want: number; readonly style: RouteSpec }[];
}

export interface PlaceRequest {
  readonly buildings: readonly BuildingToPlace[];
  /** Each landmark Jev composed, in the order `CodeLayout.landmarks` names them. */
  readonly landmarks: readonly LandmarkToPlace[];
  /** Each tree build's trunk and crown radius, by variant. A tree copies its blueprint's single build. */
  readonly trees: { readonly bases: readonly number[]; readonly crowns: readonly number[] };
  readonly code: CodeLayout;
}

/** One tree's position and the build it copies. `index` is its position in `Placed.trees`. */
export interface PlacedTree {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly variant: number;
  readonly scale: number;
  readonly yaw: number;
  /** The ground's slope under it, dy/dx and dy/dz, passed to its copy (`Placement.slope`). */
  readonly slope: readonly [number, number];
  /** The symbol it represents, by index into `CodeLayout.symbols`. */
  readonly symbol: number;
}

/** A landmark placed on its site. `landmark` indexes the request's landmarks, and `id` is the place its trails name. */
export interface PlacedLandmark {
  readonly landmark: number;
  readonly id: string;
  readonly site: LandmarkSite;
}

export interface Placed {
  /** Each building's site, in the request's order. */
  readonly sites: readonly BuildingSite[];
  readonly landmarks: readonly PlacedLandmark[];
  /** The paths: the ways of tread, the dependency trails that use them, the junctions, and each dropped trail with its reason. */
  readonly network: TrailNetwork;
  readonly trees: readonly PlacedTree[];
  /** A placement for each symbol that appears as a stone, bush or flowers, and nothing else. */
  readonly placements: readonly Placement[];
  /** Each symbol's index in `placements`, or -1 for a tree or a world thing (`AS_THING`). */
  readonly symbols: readonly number[];
  /** Each way's edging stones, in the order of `network.ways`, set on the leveled land, which only the bake thread has in full. */
  readonly edging: readonly (readonly EdgeStone[])[];
  /** The leveling edits in order, so a tile baked alone can be leveled the same (`bakeEditedTile` in @gaia/terrain). */
  readonly edits: LandEdits;
  /** Milliseconds each step took: the buildings' sites, the landmarks and trails, the symbols and the edging stones. */
  readonly took: Readonly<Record<string, number>>;
  /** The names of buildings that need running water but found no stream bank. No test world has one. */
  readonly dry: readonly string[];
}

/**
 * A landmark's ground radius: the farthest vertex lower than 1 m, at least 1 m. For the largest massive great span
 * it is about 31 m. Fallen stone that grows in at its foot is walked over, so it does not count.
 */
export function landmarkBase(built: Pick<Built, "parts">): number {
  let base = 1;
  for (const part of built.parts) {
    for (let k = 0; k < part.positions.length; k += 3) {
      if ((part.channels.grow?.[k / 3] ?? 0) > 0) continue;
      if ((part.positions[k + 1] as number) < 1) base = Math.max(base, Math.hypot(part.positions[k] as number, part.positions[k + 2] as number));
    }
  }
  return base;
}

/**
 * The radius of the ground a landmark reserves on its lot, a little wider than its `landmarkBase`. Its site is where
 * that disc overlaps neither another landmark's nor a house's ground.
 */
export const landmarkGround = (base: number): number => base + 1.5;

/** The radius around a house that no landmark's ground may enter, 2 m past its walls and what is beside it. */
export const houseGround = (b: { readonly plan: BuildingPlan; readonly beside: Extent | null }): number => reachOf(b) + 2;

/**
 * Where a landmark meets the ground, in its own frame: a disc around each solid piece that touches the ground, such as
 * a step, a stone, a foot, a tower's lowest blocks or a great tree's roots, centered on that piece's footing. A disc
 * inside a larger one is dropped. The grass is cleared under each, however far the landmark reaches. Fallen stone that
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
 * The owner of each cell's ground (`groundOwners` in @gaia/terrain): a
 * file's patch by its index, or a lot as the number of patches plus its
 * area's index. The ground then shows its file's vitality, or on a lot its
 * area's.
 */
export function groundSites(code: Pick<CodeLayout, "cells" | "patches">): OwnedSite[] {
  return code.cells.map((c) => ({ x: c.x, z: c.z, ...(c.reach === undefined ? {} : { reach: c.reach }), owner: c.patch >= 0 ? c.patch : code.patches.length + c.area }));
}

/**
 * Each owner's vitality, numbered as `groundSites` numbers owners. `ground`
 * is a file's own vitality, or for a lot its area's, pooling every file under
 * the area by size (`areaVitality` in @gaia/world). `area` is the pooled
 * vitality of the owner's area, which its water follows.
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
 * The vitality each placement shows, in the order of `Placed.placements`. It
 * is the vitality of the symbol it represents (`symbolVitality`, by index in
 * `CodeLayout.symbols`), so it follows a live change.
 */
export function understoryVitality(placed: Pick<Placed, "placements" | "symbols">, symbolVitality: (symbol: number) => number): Float32Array {
  const shown = new Float32Array(placed.placements.length).fill(1);
  placed.symbols.forEach((i, k) => {
    if (i >= 0) shown[i] = symbolVitality(k);
  });
  return shown;
}

/** The center of a building's door along its front wall, in its own frame. */
const doorOf = (plan: BuildingPlan): number => plan.openings.find((o) => o.kind === "door")?.position[0] ?? 0;

/** Where a person stops to read a building's sign and look at it. */
export function readingSpotOf(plan: BuildingPlan, site: BuildingSite): { x: number; z: number } {
  const [x, z] = siteToWorld(site, doorOf(plan) + 0.5, plan.depth / 2 + 6.6);
  return { x, z };
}

/** Where a building's signboard goes, facing anyone coming up its walk. */
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

/** Whether a building's walls or what is beside it lie within `margin` meters of (x, z). */
export function blockedBy(b: { readonly plan: BuildingPlan; readonly beside: Extent | null }, site: BuildingSite, x: number, z: number, margin: number): boolean {
  const [lx, lz] = local(site, x, z);
  const inHouse = Math.abs(lx) < b.plan.width / 2 + margin && Math.abs(lz) < b.plan.depth / 2 + margin;
  const e = b.beside;
  return inHouse || (e !== null && lx > e.x0 - margin && lx < e.x1 + margin && lz > e.z0 - margin && lz < e.z1 + margin);
}

/** How far in meters a building's walls and what is beside it reach from its center. */
function reachOf(b: { readonly plan: BuildingPlan; readonly beside: Extent | null }): number {
  const house = Math.hypot(b.plan.width, b.plan.depth) / 2;
  const e = b.beside;
  return e === null ? house : Math.max(house, Math.hypot(Math.max(-e.x0, e.x1), Math.max(-e.z0, e.z1)));
}

/** Ground under a building, along its walk and under what is beside it, where nothing grows. */
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

/** The scales a crowded definition tries, largest first: its own, then a little smaller. */
const SHRINKS = [1, 0.75, 0.55] as const;

/** How far trees keep from a landmark's center. A great tree's crown needs more room. */
const treeClearance = (lm: LandmarkToPlace): number => lm.base + (lm.tree ? 12 : 5);

/** How far in meters a trail end moved out of water keeps from it, and the farthest it moves to find such ground. */
const DRY_END = { clearance: 1, reach: 40 } as const;

/**
 * Returns (x, z) when it is dry, or else the nearest point `DRY_END.clearance` clear of water, searching rings a meter
 * apart. Returns (x, z) when no point within `DRY_END.reach` is clear.
 */
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
 * Places each landmark on its lot and routes the trails Jev chose between
 * the sited buildings and the landmarks, leveled into the ground.
 */
function settleCode(t: Terrain, req: PlaceRequest, code: CodeLayout, sites: readonly BuildingSite[]): { landmarks: PlacedLandmark[]; network: TrailNetwork; ways: WayEdit[] } {
  const homes = req.buildings.map((b, i) => ({ ...b, site: sites[i] as BuildingSite, id: code.lots[i]?.id ?? b.name }));
  const avoid: Occupied[] = homes.map((b) => ({ x: b.site.x, z: b.site.z, radius: houseGround(b) }));
  const landmarks: PlacedLandmark[] = [];
  const ids: string[] = [];
  for (const { landmark, lot } of code.landmarks) {
    const lm = req.landmarks[landmark];
    if (lm === undefined) continue;
    const site = findLandmarkSite(t, 0, landmarkGround(lm.base), avoid, lot);
    if (site === null) continue;
    landmarks.push({ landmark, id: lot.id, site });
    ids.push(lot.id);
    avoid.push({ x: site.x, z: site.z, radius: landmarkGround(lm.base) });
  }
  // A trail ends at a building's door, at a landmark's foot on the side facing the mean direction to its trails' other
  // ends, or for an entity that is neither, at its lot's center. Each place has one end spot that its trails share. A
  // foot or lot in water moves to the nearest dry ground, so no trail begins or ends in water.
  const end = (id: string, toward: { x: number; z: number } | null): TrailEnd | null => {
    const home = homes.find((b) => b.id === id);
    if (home !== undefined) return { id, ...readingSpotOf(home.plan, home.site) };
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

/** Places everything on a finished bake, leveling the lattice under the buildings and the trails first. */
export function placeWorld(t: Terrain, req: PlaceRequest): Placed {
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
  // A building whose wheel needs running water goes on the bank of its own area's stream, so it is sited before the
  // others while the banks are free.
  const onBank = (i: number): boolean => {
    const b = req.buildings[i] as BuildingToPlace;
    return b.wheel !== undefined && b.wheel !== null && b.beside !== null;
  };
  const all = [...req.buildings.keys()];
  const taken: BuildingSite[] = [];
  for (const i of [...all.filter(onBank), ...all.filter((i) => !onBank(i))]) {
    const b = req.buildings[i] as BuildingToPlace;
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
  const clear: Occupied[] = [...trailDiscs(network, 1.6), ...landmarks.map((s) => ({ x: s.site.x, z: s.site.z, radius: treeClearance(req.landmarks[s.landmark] as LandmarkToPlace) }))];
  const blocked = (x: number, z: number): boolean => req.buildings.some((b, k) => blockedBy(b, sites[k] as BuildingSite, x, z, 6)) || clear.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius);
  const { bases, crowns } = req.trees;
  // Every tree represents a definition, file or entity, and is placed with the other symbols below.
  const trees: PlacedTree[] = [];
  // No stone, bush or flowers goes in a building, on its walk, on a trail or under a landmark.
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
  // Place a file's definitions where the layout put them, off water, steep ground and everything already placed,
  // largest footprint first. A definition whose spot is taken moves a little, or elsewhere on its patch if nothing
  // near is clear, but never off it, and shrinks a size rather than being left out. A tree keeps its crown's width
  // from every other tree, so each tree reads as one thing. Where the whole patch lies in that room, such as under a
  // great tree's crown, a second pass relaxes the rules: a stone, bush or flowers may go under a crown and near a
  // house, trail or landmark, and a tree under another's crown. Every definition is placed.
  const standing: Placement[] = [];
  /** The crowns of the trees placed so far, which the first pass keeps every other symbol out from under. */
  const crowned: Occupied[] = [];
  const crownOf = (sym: LayoutSymbol): number => Math.max(TRUNK_GAP / 2, (crowns[sym.variant] ?? 4) * 0.55);
  const footprint = (sym: LayoutSymbol): number => (sym.rule === "trees" ? crownOf(sym) : sym.radius) * sym.scale;
  const syms = code.symbols;
  const cells = code.cells;
  const symbols = syms.map(() => -1);
  const order = syms.map((_, i) => i).sort((a, b) => footprint(syms[b] as LayoutSymbol) - footprint(syms[a] as LayoutSymbol) || a - b);
  for (const i of order) {
    const sym = syms[i] as LayoutSymbol;
    if (sym.rule === AS_THING) continue;
    const tree = sym.rule === "trees";
    let at: [number, number, number] | null = null;
    // Try around its plot's center, then around each of its patch's cells, nearest first.
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
    // With no room anywhere on its patch even then, place it where the layout put it, at its smallest scale.
    const [x, z, shrink] = at ?? [sym.x, sym.z, SHRINKS[SHRINKS.length - 1] as number];
    const scale = sym.scale * shrink;
    const reach = footprint(sym) * shrink;
    const slope = groundSlope(t.lattice, x, z);
    if (tree) {
      // Record the crown, which the first pass keeps other symbols out from under.
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
