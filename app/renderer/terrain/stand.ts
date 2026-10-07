// What stands on a freshly baked world, worked out from plain data: each
// building's site and leveled pad, the landmarks' sites, the trails between
// them leveled into the ground, the trees and the understory kept off all of
// these, the wild land's ring, and the ground texture's data with the trail
// field in its fourth channel. It levels the lattice, so it runs before the
// ground is packed. No Three.js and no DOM: the bake worker runs it, and the
// same terrain and request give the same stand on any thread.

import type { BuildingPlan, RouteSpec } from "@gaia/schema";
import {
  type BuildingSite,
  type Capsule,
  type Extent,
  type LandmarkSite,
  type Occupied,
  type Placement,
  type ScatterRule,
  type Terrain,
  type Trail,
  type TrailEnd,
  type TrailRequest,
  type WildsRing,
  clearingsOf,
  findLandmarkSite,
  findSite,
  groundedBase,
  levelPad,
  levelTrails,
  planTrails,
  scatterComponents,
  scatterPlants,
  siteToWorld,
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

export interface StandRequest {
  readonly buildings: readonly StandBuilding[];
  /** The landmarks a world may stand; a world with more rises than kinds repeats them. */
  readonly landmarks: readonly StandLandmark[];
  /** Trail looks: between landmarks, from a building's door, and for a loop. */
  readonly trailStyles: readonly [RouteSpec, RouteSpec, RouteSpec];
  /** How many trees, the scatter's seed, and each build's trunk radius by build: tree i copies a build chosen from i. */
  readonly trees: { readonly count: number; readonly seed: number; readonly presets: number; readonly builds: number; readonly bases: readonly number[] };
  readonly understory: { readonly rules: readonly ScatterRule[]; readonly seed: number };
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
  readonly trails: readonly Trail[];
  readonly trees: readonly StandTree[];
  readonly placements: readonly Placement[];
  readonly wilds: WildsRing;
  /** Height, water level, distance to the water and to a trail's edge per lattice sample: the ground texture's data. */
  readonly ground: Float32Array;
  /** Which trails each lattice sample lies on and how far along them (`trailPlaces`), two per sample. */
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
function settleWays(t: Terrain, req: StandRequest, sites: readonly BuildingSite[]): { landmarks: StandingLandmark[]; trails: Trail[] } {
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
  const trails = planTrails(t, requests, 41, keepOut);
  levelTrails(t, trails);
  return { landmarks: placed, trails };
}

/** Stands everything on a finished bake, leveling the lattice under the buildings and the trails first. */
export function standWorld(t: Terrain, req: StandRequest): Stand {
  const sites: BuildingSite[] = [];
  for (const b of req.buildings) {
    const site = findSite(t, b.plan, sites, 30, b.beside);
    levelPad(t, b.plan, site, b.beside);
    sites.push(site);
  }
  const { landmarks, trails } = settleWays(t, req, sites);

  // Trees keep off the trails, out of the buildings and out from under a landmark.
  const clear: Occupied[] = [...trailDiscs(trails, 1.6), ...landmarks.map((s) => ({ x: s.site.x, z: s.site.z, radius: treeClearance(req.landmarks[s.landmark] as StandLandmark) }))];
  const { count, seed, presets, builds, bases } = req.trees;
  const trees = scatterPlants(t, count, seed).flatMap((s, i): StandTree[] => {
    if (req.buildings.some((b, k) => blockedBy(b, sites[k] as BuildingSite, s.x, s.z, 6)) || clear.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < o.radius)) return [];
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
    ...trailDiscs(trails, 0.5),
    ...landmarks.map((s) => ({ x: s.site.x, z: s.site.z, radius: (req.landmarks[s.landmark]?.base ?? 2) + 1 })),
  ];
  const placements = scatterComponents(t, req.understory.rules, req.understory.seed, occupied);

  const n = t.lattice.n * t.lattice.n;
  const field = trailField(t, trails);
  const ground = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    ground[i * 4] = t.lattice.heights[i] as number;
    ground[i * 4 + 1] = t.waterLevel[i] as number;
    ground[i * 4 + 2] = t.shore[i] as number;
    ground[i * 4 + 3] = field[i] as number;
  }
  return { sites, landmarks, trails, trees, placements, wilds: wildsRing(t), ground, trailPlaces: trailPlaces(t, trails) };
}
