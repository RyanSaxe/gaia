// Routes trails between a world's places as one network of paths over the
// baked ground. Jev fills each trail's look (`RouteSpec`), and an A* search
// finds its route, preferring gentle grades and earlier trails' ways, so
// trails share trunk paths that branch at junctions. The network is cut into
// ways, each a stretch of tread between two junctions or places that lists
// every trail on it.

import { type RouteSpec, seedOf } from "@gaia/schema";
import { fbm } from "@gaia/primitives";
import { shownVitality } from "@gaia/realize";
import { type Lattice, heightAt, slopeAt, worldOf, worldOfZ } from "./lattice.ts";
import type { Occupied } from "./placement.ts";
import { DRY, type Terrain } from "./world.ts";
import { withinLand } from "./edge.ts";
import { waterDepthAt } from "./walk.ts";

export const TRAILS = {
  /** Meters per routing cell. */
  cell: 2,
  /** Meters inside the walkable square's edge where the routing grid stops. */
  margin: 22,
  /** Reference grade for trail steps. Cost rises above 0.35 of it, and no step is steeper than 1.6 times it. */
  maxGrade: 0.32,
  /** Cost added per routing cell of shallow water, so a crossing is worth about this many meters of detour. */
  wade: 14,
  /** Trails never cross water deeper than this, in meters. */
  deep: 0.7,
  /** Cost multiplier for steps on an existing way, so trails share ways. A trail takes the network unless that is over twice as far. */
  join: 0.45,
  /** Ground within this many routing cells of a way, but off it, costs `beside` times as much, so no trail runs beside another. */
  besideCells: 2,
  beside: 2.5,
  /** Wavelength in meters of the cost noise that `RouteSpec.winding` scales. */
  wander: 46,
  /** Share of a region's ground the network's treads may cover. */
  share: 0.05,
  /** Share of the whole land the treads may cover. */
  landShare: 0.02,
  /** Meters beyond a trail's edge over which leveled ground blends back to the land. */
  blend: 2.6,
  /** Half the length of ground the tread's grade is averaged over, meters. */
  grade: 7,
  /** The most the flattening cuts or fills, meters. */
  maxCut: 0.55,
  /** Meters past a way's edge that the trail field measures. Farther samples read this value. */
  reach: 6,
  /** A second way counts at a sample when its edge is within this many meters of the nearest one's, so where ways meet the more worn one shows. */
  meet: 1.2,
  /** In meters, a cairn's clearance from every tread, its minimum distance from a place, and from another cairn. */
  cairnClear: 0.9,
  cairnFromPlace: 14,
  cairnApart: 40,
  /** Radius in meters around a cairn's center that has no grass. */
  cairnGround: 1,
  /** Number of evenly spaced points along a way where `wayWear` computes wear. The shaders blend between them. */
  stations: 4,
} as const;

/** One end of a trail, a place such as a cottage's door or a landmark's foot. */
export interface TrailEnd {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/** A requested trail: two places, its look, and Jev's `want` for it. */
export interface TrailRequest {
  readonly id: string;
  readonly from: TrailEnd;
  readonly to: TrailEnd;
  readonly style: RouteSpec;
  /** Jev's probability that this dependency should show as a trail, 0 to 1. */
  readonly want: number;
}

/** A place where a way crosses a stream, spanning bank to bank along the way. */
export interface Crossing {
  readonly x: number;
  readonly z: number;
  /** Rotation about y that turns local +x along the way, as Three's rotation does. */
  readonly yaw: number;
  /** Length in meters from bank to bank. */
  readonly span: number;
  /** The water surface height where the tread crosses the stream's course. */
  readonly level: number;
  /** Ground height of the higher bank, where a deck rests. */
  readonly bank: number;
}

/** The seed for a way's `k`th crossing. The crossing's build and the walk over it share it, so they agree. */
export const crossingSeed = (way: Way, k: number): number => seedOf(`${way.id}/crossing${k}`);

/** A trail on a way. `from` and `to` give where the way's first and last points lie along the trail, from 0 at its first end to 1 at its second. */
export interface WayCarry {
  readonly trail: number;
  readonly from: number;
  readonly to: number;
}

/** A stretch of tread between two junctions or places, on one or more trails. */
export interface Way {
  readonly id: string;
  /** The places or junctions at its first and last points. */
  readonly from: string;
  readonly to: string;
  /**
   * The look of its most wanted trail, as wide as its widest trail. It has a
   * footbridge where three or more trails use it, where it is at least 1.8 m
   * wide, or where a trail on it asks for one, and stepping stones otherwise.
   */
  readonly style: RouteSpec;
  /** The tread's center line, x and z pairs about a meter apart. */
  readonly points: Float32Array;
  readonly length: number;
  readonly crossings: readonly Crossing[];
  /** Every region it passes through. */
  readonly regions: readonly number[];
  /** Every trail on it, most wanted first. */
  readonly carries: readonly WayCarry[];
}

/** One dependency's trail over the network: its two places, its look, and its ways in order. */
export interface Trail {
  readonly id: string;
  /** The ids of the places it joins: its first end and its second. */
  readonly from: string;
  readonly to: string;
  readonly style: RouteSpec;
  readonly want: number;
  /** Its ways from its first end to its second. `reversed` marks a way the trail follows from the way's last point to its first. */
  readonly ways: readonly { readonly way: number; readonly reversed: boolean }[];
  /** Length in meters. */
  readonly length: number;
}

/** A point away from any place where three or more ways meet. */
export interface Junction {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly ways: readonly number[];
  /** A small cairn in the widest gap between its ways. Null near a place or another cairn, or where no dry, clear ground fits one. */
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
/** The index of each neighbor's opposite step. */
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
  /** The network so far, as one bit per neighbor direction for each step a trail takes from a cell. */
  readonly edges: Uint16Array;
  /** Chebyshev distance in routing cells to the nearest way, 0 on one and capped at `TRAILS.besideCells + 1`. */
  readonly near: Uint8Array;
  /** Whether each `GRID_BLOCK`-square block of cells has its ground filled. A block is filled when a search first reaches it. */
  readonly ready: Uint8Array;
  /** Fills a block's height, slope, depth and wander. */
  readonly fill: (block: number) => void;
  // Per-search scratch. A cell's `cost` and `came` are valid where `seen` holds the search's number, and it is settled where `settled` does.
  readonly cost: Float64Array;
  readonly came: Int32Array;
  readonly seen: Uint32Array;
  readonly settled: Uint32Array;
  searches: number;
}

/** Side in cells of the blocks the routing grid fills its ground in. */
const GRID_BLOCK = 32;

function gridOf(t: Terrain, seed: number, avoid: readonly Occupied[]): Grid {
  const half = t.spec.size / 2 - TRAILS.margin;
  const n = Math.floor((half * 2) / TRAILS.cell) + 1;
  const origin = -half;
  const height = new Float32Array(n * n);
  const slope = new Float32Array(n * n);
  const depth = new Float32Array(n * n);
  const wander = new Float32Array(n * n);
  const blocks = Math.ceil(n / GRID_BLOCK);
  // Fill only the blocks a search reaches, since a large world's routes cross a small part of it.
  const fill = (block: number): void => {
    const bi = (block % blocks) * GRID_BLOCK;
    const bj = Math.floor(block / blocks) * GRID_BLOCK;
    for (let j = bj; j < Math.min(n, bj + GRID_BLOCK); j++) {
      for (let i = bi; i < Math.min(n, bi + GRID_BLOCK); i++) {
        const x = origin + i * TRAILS.cell;
        const z = origin + j * TRAILS.cell;
        const k = j * n + i;
        const h = heightAt(t.lattice, x, z);
        height[k] = h;
        slope[k] = slopeAt(t.lattice, x, z);
        // Use the water's depth (`waterDepthAt`), because `carveStream` also records a level over dry bank samples.
        depth[k] = waterDepthAt(t, x, z);
        wander[k] = 0.5 + 0.5 * fbm(seed, x / TRAILS.wander, z / TRAILS.wander, 2, 0.5);
      }
    }
  };
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
  return { n, origin, height, slope, depth, wander, blocked, edges: new Uint16Array(n * n), near, ready: new Uint8Array(blocks * blocks), fill, cost: new Float64Array(n * n), came: new Int32Array(n * n), seen: new Uint32Array(n * n), settled: new Uint32Array(n * n), searches: 0 };
}

/** Fills cell k's block if it is not filled yet. */
function readyCell(g: Grid, k: number): void {
  const blocks = Math.ceil(g.n / GRID_BLOCK);
  const block = Math.floor(Math.floor(k / g.n) / GRID_BLOCK) * blocks + Math.floor((k % g.n) / GRID_BLOCK);
  if (g.ready[block] === 1) return;
  g.ready[block] = 1;
  g.fill(block);
}

const cellOf = (g: Grid, x: number, z: number): number => {
  const i = Math.max(0, Math.min(g.n - 1, Math.round((x - g.origin) / TRAILS.cell)));
  const j = Math.max(0, Math.min(g.n - 1, Math.round((z - g.origin) / TRAILS.cell)));
  return j * g.n + i;
};
const cellX = (g: Grid, k: number): number => g.origin + (k % g.n) * TRAILS.cell;
const cellZ = (g: Grid, k: number): number => g.origin + Math.floor(k / g.n) * TRAILS.cell;

/** The cheapest chain of cells between two cells by A* search, or null when none exists. Steps on existing ways cost `TRAILS.join` times as much, and ground beside a way costs more. */
function search(g: Grid, start: number, goal: number, winding: number): number[] | null {
  const { n, cost, came, seen, settled } = g;
  // This search's number marks the cells it reached and settled. Every other cell reads as unreached.
  const id = ++g.searches;
  const costOf = (k: number): number => (seen[k] === id ? (cost[k] as number) : Infinity);
  readyCell(g, start);
  const gi = goal % n;
  const gj = Math.floor(goal / n);
  // The heuristic stays below the cheapest step cost per meter, so the search still finds a long way round along the network.
  const guess = (k: number): number => Math.hypot((k % n) - gi, Math.floor(k / n) - gj) * TRAILS.cell * TRAILS.join * 0.95;
  const heap = new Heap();
  cost[start] = 0;
  came[start] = -1;
  seen[start] = id;
  heap.push(start, guess(start));
  while (heap.size > 0) {
    const k = heap.pop();
    if (settled[k] === id) continue;
    settled[k] = id;
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
      if (settled[m] === id || (g.blocked[m] === 1 && m !== goal)) continue;
      readyCell(g, m);
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
      if (next < costOf(m)) {
        cost[m] = next;
        came[m] = k;
        seen[m] = id;
        heap.push(m, next + guess(m));
      }
    }
  }
  if (seen[goal] !== id || goal === start) return null;
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

/** Adds a trail's steps to the network and updates `near` around its cells. */
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

/** Four passes of Chaikin corner cutting, then resampling every `spacing` meters, so a trail curves instead of turning on the grid. */
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

/** Water under a tread shallower than this, in meters, gets no crossing. */
const WADE_DEPTH = 0.05;

/** Where segments a to b and c to d intersect, as a fraction 0 to 1 along a to b, or null when they don't. */
function meet(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number | null {
  const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (den === 0) return null;
  const u = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den;
  const v = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? u : null;
}

/**
 * Where the tread `points` crosses a stream. There is one crossing for each stretch under water that goes from one bank
 * to the other across the stream's course, spanning from the last dry point before it to the first dry point after. A
 * tread that only runs along a bank, or wades in and out on one side, crosses nothing. The level `carveStream` records
 * beside the water is not water to bridge.
 */
function crossingsOf(t: Terrain, points: Float32Array): Crossing[] {
  const count = points.length / 2;
  const px = (k: number): number => points[k * 2] as number;
  const pz = (k: number): number => points[k * 2 + 1] as number;
  const wet = (k: number): boolean => waterDepthAt(t, px(k), pz(k)) > 0;
  /** The position `f` points along the tread, interpolated. */
  const along = (f: number): [number, number] => {
    const k = Math.min(count - 2, Math.floor(f));
    return [px(k) + (px(k + 1) - px(k)) * (f - k), pz(k) + (pz(k + 1) - pz(k)) * (f - k)];
  };
  // How far along the tread, in points, it crosses each stream's course.
  const over: number[] = [];
  for (const stream of t.streams) {
    const st = stream.stations;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const q of st) {
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minZ = Math.min(minZ, q.z);
      maxZ = Math.max(maxZ, q.z);
    }
    for (let k = 0; k + 1 < count; k++) {
      if (Math.max(px(k), px(k + 1)) < minX || Math.min(px(k), px(k + 1)) > maxX || Math.max(pz(k), pz(k + 1)) < minZ || Math.min(pz(k), pz(k + 1)) > maxZ) continue;
      for (let j = 0; j + 1 < st.length; j++) {
        const a = st[j] as (typeof st)[number];
        const b = st[j + 1] as (typeof st)[number];
        const u = meet(px(k), pz(k), px(k + 1), pz(k + 1), a.x, a.z, b.x, b.z);
        if (u !== null) over.push(k + u);
      }
    }
  }
  over.sort((a, b) => a - b);
  const out: Crossing[] = [];
  let i = 0;
  while (i < over.length) {
    // The stretch under water around this crossing of the course, from the last dry point before to the first after.
    let a = Math.floor(over[i] as number);
    while (a > 0 && wet(a)) a--;
    let b = Math.ceil(over[i] as number);
    while (b < count - 1 && wet(b)) b++;
    // Count the course crossings within the stretch. An even count returns to the bank it left, so it crosses nothing.
    const course = over[i] as number;
    let within = 0;
    while (i < over.length && (over[i] as number) <= b) {
      within++;
      i++;
    }
    if (within % 2 === 0) continue;
    // Water under `WADE_DEPTH`, such as a damp spot or the thin end of a spring or seep, gets no crossing.
    let deepest = 0;
    for (let k = a; k <= b; k++) deepest = Math.max(deepest, waterDepthAt(t, px(k), pz(k)));
    if (deepest < WADE_DEPTH) continue;
    const ax = px(a);
    const az = pz(a);
    const bx = px(b);
    const bz = pz(b);
    const x = (ax + bx) / 2;
    const z = (az + bz) / 2;
    out.push({
      x,
      z,
      yaw: -Math.atan2(bz - az, bx - ax),
      span: Math.hypot(bx - ax, bz - az) + 1.6,
      // The water surface where the tread crosses the stream's course, which is under the deck whatever the chord.
      level: heightAt(t.lattice, ...along(course), t.waterLevel),
      bank: Math.max(heightAt(t.lattice, ax, az), heightAt(t.lattice, bx, bz)),
    });
  }
  return out;
}

function regionIndex(t: Terrain, x: number, z: number): number {
  const l = t.lattice;
  const ix = Math.max(0, Math.min(l.n - 1, Math.round((x - l.origin) / l.spacing)));
  const iz = Math.max(0, Math.min(l.n - 1, Math.round((z - (l.originZ ?? l.origin)) / l.spacing)));
  return t.region[iz * l.n + ix] ?? 0;
}

/** Each region's area inside the land, in square meters. */
function regionAreas(t: Terrain): number[] {
  const l = t.lattice;
  const areas = t.spec.regions.map(() => 0);
  for (let iz = 0; iz < l.n; iz++) {
    for (let ix = 0; ix < l.n; ix++) {
      if (!withinLand(t.spec, worldOf(l, ix), worldOf(l, iz))) continue;
      const r = t.region[iz * l.n + ix] ?? 0;
      areas[r] = (areas[r] ?? 0) + l.spacing * l.spacing;
    }
  }
  return areas;
}

const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;

/** A way's look from its trails, most wanted first: the first trail's look with the largest width and wear, and a footbridge by width, traffic or request. */
function wayStyle(carried: readonly TrailRequest[]): RouteSpec {
  const lead = carried[0] as TrailRequest;
  const width = Math.max(...carried.map((r) => r.style.width));
  const wear = Math.max(...carried.map((r) => r.style.wear));
  const bridged = carried.length >= 3 || width >= 1.8 || carried.some((r) => r.style.crossing === "footbridge");
  return { ...lead.style, width, wear, crossing: bridged ? "footbridge" : "stepping-stones" };
}

/** Places a junction's cairn in the widest gap between the ways leaving it, clear of every tread and on dry ground, or returns null. */
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
 * Routes the requested trails as one network of paths, most wanted first.
 * Each trail takes the ways earlier ones made wherever that is not much
 * farther, and never runs beside one, so trails share trunk paths and
 * branch at junctions. A trail is kept while the ground it adds keeps every
 * region it crosses within `TRAILS.share` of its ground and the whole land
 * within `TRAILS.landShare`. Shared ways add no ground. A trail over those
 * limits, or with no gentle, dry route between its places, goes in
 * `dropped` with the reason. Ends that share an id use the first one's
 * position. `avoid` keeps trails out of footprints such as a house's walls.
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

/** Cuts the routed trails' cells into ways between places and junctions, and records which trails use each way. */
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
  // A junction is where three or more ways meet away from a place. The busiest junctions get cairns first.
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

/** The lattice rectangle `nearPoints` visits for a way's points at `reach`. Every sample within reach of a segment lies inside it. */
function reachBox(l: Lattice, pts: Float32Array | readonly number[], reach: number): { i0: number; i1: number; j0: number; j1: number } {
  const oz = l.originZ ?? l.origin;
  let i0 = l.n - 1;
  let i1 = 0;
  let j0 = l.n - 1;
  let j1 = 0;
  for (let k = 0; k + 1 < pts.length / 2; k++) {
    const ax = pts[k * 2] as number;
    const az = pts[k * 2 + 1] as number;
    const bx = pts[k * 2 + 2] as number;
    const bz = pts[k * 2 + 3] as number;
    i0 = Math.min(i0, Math.max(0, Math.floor((Math.min(ax, bx) - reach - l.origin) / l.spacing)));
    i1 = Math.max(i1, Math.min(l.n - 1, Math.ceil((Math.max(ax, bx) + reach - l.origin) / l.spacing)));
    j0 = Math.min(j0, Math.max(0, Math.floor((Math.min(az, bz) - reach - oz) / l.spacing)));
    j1 = Math.max(j1, Math.min(l.n - 1, Math.ceil((Math.max(az, bz) + reach - oz) / l.spacing)));
  }
  // A way of one point, or one wholly outside the lattice, gets an empty box.
  return i1 < i0 || j1 < j0 ? { i0: 0, i1: -1, j0: 0, j1: -1 } : { i0, i1, j0, j1 };
}

/**
 * Visits every sample of `l` within `reach` of each segment of `pts`, with
 * its distance and the fractional point index of its nearest point on the
 * way. `l` may be the world's lattice or any window of it, and a sample gets
 * the same distance and position along the way in either.
 */
function nearPoints(l: Lattice, pts: Float32Array, reach: number, visit: (index: number, distance: number, along: number) => void): void {
  const oz = l.originZ ?? l.origin;
  const count = pts.length / 2;
  for (let k = 0; k + 1 < count; k++) {
    const ax = pts[k * 2] as number;
    const az = pts[k * 2 + 1] as number;
    const bx = pts[k * 2 + 2] as number;
    const bz = pts[k * 2 + 3] as number;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - l.origin) / l.spacing));
    const i1 = Math.min(l.n - 1, Math.ceil((Math.max(ax, bx) + reach - l.origin) / l.spacing));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - oz) / l.spacing));
    const j1 = Math.min(l.n - 1, Math.ceil((Math.max(az, bz) + reach - oz) / l.spacing));
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = Math.max(1e-9, dx * dx + dz * dz);
    for (let j = j0; j <= j1; j++) {
      const z = worldOfZ(l, j);
      for (let i = i0; i <= i1; i++) {
        const x = worldOf(l, i);
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
        const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
        if (d <= reach) visit(j * l.n + i, d, k + u);
      }
    }
  }
}

/** `nearPoints` over a way's points on the terrain's lattice. */
const nearSegments = (t: Pick<Terrain, "lattice">, way: Way, reach: number, visit: (index: number, distance: number, along: number) => void): void => nearPoints(t.lattice, way.points, reach, visit);

/**
 * Eases the baked ground under each way toward the tread's smoothed height,
 * blending back to the land over `TRAILS.blend` meters, as a cottage's pad
 * does. A trail on a hillside cuts a gentle bench, and bumps along the tread
 * soften. Water and the banks next to it never change, and no sample moves
 * more than `TRAILS.maxCut`. Returns each way's edit, in order.
 */
export function levelTrails(t: Terrain, ways: readonly Way[]): WayEdit[] {
  return ways.map((trail) => {
    const edit = wayEdit(t.lattice, trail);
    applyWay(t, edit);
    return edit;
  });
}

/** The data of one way's leveling by `levelTrails`, so a tile baked alone can apply it again. */
export interface WayEdit {
  readonly points: Float32Array;
  /** Half the tread's width, in meters. */
  readonly half: number;
  /** The tread's target height at each point, the ground height averaged over `TRAILS.grade` points either side before leveling. */
  readonly grade: Float32Array;
}

/** The edit that levels `trail` into the current ground of `l`. */
function wayEdit(l: Lattice, trail: Way): WayEdit {
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
  return { points: pts, half: trail.style.width / 2, grade };
}

/**
 * Levels one way's tread into `t`, which may be the world's land or any
 * window of it. Each sample's change depends only on its own position, water,
 * shore and the way, so a window gets the same bytes the world has there.
 */
export function applyWay(t: Pick<Terrain, "lattice" | "waterLevel" | "shore">, edit: WayEdit): void {
  const l = t.lattice;
  const { points: pts, half, grade } = edit;
  const count = pts.length / 2;
  const reach = half + TRAILS.blend;
  // Only samples within reach of the way can change, so the scratch covers
  // only the rectangle around it. The result matches a whole-land scratch at
  // a fraction of the memory and time.
  const box = reachBox(l, pts, reach);
  const w0 = box.i1 - box.i0 + 1;
  const best = new Float32Array(Math.max(0, w0 * (box.j1 - box.j0 + 1))).fill(Infinity);
  const target = new Float32Array(best.length);
  nearPoints(l, pts, reach, (index, d, along) => {
    const local = (Math.floor(index / l.n) - box.j0) * w0 + (index % l.n) - box.i0;
    if (d >= (best[local] as number)) return;
    best[local] = d;
    const k = Math.min(count - 1, Math.floor(along));
    const f = along - k;
    target[local] = (grade[k] as number) * (1 - f) + (grade[Math.min(count - 1, k + 1)] as number) * f;
  });
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      const local = (j - box.j0) * w0 + (i - box.i0);
      const index = j * l.n + i;
      const d = best[local] as number;
      if (d === Infinity || (t.waterLevel[index] as number) > DRY / 2) continue;
      const u = Math.max(0, Math.min(1, (d - half - 0.3) / TRAILS.blend));
      const shore = Math.max(0, Math.min(1, ((t.shore[index] as number) - 1.5) / 2.5));
      const w = (1 - u * u * (3 - 2 * u)) * shore * shore * (3 - 2 * shore);
      if (w <= 0) continue;
      const h = l.heights[index] as number;
      const delta = Math.max(-TRAILS.maxCut, Math.min(TRAILS.maxCut, (target[local] as number) - h));
      l.heights[index] = h + delta * w;
    }
  }
}

/**
 * Signed distance in meters from each lattice sample to the nearest way's
 * edge, negative on the tread and capped at `TRAILS.reach`. The ground draws
 * worn earth from it and grass stays off the tread. Water samples read
 * `TRAILS.reach`.
 */
export function trailField(t: Pick<Terrain, "lattice" | "waterLevel">, ways: readonly Way[]): Float32Array {
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

/** Packs a way's index and a position along it, 0 to 1, into one number, with the position times 0.999 as the fraction. */
const packPlace = (index: number, along: number): number => index + 0.999 * Math.max(0, Math.min(1, along));

/** Unpacks a `trailPlaces` value into the way's index and position along it, 0 at its first point and 1 at its last. Returns null for a negative value. */
export function unpackPlace(packed: number): { way: number; along: number } | null {
  if (packed < 0) return null;
  const way = Math.floor(packed);
  return { way, along: (packed - way) / 0.999 };
}

/**
 * Which ways each lattice sample lies on, two numbers per sample. The first
 * is the nearest way within `reach` of its edge. The second is another way
 * whose edge is within `TRAILS.meet` meters of the first's, as where ways
 * meet at a junction. Each is -1 for none. A value packs the way's index in
 * `ways` and the sample's position along it, 0 at its first point and 1 at
 * its last (`unpackPlace`), so a shader can look up the way's live wear
 * (`wayWear`), which follows the vitality of every trail on it.
 */
export function trailPlaces(t: Pick<Terrain, "lattice" | "waterLevel">, ways: readonly Way[], reach: number = TRAILS.reach): Float32Array {
  const every = Int32Array.from({ length: t.lattice.n }, (_, i) => i);
  return trailPlacesOn(t, ways, every, every, reach);
}

/**
 * `trailPlaces` on a grid of lattice samples, columns `columns` of rows
 * `rows`, row-major, with every way reaching `reach` meters past its edge.
 * Both lists hold lattice indices and never decrease, so a grid may repeat
 * the lattice's edge. Each sample gets the value `trailPlaces` gives it, so a
 * window of the land around the person, or every 2^k-th sample of it, is
 * built from the ways alone.
 */
export function trailPlacesOn(t: Pick<Terrain, "lattice" | "waterLevel">, ways: readonly Way[], columns: Int32Array, rows: Int32Array, reach: number = TRAILS.reach): Float32Array {
  const l = t.lattice;
  const width = columns.length;
  const n = width * rows.length;
  const d1 = new Float32Array(n).fill(Infinity);
  const d2 = new Float32Array(n).fill(Infinity);
  const p1 = new Float32Array(n).fill(-1);
  const p2 = new Float32Array(n).fill(-1);
  const mine = new Float32Array(n).fill(Infinity);
  const along = new Float32Array(n);
  /** The first position in `list` holding `v` or more. */
  const from = (list: Int32Array, v: number): number => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[mid] as number) < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  if (n === 0) return new Float32Array(0);
  // The grid's world bounds. A segment farther than its reach from them visits none of the grid's samples.
  const x0 = worldOf(l, columns[0] as number);
  const x1 = worldOf(l, columns[width - 1] as number);
  const oz = l.originZ ?? l.origin;
  const z0 = worldOfZ(l, rows[0] as number);
  const z1 = worldOfZ(l, rows[rows.length - 1] as number);
  ways.forEach((trail, index) => {
    const half = trail.style.width / 2;
    const near = half + reach;
    const pts = trail.points;
    const count = pts.length / 2;
    const last = Math.max(1, count - 1);
    const touched: number[] = [];
    // Each segment visits the grid's samples within reach of it, as `nearSegments` visits the lattice's.
    for (let k = 0; k + 1 < count; k++) {
      const ax = pts[k * 2] as number;
      const az = pts[k * 2 + 1] as number;
      const bx = pts[k * 2 + 2] as number;
      const bz = pts[k * 2 + 3] as number;
      if (Math.max(az, bz) + near < z0 || Math.min(az, bz) - near > z1 || Math.max(ax, bx) + near < x0 || Math.min(ax, bx) - near > x1) continue;
      const c0 = from(columns, Math.max(0, Math.floor((Math.min(ax, bx) - near - l.origin) / l.spacing)));
      const c1 = from(columns, Math.min(l.n - 1, Math.ceil((Math.max(ax, bx) + near - l.origin) / l.spacing)) + 1);
      const r0 = from(rows, Math.max(0, Math.floor((Math.min(az, bz) - near - oz) / l.spacing)));
      const r1 = from(rows, Math.min(l.n - 1, Math.ceil((Math.max(az, bz) + near - oz) / l.spacing)) + 1);
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = Math.max(1e-9, dx * dx + dz * dz);
      for (let r = r0; r < r1; r++) {
        const j = rows[r] as number;
        const z = worldOfZ(l, j);
        for (let c = c0; c < c1; c++) {
          const i = columns[c] as number;
          const x = worldOf(l, i);
          const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
          const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
          if (d > near || (t.waterLevel[j * l.n + i] as number) > DRY / 2) continue;
          const s = r * width + c;
          if ((mine[s] as number) === Infinity) touched.push(s);
          if (d - half < (mine[s] as number)) {
            mine[s] = d - half;
            along[s] = (k + u) / last;
          }
        }
      }
    }
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
 * The vitality a trail shows at a point `along` it, 0 at its first end and 1
 * at its second. Each end entity's vitality holds near its end, and the two
 * blend across the middle.
 */
export const trailVitalityAt = (fromVitality: number, toVitality: number, along: number): number =>
  fromVitality + (toVitality - fromVitality) * smooth(0.15, 0.85, along);

/**
 * How worn a trail's tread is at a point `along` it, from its blueprint's
 * `wear` and the vitality of the entities at its ends. At high vitality the
 * trail has its full `wear`. As vitality falls the wear drops to a fifth of
 * it, a faint trace, so the route still shows. It follows the same vitality
 * curve as the land around it (`shownVitality`). The ground and grass shaders
 * apply the same numbers live (`TRAIL_GLSL` in the app's trails), so a
 * vitality change never rebakes.
 */
export const trailWearAt = (wear: number, fromVitality: number, toVitality: number, along: number): number =>
  wear * (0.2 + 0.8 * smooth(0.05, 0.75, shownVitality(trailVitalityAt(fromVitality, toVitality, along))));

/**
 * How worn a way is at each of its `TRAILS.stations`, evenly spaced from its
 * first point to its last. Each trail on it contributes its `trailWearAt`,
 * and the wears combine as independent probabilities: wear `a` from one
 * trail and `b` from another give 1 - (1 - a)(1 - b). So a shared way is
 * never less worn than its most worn trail, and it grows over only when every
 * trail on it has low vitality. The shaders blend between the stations
 * (`wayWearAt`). Call it again whenever an entity's vitality changes.
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
 * The vitality a way shows at a point `along` it, for what is built on it,
 * such as a footbridge or edging stones. It is the highest vitality of its
 * trails at that point.
 */
export function wayVitalityAt(network: TrailNetwork, way: number, along: number, vitalityOf: (place: string) => number): number {
  let best = 0;
  for (const c of network.ways[way]?.carries ?? []) {
    const tr = network.trails[c.trail];
    if (tr !== undefined) best = Math.max(best, trailVitalityAt(vitalityOf(tr.from), vitalityOf(tr.to), c.from + (c.to - c.from) * along));
  }
  return best;
}

/** A junction's vitality, for its cairn: the highest of its ways' vitalities at the junction. */
export function junctionVitality(network: TrailNetwork, junction: Junction, vitalityOf: (place: string) => number): number {
  return Math.max(0, ...junction.ways.map((i) => wayVitalityAt(network, i, network.ways[i]?.from === junction.id ? 0 : 1, vitalityOf)));
}

/** Footprints along each way's tread and around each junction's cairn, which trees and the understory avoid. */
export function trailDiscs(network: TrailNetwork, margin: number): Occupied[] {
  const out: Occupied[] = [];
  for (const way of network.ways) {
    const pts = way.points;
    for (let k = 0; k < pts.length / 2; k += 2) out.push({ x: pts[k * 2] as number, z: pts[k * 2 + 1] as number, radius: way.style.width / 2 + margin });
  }
  for (const j of network.junctions) if (j.cairn !== null) out.push({ x: j.cairn.x, z: j.cairn.z, radius: 0.6 + margin });
  return out;
}

/** A small stone on an edge of a way's tread, set on the ground. `edgeStones` places none in or beside water. */
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
      // Skip 42% of spots and jitter the rest, so the gaps are uneven.
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
