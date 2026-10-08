// What stands on a freshly baked world, worked out from plain data: each
// building's site and leveled pad, the landmarks' sites, the trails between
// them leveled into the ground, the trees and the understory kept off all of
// these, the wild land's ring, and the ground texture's data with the trail
// field in its fourth channel. It levels the lattice, so it runs before the
// ground is packed. No Three.js and no DOM: the bake worker runs it, and the
// same terrain and request give the same stand on any thread.

import { type BuildingPlan, type RouteSpec, rand } from "@gaia/schema";
import {
  type BuildingSite,
  type Capsule,
  type Circle,
  PLANT_SLOPE,
  type Extent,
  type LandmarkSite,
  type Occupied,
  type Placement,
  type ScatterRule,
  type Terrain,
  type TrailEnd,
  type TrailNetwork,
  type TrailRequest,
  type WildsRing,
  type LandSite,
  type Habitat,
  growGrove,
  trunkIndex,
  clearingsOf,
  findLandmarkSite,
  findSite,
  groundedBase,
  heightAt,
  isWet,
  levelPad,
  levelTrails,
  planTrails,
  scatterComponents,
  scatterPlants,
  siteToWorld,
  siteAt,
  slopeAt,
  trailDiscs,
  trailField,
  trailPlaces,
  wildsRing,
} from "@gaia/terrain";

/** A building to site: its plan, what stands beside it, and the name its trails go by. */
export interface StandBuilding {
  readonly name: string;
  readonly plan: BuildingPlan;
  readonly beside: Extent | null;
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

/** One file's patch: its heart and how far its ground reaches, and how many trees of which flora preset grow on it (preset -1: none), as one grove. */
export interface StandPatch extends Circle {
  readonly trees: number;
  readonly preset: number;
  /** Where its grove gathers: the patch's middle, or, where an area's groves knit into one wood, its side nearest the area's heart. */
  readonly heart: { readonly x: number; readonly z: number };
  /** Trunks this many crown widths apart at the grove's heart; they thin toward its margin. */
  readonly closeness: number;
  /** How far from its heart the grove may reach, meters. */
  readonly reach: number;
  /** How large its trees grow, a multiplier: a meadow's lone old trees stand larger. */
  readonly stature: number;
  /** Seeds its trees, from its file's path, so a change elsewhere never moves them. */
  readonly seed: number;
}

/** A file's finer entity standing on its patch, as one of the understory's blueprints. */
export interface StandSymbol {
  readonly x: number;
  readonly z: number;
  /** The understory rule and variant it stands as. */
  readonly rule: string;
  readonly variant: number;
  /** Its footprint's radius at scale 1, meters, and its scale. */
  readonly radius: number;
  readonly scale: number;
  /** Its file's vitality. */
  readonly vitality: number;
}

/**
 * A world laid out from code (`layoutWorld` in @gaia/world): each building
 * and landmark on its entity's lot, the trees on their files' patches, and
 * the trails Jev wants between entities. Without it, the sample world's
 * rules place everything.
 */
export interface StandCode {
  /** Each building's lot, in the order of `buildings`. */
  readonly lots: readonly StandLot[];
  /** Each landmark standing for an entity: which of `landmarks`, on which lot. */
  readonly landmarks: readonly { readonly landmark: number; readonly lot: StandLot }[];
  readonly patches: readonly StandPatch[];
  /** The land's cells, each part of one patch (its index) or of a lot (-1): a tree grows only on its own patch's cells. */
  readonly cells: readonly (LandSite & { readonly patch: number })[];
  readonly symbols: readonly StandSymbol[];
  /** Per terrain region: how much of each understory rule it holds (by rule id; absent counts 1), and what its open ground reads as. */
  readonly regions: readonly { readonly understory: Readonly<Record<string, number>>; readonly open?: Habitat }[];
  /** Trails between lots by id; `style` indexes `trailStyles`; the most wanted route first. */
  readonly trails: readonly { readonly from: string; readonly to: string; readonly want: number; readonly style: number }[];
}

export interface StandRequest {
  readonly buildings: readonly StandBuilding[];
  /** The landmarks a world may stand; a world with more rises than kinds repeats them. */
  readonly landmarks: readonly StandLandmark[];
  /** Trail looks: between landmarks, from a building's door, and for a loop. */
  readonly trailStyles: readonly [RouteSpec, RouteSpec, RouteSpec];
  /** How many trees, the scatter's seed, and each build's trunk and crown radius by build: tree i copies a build chosen from i. */
  readonly trees: { readonly count: number; readonly seed: number; readonly presets: number; readonly builds: number; readonly bases: readonly number[]; readonly crowns: readonly number[] };
  /** The understory's rules and seed, and what each region's open ground reads as. */
  readonly understory: { readonly rules: readonly ScatterRule[]; readonly seed: number; readonly open?: readonly (Habitat | undefined)[] };
  readonly code?: StandCode;
}

/** Where one tree stands and which build it copies; `index` is its place in the scatter, which names the file it stands for. */
export interface StandTree {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly variant: number;
  readonly scale: number;
  readonly yaw: number;
  /** In a world laid out from code, the patch (and so the file) it grows on. */
  readonly patch?: number;
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
  readonly placements: readonly Placement[];
  /** In a world laid out from code, each symbol's placement in `placements`, or -1 where nothing could stand. */
  readonly symbols: readonly number[];
  readonly wilds: WildsRing;
  /** Height, water level, distance to the water and to a trail's edge per lattice sample: the ground texture's data. */
  readonly ground: Float32Array;
  /** Which ways each lattice sample lies on and how far along them (`trailPlaces`), two per sample. */
  readonly trailPlaces: Float32Array;
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
const treeClearance = (lm: StandLandmark): number => lm.base + (lm.name.startsWith("Great") ? 12 : 5);

/**
 * Picks landmark sites on regions spread apart, farthest first from the
 * buildings and then from every landmark placed, plans the trails Jev would
 * want between every place (a spanning tree by distance, then a loop or two)
 * and levels their treads into the ground.
 */
function settleWays(t: Terrain, req: StandRequest, sites: readonly BuildingSite[]): { landmarks: StandingLandmark[]; network: TrailNetwork } {
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
  levelTrails(t, network.ways);
  return { landmarks: placed, network };
}

/**
 * A world laid out from code: each building on its lot, each landmark on
 * its lot, and the trails Jev wants between them, leveled into the ground.
 */
function settleCode(t: Terrain, req: StandRequest, code: StandCode, sites: readonly BuildingSite[]): { landmarks: StandingLandmark[]; network: TrailNetwork } {
  const homes = req.buildings.map((b, i) => ({ ...b, site: sites[i] as BuildingSite, id: code.lots[i]?.id ?? b.name }));
  const avoid: Occupied[] = homes.map((b) => ({ x: b.site.x, z: b.site.z, radius: Math.hypot(b.plan.width, b.plan.depth) / 2 + 2 }));
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
  // A trail ends at a building's door, or at a landmark's foot facing the mean way to its trails' other ends, one spot per place so they share it.
  const end = (id: string, toward: { x: number; z: number } | null): TrailEnd | null => {
    const home = homes.find((b) => b.id === id);
    if (home !== undefined) return { id, ...standOf(home.plan, home.site) };
    const k = ids.indexOf(id);
    const s = landmarks[k];
    if (s === undefined) return null;
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
    return [{ id: `${w.from}->${w.to}`, from, to, style: req.trailStyles[w.style] ?? req.trailStyles[0], want: w.want }];
  });
  const keepOut: Occupied[] = [
    ...homes.map((b) => ({ x: b.site.x, z: b.site.z, radius: Math.hypot(b.plan.width, b.plan.depth) / 2 + 0.6 })),
    ...landmarks.map((s) => ({ x: s.site.x, z: s.site.z, radius: (req.landmarks[s.landmark]?.base ?? 2) + 0.8 })),
  ];
  const network = planTrails(t, requests, 41, keepOut);
  levelTrails(t, network.ways);
  return { landmarks, network };
}

/** Fewest meters between trunks, whatever the crowns. */
const TRUNK_GAP = 4.5;

/**
 * The trees on each file's patch, as one grove: close-set at its heart and
 * thinning toward its margin, on its own cells' dry, gentle ground, clear of
 * what stands, of every other grove's trees and of the file's own finer
 * entities, which each keep a small glade.
 */
function plantPatches(t: Terrain, req: StandRequest, code: StandCode, blocked: (x: number, z: number) => boolean, glades: readonly Occupied[]): StandTree[] {
  const { builds, bases, crowns } = req.trees;
  const half = t.spec.size / 2 - 24;
  const trees: StandTree[] = [];
  const index = trunkIndex();
  const onPatch = (j: number, x: number, z: number): boolean => code.cells.length === 0 || code.cells[siteAt(code.cells, x, z)]?.patch === j;
  const inGlade = (x: number, z: number): boolean => glades.some((g) => Math.hypot(g.x - x, g.z - z) < g.radius);
  code.patches.forEach((p, j) => {
    if (p.preset < 0 || p.trees <= 0) return;
    let crown = 0;
    for (let k = 0; k < builds; k++) crown += (crowns[p.preset * builds + k] ?? 4) / builds;
    const spacing = Math.max(TRUNK_GAP, crown * 2 * p.stature * p.closeness);
    const fits = (x: number, z: number): boolean =>
      Math.abs(x) <= half && Math.abs(z) <= half && onPatch(j, x, z) && slopeAt(t.lattice, x, z) <= PLANT_SLOPE && !isWet(t, x, z) && !blocked(x, z) && !inGlade(x, z);
    const grown = growGrove({ x: p.heart.x, z: p.heart.z, count: p.trees, spacing, reach: p.reach, seed: p.seed }, fits, (x, z, gap) => index.crowded(x, z, Math.min(gap, spacing)));
    const r = rand(p.seed ^ 0x5bd1e995);
    for (const [x, z] of grown) {
      index.add(x, z);
      const variant = p.preset * builds + Math.floor(r.next() * builds);
      const scale = p.stature * (0.85 + r.next() * 0.45);
      const base = (bases[variant] ?? 0.5) * scale;
      trees.push({ index: trees.length, x, y: groundedBase(t.lattice, x, z, base), z, variant, scale, yaw: r.next() * Math.PI * 2, patch: j });
    }
  });
  return trees;
}

/** Stands everything on a finished bake, leveling the lattice under the buildings and the trails first. */
export function standWorld(t: Terrain, req: StandRequest): Stand {
  const code = req.code;
  const sites: BuildingSite[] = [];
  req.buildings.forEach((b, i) => {
    const site = findSite(t, b.plan, sites, 30, b.beside, code?.lots[i] ?? null);
    levelPad(t, b.plan, site, b.beside);
    sites.push(site);
  });
  const { landmarks, network } = code === undefined ? settleWays(t, req, sites) : settleCode(t, req, code, sites);

  // Trees keep off the trails and their cairns, out of the buildings and out from under a landmark.
  const clear: Occupied[] = [...trailDiscs(network, 1.6), ...landmarks.map((s) => ({ x: s.site.x, z: s.site.z, radius: treeClearance(req.landmarks[s.landmark] as StandLandmark) }))];
  const blocked = (x: number, z: number): boolean => req.buildings.some((b, k) => blockedBy(b, sites[k] as BuildingSite, x, z, 6)) || clear.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius);
  const { count, seed, presets, builds, bases } = req.trees;
  // A file's finer entities each keep a small glade among its trees.
  const glades: Occupied[] = (code?.symbols ?? []).map((sym) => ({ x: sym.x, z: sym.z, radius: sym.radius * sym.scale + 2.6 }));
  const trees =
    code !== undefined
      ? plantPatches(t, req, code, blocked, glades)
      : scatterPlants(t, count, seed).flatMap((s, i): StandTree[] => {
          if (blocked(s.x, s.z)) return [];
          const variant = (i % presets) * builds + (Math.floor(i / presets) % builds);
          const scale = 0.85 + ((i * 37) % 10) / 22;
          const base = (bases[variant] ?? 0.5) * scale;
          return [{ index: i, x: s.x, y: groundedBase(t.lattice, s.x, s.z, base), z: s.z, variant, scale, yaw: i * 1.7 }];
        });

  // Nothing of the understory stands in a building, on its walk, on a trail or under a landmark.
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
  // A file's finer entities stand where the layout put them, kept off water, steep ground and whatever else stands.
  const standing: Placement[] = [];
  /** Each standing entity with the room decoration leaves it, so nothing crowds it. */
  const roomy: Occupied[] = [];
  const symbols = (code?.symbols ?? []).map((sym, i): number => {
    const reach = sym.radius * sym.scale;
    const clash = (x: number, z: number): boolean => isWet(t, x, z) || slopeAt(t.lattice, x, z) > 24 || blocked(x, z) || occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + reach);
    let at: [number, number] | null = clash(sym.x, sym.z) ? null : [sym.x, sym.z];
    for (let k = 1; at === null && k <= 8; k++) {
      const a = k * 2.4;
      const x = sym.x + Math.cos(a) * k * 0.6;
      const z = sym.z + Math.sin(a) * k * 0.6;
      if (!clash(x, z)) at = [x, z];
    }
    if (at === null) return -1;
    const [x, z] = at;
    occupied.push({ x, z, radius: reach + 0.4 });
    roomy.push({ x, z, radius: reach + 2.2 });
    standing.push({ rule: sym.rule, variant: sym.variant, x, y: heightAt(t.lattice, x, z) - 0.05, z, yaw: ((i * 2.399) % (Math.PI * 2)), scale: sym.scale, radius: reach, slope: [0, 0], region: t.region[Math.round((z - t.lattice.origin) / t.lattice.spacing) * t.lattice.n + Math.round((x - t.lattice.origin) / t.lattice.spacing)] ?? 0, vitality: sym.vitality });
    return standing.length - 1;
  });
  // The understory grows where it belongs: it reads the groves' crowns, and in a world from code each region's character.
  const rules = code === undefined ? req.understory.rules : req.understory.rules.map((rule) => ({ ...rule, regions: t.spec.regions.map((_, i) => (rule.regions?.[i] ?? 1) * (code.regions[i]?.understory[rule.id] ?? 1)) }));
  const open = code === undefined ? req.understory.open : t.spec.regions.map((_, i) => code.regions[i]?.open ?? req.understory.open?.[i]);
  const canopy = trees.map((tr) => ({ x: tr.x, z: tr.z, radius: (req.trees.crowns[tr.variant] ?? 4) * tr.scale }));
  const placements = [...standing, ...scatterComponents(t, rules, req.understory.seed, [...occupied, ...roomy], { canopy, ...(open === undefined ? {} : { open }) })];

  const n = t.lattice.n * t.lattice.n;
  const field = trailField(t, network.ways);
  const ground = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    ground[i * 4] = t.lattice.heights[i] as number;
    ground[i * 4 + 1] = t.waterLevel[i] as number;
    ground[i * 4 + 2] = t.shore[i] as number;
    ground[i * 4 + 3] = field[i] as number;
  }
  return { sites, landmarks, network, trees, placements, symbols, wilds: wildsRing(t), ground, trailPlaces: trailPlaces(t, network.ways) };
}
