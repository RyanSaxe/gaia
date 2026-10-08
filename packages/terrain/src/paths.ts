// Trails between a world's places, walked over one network of paths. A
// trail's look is a `RouteSpec` Jev fills; its route is never chosen, it is
// found over the baked ground: the cheapest way at a gentle grade, around
// steep ground and deep water, across a stream where it is narrow, wandering
// as freely as the spec's winding says. Each trail prefers the ways earlier
// ones made and never runs beside one, so trails share trunk paths that
// branch to each place at junctions. The network is cut into ways, stretches
// of tread between two junctions or places, each knowing every trail that
// walks it. Composition is held by the network's ground, which shared ways do
// not add to. Everything here is pure and seeded.

import type { RouteSpec } from "@gaia/schema";
import { fbm } from "@gaia/primitives";
import { heightAt, slopeAt, worldOf } from "./lattice.ts";
import type { Occupied } from "./scatter.ts";
import { DRY, type Terrain } from "./world.ts";

export const TRAILS = {
  /** Meters per routing cell. */
  cell: 2,
  /** Trails keep this far inside the walkable square's edge, meters. */
  margin: 22,
  /** Steepest grade a trail climbs head-on; steeper ground is a detour. */
  maxGrade: 0.32,
  /** Cost added per routing cell of shallow water: a crossing is worth about this many meters of detour. */
  wade: 14,
  /** Water deeper than this is never crossed, meters. */
  deep: 0.7,
  /** Walking a way the network already has costs this share, so trails share ways: a trail takes the network unless that is over twice as far. */
  join: 0.45,
  /** Ground this many routing cells from a way, but off it, costs `beside` times as much, so no trail runs beside another. */
  besideCells: 2,
  beside: 2.5,
  /** Wavelength of the wandering that `winding` scales, meters. */
  wander: 46,
  /** Share of a region's ground the network's treads may cover. */
  share: 0.05,
  /** Share of the whole land they may cover. */
  landShare: 0.02,
  /** How far the ground eases back to the land beyond a trail's edge, meters. */
  blend: 2.6,
  /** Half the length of ground the tread's grade is averaged over, meters. */
  grade: 7,
  /** The most the flattening cuts or fills, meters. */
  maxCut: 0.55,
  /** The trail field's reach past an edge, meters; farther reads as this. */
  reach: 6,
  /** A second way counts at a sample when its edge is within this many meters of the nearest one's, so where ways meet the more worn one shows. */
  meet: 1.2,
  /** A junction's cairn keeps this far clear of every tread, at least this far from a place, and this far from another cairn, meters. */
  cairnClear: 0.9,
  cairnFromPlace: 14,
  cairnApart: 40,
  /** Points a way's wear is known at, evenly along it, for the shaders to blend between. */
  stations: 4,
} as const;

/** One end of a trail: a place, such as a cottage's door or a landmark's foot. */
export interface TrailEnd {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/** A trail Jev wants: two places, how it looks, and how much Jev wants it. */
export interface TrailRequest {
  readonly id: string;
  readonly from: TrailEnd;
  readonly to: TrailEnd;
  readonly style: RouteSpec;
  /** Jev's probability that this dependency should show as a trail, 0 to 1. */
  readonly want: number;
}

/** Where a way crosses a stream: the span from bank to bank, along the way. */
export interface Crossing {
  readonly x: number;
  readonly z: number;
  /** Rotation about y that turns local +x along the way, as Three's rotation does. */
  readonly yaw: number;
  /** Bank to bank, meters. */
  readonly span: number;
  /** The water's surface under the middle. */
  readonly level: number;
  /** The higher bank's ground, where a deck would rest. */
  readonly bank: number;
}

/** A trail walking a way: which trail, and how far along it (0 at its first end, 1 at its second) the way's first and last points lie. */
export interface WayCarry {
  readonly trail: number;
  readonly from: number;
  readonly to: number;
}

/** A stretch of tread between two junctions or places, walked by one trail or many. */
export interface Way {
  readonly id: string;
  /** The places or junctions at its first and last points. */
  readonly from: string;
  readonly to: string;
  /**
   * Its look: its most wanted trail's, as wide as its widest trail, with a
   * footbridge where it carries much traffic, is wide, or a trail on it asks
   * for one, and stepping stones otherwise.
   */
  readonly style: RouteSpec;
  /** The tread's center line, x and z pairs about a meter apart. */
  readonly points: Float32Array;
  readonly length: number;
  readonly crossings: readonly Crossing[];
  /** Every region it passes through. */
  readonly regions: readonly number[];
  /** Every trail walking it, most wanted first. */
  readonly carries: readonly WayCarry[];
}

/** One dependency walked over the network: its two places, its look, and the ways it walks in order. */
export interface Trail {
  readonly id: string;
  /** The ids of the places it joins: its first end and its second. */
  readonly from: string;
  readonly to: string;
  readonly style: RouteSpec;
  readonly want: number;
  /** The ways it walks from its first end to its second, each `reversed` when walked from its last point to its first. */
  readonly ways: readonly { readonly way: number; readonly reversed: boolean }[];
  /** Meters walked. */
  readonly length: number;
}

/** Where three or more ways meet away from a place. */
export interface Junction {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** The ways meeting here. */
  readonly ways: readonly number[];
  /** A small cairn in the widest gap between its ways, or null where none suits: near a place, near another cairn, or with no dry, clear ground. */
  readonly cairn: { readonly x: number; readonly z: number; readonly y: number } | null;
}

/** A trail the network could not take, and why. */
export interface DroppedTrail {
  readonly id: string;
  readonly reason: string;
}

export interface TrailNetwork {
  readonly ways: readonly Way[];
  readonly trails: readonly Trail[];
  readonly junctions: readonly Junction[];
  readonly dropped: readonly DroppedTrail[];
}

export const NO_TRAILS: TrailNetwork = { ways: [], trails: [], junctions: [], dropped: [] };

// ---------- routing ----------

class Heap {
  readonly #keys: number[] = [];
  readonly #items: number[] = [];
  get size(): number {
    return this.#items.length;
  }
  push(item: number, key: number): void {
    const k = this.#keys;
    const it = this.#items;
    k.push(key);
    it.push(item);
    let i = it.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((k[p] as number) <= key) break;
      k[i] = k[p] as number;
      it[i] = it[p] as number;
      i = p;
    }
    k[i] = key;
    it[i] = item;
  }
  pop(): number {
    const k = this.#keys;
    const it = this.#items;
    const top = it[0] as number;
    const lastK = k.pop() as number;
    const lastI = it.pop() as number;
    if (it.length > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= it.length) break;
        const r = l + 1;
        const c = r < it.length && (k[r] as number) < (k[l] as number) ? r : l;
        if ((k[c] as number) >= lastK) break;
        k[i] = k[c] as number;
        it[i] = it[c] as number;
        i = c;
      }
      k[i] = lastK;
      it[i] = lastI;
    }
    return top;
  }
}

const NEIGHBORS: readonly [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1],
];
/** Each neighbor's opposite. */
const OPPOSITE = NEIGHBORS.map(([di, dj]) => NEIGHBORS.findIndex(([a, b]) => a === -di && b === -dj));
/** The neighbor index of a step, by (di + 2) * 5 + (dj + 2). */
const STEP = (() => {
  const out = new Int8Array(25).fill(-1);
  NEIGHBORS.forEach(([di, dj], d) => (out[(di + 2) * 5 + dj + 2] = d));
  return out;
})();

interface Grid {
  readonly n: number;
  readonly origin: number;
  readonly height: Float32Array;
  readonly slope: Float32Array;
  readonly depth: Float32Array;
  readonly wander: Float32Array;
  readonly blocked: Uint8Array;
  /** The network so far: a bit per neighbor for each step a trail takes from a cell. */
  readonly edges: Uint16Array;
  /** Routing cells from the nearest way, 0 on one, up to `TRAILS.besideCells + 1` for far. */
  readonly near: Uint8Array;
  // Scratch for each search.
  readonly cost: Float64Array;
  readonly came: Int32Array;
  readonly done: Uint8Array;
}

function gridOf(t: Terrain, seed: number, avoid: readonly Occupied[]): Grid {
  const half = t.spec.size / 2 - TRAILS.margin;
  const n = Math.floor((half * 2) / TRAILS.cell) + 1;
  const origin = -half;
  const height = new Float32Array(n * n);
  const slope = new Float32Array(n * n);
  const depth = new Float32Array(n * n);
  const wander = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = origin + i * TRAILS.cell;
      const z = origin + j * TRAILS.cell;
      const k = j * n + i;
      const h = heightAt(t.lattice, x, z);
      height[k] = h;
      slope[k] = slopeAt(t.lattice, x, z);
      const level = heightAt(t.lattice, x, z, t.waterLevel);
      depth[k] = level > DRY / 2 ? Math.max(0.01, level - h) : 0;
      wander[k] = 0.5 + 0.5 * fbm(seed, x / TRAILS.wander, z / TRAILS.wander, 2, 0.5);
    }
  }
  const blocked = new Uint8Array(n * n);
  for (const o of avoid) {
    const reach = Math.ceil(o.radius / TRAILS.cell) + 1;
    const ci = Math.round((o.x - origin) / TRAILS.cell);
    const cj = Math.round((o.z - origin) / TRAILS.cell);
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (let i = ci - reach; i <= ci + reach; i++) {
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        if (Math.hypot(origin + i * TRAILS.cell - o.x, origin + j * TRAILS.cell - o.z) < o.radius) blocked[j * n + i] = 1;
      }
    }
  }
  const near = new Uint8Array(n * n).fill(TRAILS.besideCells + 1);
  return { n, origin, height, slope, depth, wander, blocked, edges: new Uint16Array(n * n), near, cost: new Float64Array(n * n), came: new Int32Array(n * n), done: new Uint8Array(n * n) };
}

const cellOf = (g: Grid, x: number, z: number): number => {
  const i = Math.max(0, Math.min(g.n - 1, Math.round((x - g.origin) / TRAILS.cell)));
  const j = Math.max(0, Math.min(g.n - 1, Math.round((z - g.origin) / TRAILS.cell)));
  return j * g.n + i;
};
const cellX = (g: Grid, k: number): number => g.origin + (k % g.n) * TRAILS.cell;
const cellZ = (g: Grid, k: number): number => g.origin + Math.floor(k / g.n) * TRAILS.cell;

/** The cheapest chain of cells between two cells, or null when none exists. Steps along the network's ways cost `TRAILS.join`; ground beside a way costs more. */
function search(g: Grid, start: number, goal: number, winding: number): number[] | null {
  const { n, cost, came, done } = g;
  cost.fill(Infinity);
  came.fill(-1);
  done.fill(0);
  const gi = goal % n;
  const gj = Math.floor(goal / n);
  // Below the cheapest step per meter, so the search still finds a long way round along the network.
  const guess = (k: number): number => Math.hypot((k % n) - gi, Math.floor(k / n) - gj) * TRAILS.cell * TRAILS.join * 0.95;
  const heap = new Heap();
  cost[start] = 0;
  heap.push(start, guess(start));
  while (heap.size > 0) {
    const k = heap.pop();
    if (done[k] === 1) continue;
    done[k] = 1;
    if (k === goal) break;
    const i = k % n;
    const j = Math.floor(k / n);
    const ways = g.edges[k] as number;
    for (let d = 0; d < NEIGHBORS.length; d++) {
      const [di, dj] = NEIGHBORS[d] as [number, number];
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const m = nj * n + ni;
      if (done[m] === 1 || (g.blocked[m] === 1 && m !== goal)) continue;
      const deep = g.depth[m] as number;
      if (deep > TRAILS.deep) continue;
      const run = Math.hypot(di, dj) * TRAILS.cell;
      const grade = Math.abs((g.height[m] as number) - (g.height[k] as number)) / run;
      if (grade > TRAILS.maxGrade * 1.6) continue;
      const steep = Math.max(0, grade - TRAILS.maxGrade * 0.35) / TRAILS.maxGrade;
      const side = (g.slope[m] as number) / 16;
      let step = run * (1 + 4 * steep * steep + side * side * 0.8 + winding * 1.4 * (g.wander[m] as number));
      if (deep > 0) step += (TRAILS.wade * run) / TRAILS.cell;
      if ((ways & (1 << d)) !== 0) step *= TRAILS.join;
      else {
        const near = g.near[m] as number;
        if (near > 0 && near <= TRAILS.besideCells && m !== goal) step *= TRAILS.beside;
      }
      const next = (cost[k] as number) + step;
      if (next < (cost[m] as number)) {
        cost[m] = next;
        came[m] = k;
        heap.push(m, next + guess(m));
      }
    }
  }
  if (came[goal] === -1) return null;
  const cells: number[] = [];
  for (let k = goal; k !== -1; k = came[k] as number) {
    cells.push(k);
    if (k === start) break;
  }
  return cells.reverse();
}

/** The neighbor index of the step from cell `a` to cell `b`. */
const stepOf = (g: Grid, a: number, b: number): number => STEP[((b % g.n) - (a % g.n) + 2) * 5 + (Math.floor(b / g.n) - Math.floor(a / g.n)) + 2] as number;
/** One key per undirected step: its lower cell and the direction from it. */
const edgeKey = (g: Grid, a: number, b: number): number => (a < b ? a * 16 + stepOf(g, a, b) : b * 16 + stepOf(g, b, a));

/** Adds a trail's cells to the network: its steps, and how near every cell around lies to a way. */
function wear(g: Grid, cells: readonly number[]): void {
  const { n } = g;
  for (let s = 0; s + 1 < cells.length; s++) {
    const a = cells[s] as number;
    const b = cells[s + 1] as number;
    const d = stepOf(g, a, b);
    g.edges[a] = (g.edges[a] as number) | (1 << d);
    g.edges[b] = (g.edges[b] as number) | (1 << (OPPOSITE[d] as number));
  }
  const r = TRAILS.besideCells;
  for (const k of cells) {
    const i = k % n;
    const j = Math.floor(k / n);
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const m = nj * n + ni;
        g.near[m] = Math.min(g.near[m] as number, Math.max(Math.abs(di), Math.abs(dj)));
      }
    }
  }
}

/** Chaikin corner cutting, then resampling every `spacing` meters: a trail curves instead of turning on a grid. */
function smoothLine(points: [number, number][], spacing: number): Float32Array {
  let line = points;
  for (let pass = 0; pass < 4; pass++) {
    const next: [number, number][] = [line[0] as [number, number]];
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az] = line[k] as [number, number];
      const [bx, bz] = line[k + 1] as [number, number];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    next.push(line[line.length - 1] as [number, number]);
    line = next;
  }
  const out: number[] = [];
  let carry = 0;
  out.push(line[0]![0], line[0]![1]);
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k] as [number, number];
    const [bx, bz] = line[k + 1] as [number, number];
    const len = Math.hypot(bx - ax, bz - az);
    let at = spacing - carry;
    while (at <= len) {
      out.push(ax + ((bx - ax) * at) / len, az + ((bz - az) * at) / len);
      at += spacing;
    }
    carry = len - (at - spacing);
  }
  const last = line[line.length - 1] as [number, number];
  if (Math.hypot(last[0] - (out[out.length - 2] as number), last[1] - (out[out.length - 1] as number)) > spacing * 0.3) out.push(last[0], last[1]);
  return new Float32Array(out);
}

const wetAt = (t: Terrain, x: number, z: number): boolean => heightAt(t.lattice, x, z, t.waterLevel) > DRY / 2;

function crossingsOf(t: Terrain, points: Float32Array): Crossing[] {
  const count = points.length / 2;
  const out: Crossing[] = [];
  let k = 0;
  while (k < count) {
    if (!wetAt(t, points[k * 2] as number, points[k * 2 + 1] as number)) {
      k++;
      continue;
    }
    const a = Math.max(0, k - 1);
    while (k < count && wetAt(t, points[k * 2] as number, points[k * 2 + 1] as number)) k++;
    const b = Math.min(count - 1, k);
    const ax = points[a * 2] as number;
    const az = points[a * 2 + 1] as number;
    const bx = points[b * 2] as number;
    const bz = points[b * 2 + 1] as number;
    const x = (ax + bx) / 2;
    const z = (az + bz) / 2;
    out.push({
      x,
      z,
      yaw: -Math.atan2(bz - az, bx - ax),
      span: Math.hypot(bx - ax, bz - az) + 1.6,
      level: heightAt(t.lattice, x, z, t.waterLevel),
      bank: Math.max(heightAt(t.lattice, ax, az), heightAt(t.lattice, bx, bz)),
    });
  }
  return out;
}

function regionIndex(t: Terrain, x: number, z: number): number {
  const l = t.lattice;
  const ix = Math.max(0, Math.min(l.n - 1, Math.round((x - l.origin) / l.spacing)));
  const iz = Math.max(0, Math.min(l.n - 1, Math.round((z - l.origin) / l.spacing)));
  return t.region[iz * l.n + ix] ?? 0;
}

/** Each region's walkable ground, square meters. */
function regionAreas(t: Terrain): number[] {
  const l = t.lattice;
  const half = t.spec.size / 2;
  const areas = t.spec.regions.map(() => 0);
  for (let iz = 0; iz < l.n; iz++) {
    if (Math.abs(worldOf(l, iz)) > half) continue;
    for (let ix = 0; ix < l.n; ix++) {
      if (Math.abs(worldOf(l, ix)) > half) continue;
      const r = t.region[iz * l.n + ix] ?? 0;
      areas[r] = (areas[r] ?? 0) + l.spacing * l.spacing;
    }
  }
  return areas;
}

const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;

/** Each way's look from the trails walking it: the most wanted one's, as wide as the widest, bridged by width and traffic. */
function wayStyle(carried: readonly TrailRequest[]): RouteSpec {
  const lead = carried[0] as TrailRequest;
  const width = Math.max(...carried.map((r) => r.style.width));
  const wear = Math.max(...carried.map((r) => r.style.wear));
  const bridged = carried.length >= 3 || width >= 1.8 || carried.some((r) => r.style.crossing === "footbridge");
  return { ...lead.style, width, wear, crossing: bridged ? "footbridge" : "stepping-stones" };
}

/** Where a junction's cairn stands: in the widest gap between the ways leaving it, clear of every tread, on dry ground. */
function cairnOf(t: Terrain, x: number, z: number, leaving: readonly { readonly dx: number; readonly dz: number; readonly half: number }[], ways: readonly Way[]): { x: number; z: number; y: number } | null {
  const angles = leaving.map((l) => Math.atan2(l.dz, l.dx)).sort((a, b) => a - b);
  let gap = -1;
  let mid = 0;
  angles.forEach((a, i) => {
    const next = i + 1 < angles.length ? (angles[i + 1] as number) : (angles[0] as number) + Math.PI * 2;
    if (next - a > gap) {
      gap = next - a;
      mid = a + (next - a) / 2;
    }
  });
  const half = Math.max(...leaving.map((l) => l.half));
  const clear = half + TRAILS.cairnClear;
  const r = Math.max(clear + 0.6, clear / Math.sin(Math.min(gap / 2, Math.PI / 2)));
  if (r > 6) return null;
  const cx = x + Math.cos(mid) * r;
  const cz = z + Math.sin(mid) * r;
  if (heightAt(t.lattice, cx, cz, t.waterLevel) > DRY / 2 || heightAt(t.lattice, cx, cz, t.shore) < 2) return null;
  for (const w of ways) {
    const p = w.points;
    for (let k = 0; k < p.length; k += 2) if (Math.hypot((p[k] as number) - cx, (p[k + 1] as number) - cz) < w.style.width / 2 + TRAILS.cairnClear) return null;
  }
  return { x: cx, z: cz, y: heightAt(t.lattice, cx, cz) };
}

/**
 * Routes the trails Jev wants, most wanted first, as one network of paths.
 * Each trail takes the ways earlier ones made wherever that is not much
 * farther, and never runs beside one, so trails share trunk paths and
 * branch at junctions. A trail is kept while the ground it adds to the
 * network (shared ways add none) keeps every region it crosses within
 * `TRAILS.share` of its ground and the whole land within `TRAILS.landShare`;
 * one that would not, or that no gentle, dry way joins, is listed in
 * `dropped` with the reason. Ends sharing an id share the first one's spot.
 * `avoid` keeps trails out of footprints such as a house's walls.
 */
export function planTrails(t: Terrain, requests: readonly TrailRequest[], seed: number, avoid: readonly Occupied[] = []): TrailNetwork {
  const g = gridOf(t, seed, avoid);
  const areas = regionAreas(t);
  const land = areas.reduce((a, b) => a + b, 0);
  const covered = areas.map(() => 0);
  let total = 0;
  /** The width of the tread on each step of the network, by `edgeKey`. */
  const widths = new Map<number, number>();
  const spots = new Map<string, TrailEnd>();
  const dropped: DroppedTrail[] = [];
  const routed: { req: TrailRequest; cells: number[]; from: TrailEnd; to: TrailEnd }[] = [];
  const order = [...requests].sort((a, b) => b.want - a.want || a.id.localeCompare(b.id));
  for (const req of order) {
    const from = spots.get(req.from.id) ?? req.from;
    const to = spots.get(req.to.id) ?? req.to;
    const start = cellOf(g, from.x, from.z);
    const goal = cellOf(g, to.x, to.z);
    if (start === goal) {
      dropped.push({ id: req.id, reason: "its two places stand on one spot" });
      continue;
    }
    const cells = search(g, start, goal, req.style.winding);
    if (cells === null) {
      dropped.push({ id: req.id, reason: "no gentle, dry way joins its places" });
      continue;
    }
    // The ground this trail adds: new steps, and steps it widens.
    const adds = new Map<number, number>();
    let added = 0;
    for (let s = 0; s + 1 < cells.length; s++) {
      const a = cells[s] as number;
      const b = cells[s + 1] as number;
      const grow = Math.max(0, req.style.width - (widths.get(edgeKey(g, a, b)) ?? 0)) * Math.hypot(cellX(g, b) - cellX(g, a), cellZ(g, b) - cellZ(g, a));
      if (grow <= 0) continue;
      const r = regionIndex(t, (cellX(g, a) + cellX(g, b)) / 2, (cellZ(g, a) + cellZ(g, b)) / 2);
      adds.set(r, (adds.get(r) ?? 0) + grow);
      added += grow;
    }
    const over = [...adds].find(([r, a]) => ((covered[r] ?? 0) + a) / Math.max(1, areas[r] ?? 0) > TRAILS.share);
    if (over !== undefined) {
      dropped.push({ id: req.id, reason: `its new ground would take the paths in ${t.spec.regions[over[0]]?.id ?? `region ${over[0]}`} past ${percent(TRAILS.share)} of its ground` });
      continue;
    }
    if ((total + added) / Math.max(1, land) > TRAILS.landShare) {
      dropped.push({ id: req.id, reason: `its new ground would take the paths past ${percent(TRAILS.landShare)} of the land` });
      continue;
    }
    for (const [r, a] of adds) covered[r] = (covered[r] ?? 0) + a;
    total += added;
    for (let s = 0; s + 1 < cells.length; s++) {
      const key = edgeKey(g, cells[s] as number, cells[s + 1] as number);
      widths.set(key, Math.max(widths.get(key) ?? 0, req.style.width));
    }
    wear(g, cells);
    if (!spots.has(req.from.id)) spots.set(req.from.id, from);
    if (!spots.has(req.to.id)) spots.set(req.to.id, to);
    routed.push({ req, cells, from, to });
  }
  return networkOf(t, g, routed, dropped);
}

/** Cuts the routed trails' cells into ways between places and junctions, and tells each way which trails walk it. */
function networkOf(t: Terrain, g: Grid, routed: readonly { req: TrailRequest; cells: number[]; from: TrailEnd; to: TrailEnd }[], dropped: DroppedTrail[]): TrailNetwork {
  const ends = new Map<number, TrailEnd>();
  for (const r of routed) {
    ends.set(r.cells[0] as number, r.from);
    ends.set(r.cells[r.cells.length - 1] as number, r.to);
  }
  const degree = (k: number): number => {
    let v = g.edges[k] as number;
    let c = 0;
    for (; v !== 0; v &= v - 1) c++;
    return c;
  };
  const isNode = (k: number): boolean => ends.has(k) || degree(k) !== 2;
  const nodeId = (k: number): string => ends.get(k)?.id ?? `junction@${cellX(g, k)},${cellZ(g, k)}`;
  // Each step's way and where along it the step starts.
  const onWay = new Map<number, { way: number; at: number }>();
  const chains: number[][] = [];
  const trace = (k: number, d: number): void => {
    const chain = [k];
    let cur = k;
    let dir = d;
    for (;;) {
      const [di, dj] = NEIGHBORS[dir] as [number, number];
      const next = cur + dj * g.n + di;
      onWay.set(edgeKey(g, cur, next), { way: chains.length, at: chain.length - 1 });
      chain.push(next);
      if (isNode(next)) break;
      const back = OPPOSITE[dir] as number;
      let out = -1;
      for (let e = 0; e < NEIGHBORS.length; e++) if (e !== back && ((g.edges[next] as number) & (1 << e)) !== 0) out = e;
      cur = next;
      dir = out;
    }
    chains.push(chain);
  };
  for (const r of routed) {
    for (const k of r.cells) {
      if (!isNode(k)) continue;
      for (let d = 0; d < NEIGHBORS.length; d++) {
        if (((g.edges[k] as number) & (1 << d)) === 0) continue;
        const [di, dj] = NEIGHBORS[d] as [number, number];
        if (!onWay.has(edgeKey(g, k, k + dj * g.n + di))) trace(k, d);
      }
    }
  }
  // Each trail's ways in order.
  const walks = routed.map((r) => {
    const out: { way: number; reversed: boolean }[] = [];
    for (let s = 0; s + 1 < r.cells.length; s++) {
      const a = r.cells[s] as number;
      const on = onWay.get(edgeKey(g, a, r.cells[s + 1] as number)) as { way: number; at: number };
      const last = out[out.length - 1];
      if (last?.way === on.way) continue;
      out.push({ way: on.way, reversed: chains[on.way]?.[on.at] !== a });
    }
    return out;
  });
  const carriedBy = chains.map(() => [] as number[]);
  walks.forEach((w, i) => w.forEach((s) => carriedBy[s.way]?.push(i)));
  const lines = chains.map((chain) =>
    smoothLine(
      chain.map((k): [number, number] => {
        const end = ends.get(k);
        return end !== undefined ? [end.x, end.z] : [cellX(g, k), cellZ(g, k)];
      }),
      1,
    ),
  );
  const lengths = lines.map((p) => p.length / 2 - 1);
  const trails: Trail[] = routed.map((r, i) => ({
    id: r.req.id,
    from: r.req.from.id,
    to: r.req.to.id,
    style: r.req.style,
    want: r.req.want,
    ways: walks[i] as { way: number; reversed: boolean }[],
    length: (walks[i] ?? []).reduce((n, s) => n + (lengths[s.way] ?? 0), 0),
  }));
  // How far along each trail each of its ways lies.
  const spans = new Map<string, WayCarry>();
  trails.forEach((tr, i) => {
    let walked = 0;
    for (const s of tr.ways) {
      const len = lengths[s.way] ?? 0;
      const a = walked / Math.max(1e-6, tr.length);
      const b = (walked + len) / Math.max(1e-6, tr.length);
      spans.set(`${s.way}/${i}`, { trail: i, from: s.reversed ? b : a, to: s.reversed ? a : b });
      walked += len;
    }
  });
  const ways: Way[] = chains.map((chain, w) => {
    const carried = (carriedBy[w] ?? []).slice().sort((a, b) => (trails[b]?.want ?? 0) - (trails[a]?.want ?? 0) || a - b);
    const points = lines[w] as Float32Array;
    const regions = new Set<number>();
    for (let k = 0; k < points.length; k += 2) regions.add(regionIndex(t, points[k] as number, points[k + 1] as number));
    return {
      id: `way:${nodeId(chain[0] as number)}~${nodeId(chain[chain.length - 1] as number)}`,
      from: nodeId(chain[0] as number),
      to: nodeId(chain[chain.length - 1] as number),
      style: wayStyle(carried.map((i) => routed[i]?.req as TrailRequest)),
      points,
      length: lengths[w] as number,
      crossings: crossingsOf(t, points),
      regions: [...regions].sort((a, b) => a - b),
      carries: carried.map((i) => spans.get(`${w}/${i}`) as WayCarry),
    };
  });
  // Junctions: where three or more ways meet away from a place; the busiest first take a cairn.
  const places = [...ends.values()];
  const meeting = new Map<string, number[]>();
  ways.forEach((w, i) => {
    for (const id of [w.from, w.to]) if (id.startsWith("junction@")) meeting.set(id, [...(meeting.get(id) ?? []), i]);
  });
  const traffic = (ids: readonly number[]): number => new Set(ids.flatMap((i) => ways[i]?.carries.map((c) => c.trail) ?? [])).size;
  const found = [...meeting].filter(([, ids]) => new Set(ids).size >= 3).sort((a, b) => traffic(b[1]) - traffic(a[1]) || a[0].localeCompare(b[0]));
  const cairns: { x: number; z: number }[] = [];
  const junctions: Junction[] = found.map(([id, ids]) => {
    const w0 = ways[ids[0] as number] as Way;
    const x = w0.from === id ? (w0.points[0] as number) : (w0.points[w0.points.length - 2] as number);
    const z = w0.from === id ? (w0.points[1] as number) : (w0.points[w0.points.length - 1] as number);
    const leaving = ids.flatMap((i) => {
      const w = ways[i] as Way;
      const p = w.points;
      const count = p.length / 2;
      const ks = [...(w.from === id ? [Math.min(count - 1, 5)] : []), ...(w.to === id ? [Math.max(0, count - 6)] : [])];
      return ks.map((k) => ({ dx: (p[k * 2] as number) - x, dz: (p[k * 2 + 1] as number) - z, half: w.style.width / 2 }));
    });
    const nearPlace = places.some((p) => Math.hypot(p.x - x, p.z - z) < TRAILS.cairnFromPlace);
    const nearCairn = cairns.some((c) => Math.hypot(c.x - x, c.z - z) < TRAILS.cairnApart);
    const cairn = nearPlace || nearCairn ? null : cairnOf(t, x, z, leaving, ways);
    if (cairn !== null) cairns.push(cairn);
    return { id, x, z, ways: [...new Set(ids)], cairn };
  });
  return { ways, trails, junctions, dropped };
}

// ---------- the ground under the ways ----------

/** Visits every lattice sample within `reach` of each segment, with its distance and the nearest point's index along the way. */
function nearSegments(t: Terrain, way: Way, reach: number, visit: (index: number, distance: number, along: number) => void): void {
  const l = t.lattice;
  const pts = way.points;
  const count = pts.length / 2;
  for (let k = 0; k + 1 < count; k++) {
    const ax = pts[k * 2] as number;
    const az = pts[k * 2 + 1] as number;
    const bx = pts[k * 2 + 2] as number;
    const bz = pts[k * 2 + 3] as number;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - l.origin) / l.spacing));
    const i1 = Math.min(l.n - 1, Math.ceil((Math.max(ax, bx) + reach - l.origin) / l.spacing));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - l.origin) / l.spacing));
    const j1 = Math.min(l.n - 1, Math.ceil((Math.max(az, bz) + reach - l.origin) / l.spacing));
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = Math.max(1e-9, dx * dx + dz * dz);
    for (let j = j0; j <= j1; j++) {
      const z = worldOf(l, j);
      for (let i = i0; i <= i1; i++) {
        const x = worldOf(l, i);
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
        const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
        if (d <= reach) visit(j * l.n + i, d, k + u);
      }
    }
  }
}

/**
 * Eases the baked ground under each way toward the tread's own smoothed
 * grade, blending back to the land over `TRAILS.blend` meters, as a cottage's
 * pad does. A trail on a hillside benches gently into it; bumps along the
 * tread soften. Water and the banks next to it are never touched, and no
 * sample moves more than `TRAILS.maxCut`.
 */
export function levelTrails(t: Terrain, ways: readonly Way[]): void {
  const l = t.lattice;
  for (const trail of ways) {
    const pts = trail.points;
    const count = pts.length / 2;
    const ground = new Float32Array(count);
    for (let k = 0; k < count; k++) ground[k] = heightAt(l, pts[k * 2] as number, pts[k * 2 + 1] as number);
    const grade = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      let sum = 0;
      let n = 0;
      for (let m = Math.max(0, k - TRAILS.grade); m <= Math.min(count - 1, k + TRAILS.grade); m++) {
        sum += ground[m] as number;
        n++;
      }
      grade[k] = sum / n;
    }
    const half = trail.style.width / 2;
    const best = new Float32Array(l.n * l.n).fill(Infinity);
    const target = new Float32Array(l.n * l.n);
    nearSegments(t, trail, half + TRAILS.blend, (index, d, along) => {
      if (d >= (best[index] as number)) return;
      best[index] = d;
      const k = Math.min(count - 1, Math.floor(along));
      const f = along - k;
      target[index] = (grade[k] as number) * (1 - f) + (grade[Math.min(count - 1, k + 1)] as number) * f;
    });
    for (let i = 0; i < best.length; i++) {
      const d = best[i] as number;
      if (d === Infinity || (t.waterLevel[i] as number) > DRY / 2) continue;
      const u = Math.max(0, Math.min(1, (d - half - 0.3) / TRAILS.blend));
      const shore = Math.max(0, Math.min(1, ((t.shore[i] as number) - 1.5) / 2.5));
      const w = (1 - u * u * (3 - 2 * u)) * shore * shore * (3 - 2 * shore);
      if (w <= 0) continue;
      const h = l.heights[i] as number;
      const delta = Math.max(-TRAILS.maxCut, Math.min(TRAILS.maxCut, (target[i] as number) - h));
      l.heights[i] = h + delta * w;
    }
  }
}

/**
 * Signed distance from each lattice sample to the nearest way's edge,
 * meters: negative on the tread, capped at `TRAILS.reach`. The ground paints
 * worn earth from it and the grass parts along it; water reads as far.
 */
export function trailField(t: Terrain, ways: readonly Way[]): Float32Array {
  const l = t.lattice;
  const field = new Float32Array(l.n * l.n).fill(TRAILS.reach);
  for (const trail of ways) {
    const half = trail.style.width / 2;
    nearSegments(t, trail, half + TRAILS.reach, (index, d) => {
      if ((t.waterLevel[index] as number) > DRY / 2) return;
      const edge = d - half;
      if (edge < (field[index] as number)) field[index] = edge;
    });
  }
  return field;
}

/** A way's place packed in one number: its index, plus how far along it (0 to 1) in the fraction. */
const packPlace = (index: number, along: number): number => index + 0.999 * Math.max(0, Math.min(1, along));

/** Unpacks `trailPlaces`' numbers: the way's index and how far along it, from its first point (0) to its last (1); null for none. */
export function unpackPlace(packed: number): { way: number; along: number } | null {
  if (packed < 0) return null;
  const way = Math.floor(packed);
  return { way, along: (packed - way) / 0.999 };
}

/**
 * Which ways each lattice sample lies on, two numbers per sample: the
 * nearest way within `TRAILS.reach` of its edge and, where another way's
 * edge is within `TRAILS.meet` meters of that one's (where ways meet at a
 * junction), that one too; -1 for none. Each packs the way's index in
 * `ways` and how far along it the sample lies, 0 at its first point and 1
 * at its last (see `unpackPlace`), so a shader can read the way's wear, which
 * follows the vitality of every trail walking it, live (`wayWear`).
 */
export function trailPlaces(t: Terrain, ways: readonly Way[]): Float32Array {
  const l = t.lattice;
  const n = l.n * l.n;
  const d1 = new Float32Array(n).fill(Infinity);
  const d2 = new Float32Array(n).fill(Infinity);
  const p1 = new Float32Array(n).fill(-1);
  const p2 = new Float32Array(n).fill(-1);
  const mine = new Float32Array(n).fill(Infinity);
  const along = new Float32Array(n);
  ways.forEach((trail, index) => {
    const half = trail.style.width / 2;
    const last = Math.max(1, trail.points.length / 2 - 1);
    const touched: number[] = [];
    nearSegments(t, trail, half + TRAILS.reach, (i, d, k) => {
      if ((t.waterLevel[i] as number) > DRY / 2) return;
      if ((mine[i] as number) === Infinity) touched.push(i);
      if (d - half < (mine[i] as number)) {
        mine[i] = d - half;
        along[i] = k / last;
      }
    });
    for (const i of touched) {
      const d = mine[i] as number;
      const p = packPlace(index, along[i] as number);
      if (d < (d1[i] as number)) {
        d2[i] = d1[i] as number;
        p2[i] = p1[i] as number;
        d1[i] = d;
        p1[i] = p;
      } else if (d < (d2[i] as number)) {
        d2[i] = d;
        p2[i] = p;
      }
      mine[i] = Infinity;
    }
  });
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = p1[i] as number;
    out[i * 2 + 1] = (d2[i] as number) <= (d1[i] as number) + TRAILS.meet ? (p2[i] as number) : -1;
  }
  return out;
}

const smooth = (a: number, b: number, x: number): number => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * The vitality a trail shows at a point `along` it (0 at its first end, 1 at
 * its second): each end's entity's vitality holds near its end and blends
 * across the middle.
 */
export const trailVitalityAt = (fromVitality: number, toVitality: number, along: number): number =>
  fromVitality + (toVitality - fromVitality) * smooth(0.15, 0.85, along);

/**
 * How worn a trail's tread is at a point `along` it, from its blueprint's
 * `wear` and the vitality of the entities at its ends: a thriving pair's
 * trail is worn bare, a failing one's grows over until only a faint trace is
 * left, so its route still reads. The ground and grass shaders apply the same numbers live
 * (`TRAIL_GLSL` in the terrain lab), so a vitality change never rebakes.
 */
export const trailWearAt = (wear: number, fromVitality: number, toVitality: number, along: number): number =>
  wear * (0.2 + 0.8 * smooth(0.05, 0.75, trailVitalityAt(fromVitality, toVitality, along)));

/**
 * How worn a way is at each of its `TRAILS.stations`, evenly from its first
 * point to its last. Every trail walking it wears it (`trailWearAt`, from the
 * vitality of the two entities that trail joins), and their wear adds up as
 * chances do: a way bare to `a` by one trail and to `b` by another is bare to
 * 1 - (1 - a)(1 - b). So a shared way is never less worn than its most worn
 * trail, a trunk stays trodden while any trail on it thrives, and it grows
 * over only when every trail on it fails. The shaders blend between the
 * stations (`wayWearAt`); call it again whenever an entity's vitality changes.
 */
export function wayWear(network: TrailNetwork, way: number, vitalityOf: (place: string) => number): number[] {
  const w = network.ways[way];
  return Array.from({ length: TRAILS.stations }, (_, s) => {
    const a = s / (TRAILS.stations - 1);
    let bare = 1;
    for (const c of w?.carries ?? []) {
      const tr = network.trails[c.trail];
      if (tr === undefined) continue;
      bare *= 1 - trailWearAt(tr.style.wear, vitalityOf(tr.from), vitalityOf(tr.to), c.from + (c.to - c.from) * a);
    }
    return 1 - bare;
  });
}

/** A way's wear `along` it (0 to 1), blended between its stations as the shaders do. */
export function wayWearAt(stations: readonly number[], along: number): number {
  const f = Math.max(0, Math.min(1, along)) * (stations.length - 1);
  const k = Math.min(stations.length - 2, Math.floor(f));
  return (stations[k] as number) + ((stations[k + 1] as number) - (stations[k] as number)) * (f - k);
}

/**
 * The vitality a way shows at a point `along` it, for what is built on it (a
 * footbridge, edging stones): its liveliest trail's there, since a way is
 * kept in repair by whoever still walks it.
 */
export function wayVitalityAt(network: TrailNetwork, way: number, along: number, vitalityOf: (place: string) => number): number {
  let best = 0;
  for (const c of network.ways[way]?.carries ?? []) {
    const tr = network.trails[c.trail];
    if (tr !== undefined) best = Math.max(best, trailVitalityAt(vitalityOf(tr.from), vitalityOf(tr.to), c.from + (c.to - c.from) * along));
  }
  return best;
}

/** A junction's vitality, for its cairn: the liveliest of its ways' where they meet. */
export function junctionVitality(network: TrailNetwork, junction: Junction, vitalityOf: (place: string) => number): number {
  return Math.max(0, ...junction.ways.map((i) => wayVitalityAt(network, i, network.ways[i]?.from === junction.id ? 0 : 1, vitalityOf)));
}

/** Discs along each way's tread and around each junction's cairn, so trees and the understory keep off them. */
export function trailDiscs(network: TrailNetwork, margin: number): Occupied[] {
  const out: Occupied[] = [];
  for (const way of network.ways) {
    const pts = way.points;
    for (let k = 0; k < pts.length / 2; k += 2) out.push({ x: pts[k * 2] as number, z: pts[k * 2 + 1] as number, radius: way.style.width / 2 + margin });
  }
  for (const j of network.junctions) if (j.cairn !== null) out.push({ x: j.cairn.x, z: j.cairn.z, radius: 0.6 + margin });
  return out;
}

/** Small stones set along both edges of a way's tread, grounded; none in or beside water. */
export interface EdgeStone {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly size: number;
}

export function edgeStones(t: Terrain, trail: Way, seed: number): EdgeStone[] {
  if (trail.style.edging !== "stones") return [];
  const pts = trail.points;
  const count = pts.length / 2;
  const out: EdgeStone[] = [];
  const half = trail.style.width / 2 + 0.12;
  let h = (seed ^ 0x9e3779b9) >>> 0;
  const next = (): number => {
    h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x6d2b79f5) >>> 0;
    return h / 4294967296;
  };
  for (let k = 1; k + 1 < count; k++) {
    for (const side of [-1, 1]) {
      // Stones are set at uneven gaps and now and then left out, as by hand.
      if (next() < 0.42) continue;
      const ax = pts[(k - 1) * 2] as number;
      const az = pts[(k - 1) * 2 + 1] as number;
      const bx = pts[(k + 1) * 2] as number;
      const bz = pts[(k + 1) * 2 + 1] as number;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const off = half + (next() - 0.5) * 0.18;
      const x = (pts[k * 2] as number) + nx * off * side + ((bx - ax) / len) * (next() - 0.5) * 0.6;
      const z = (pts[k * 2 + 1] as number) + nz * off * side + ((bz - az) / len) * (next() - 0.5) * 0.6;
      if (heightAt(t.lattice, x, z, t.waterLevel) > DRY / 2 || heightAt(t.lattice, x, z, t.shore) < 1.2) continue;
      out.push({ x, y: heightAt(t.lattice, x, z), z, yaw: Math.atan2(bz - az, bx - ax) + (next() - 0.5) * 0.8, size: 0.16 + next() * 0.14 });
    }
  }
  return out;
}
