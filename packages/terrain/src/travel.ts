// Plans and steps trips along trails or across open ground. A trip goes
// around solids and deep water, turns the view no faster than `STEER.rate`,
// and slows for bends. When the person turns the view by hand, the trip stops
// turning it until it faces the route again.

import { type Deck, type Footbed, deckAt } from "./gait.ts";
import { heightAt } from "./lattice.ts";
import type { Crossing, TrailNetwork, Way } from "./paths.ts";
import type { Solids } from "./solids.ts";
import { STEER } from "./steer.ts";
import { type Walker, planWalk } from "./walk.ts";
import { inWilds } from "./wilds.ts";
import { DRY, type Terrain } from "./world.ts";

const DEG = Math.PI / 180;
/** Travel constants. The design rationale is in docs/design-system.md#terrain-walking-and-travel. */
export const TRAVEL = {
  /** Speed in meters per second along a straight way, about five times walking pace. */
  pace: 20,
  /** Top speed in meters per second off the tread, while joining it and leaving it for the place. */
  off: 8,
  /** Fastest view turn in radians per second, the same as a held key's. */
  turn: STEER.rate,
  /** Bends are taken slowly enough that the way ahead turns at most this share of `turn`, so the view keeps up. */
  bend: 0.8,
  /** Constant acceleration, and deceleration to arrive, in meters per second squared. */
  accel: 6,
  /** Deceleration in meters per second squared once the person takes over with the keys. */
  brake: 9,
  /** Meters ahead along the way that the view looks, so a tread's small wiggles do not turn it. */
  ahead: 12,
  /** Radians within which the view must face the way ahead before the body sets off. A view turned by hand resumes following within this angle. */
  facing: 6 * DEG,
  /** Meters between a trip's samples. */
  spacing: 1,
  /** Minimum speed in meters per second before arrival. */
  creep: 0.3,
  /** A trip goes across the land instead of along the trails when the trails' way is longer than this many times the straight distance. */
  detour: 1.5,
  /** Where a trip wades, and `fordReach` meters either side, its speed is at most `ford` meters per second, walking pace. */
  ford: 4.2,
  fordReach: 4,
  /** Seconds a trip may still take once the open journal hides the world (`hurryFor`). */
  underBook: 6,
} as const;

/**
 * The way across the land: its grid's cell and margin past both ends, in
 * meters. Water up to `deep` meters is waded only where no crossing is near,
 * and each wet cell costs `wet` dry ones, so a stream is crossed where it is
 * narrowest. Deeper water is a detour. Each leg is planned around solids
 * `leg` meters at a time.
 */
const ACROSS = { cell: 4, margin: 240, deep: 0.4, wet: 25, leg: 80 } as const;

/** The angle from `a` to `b`, between -π and π. */
const turnTo = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));
/** The yaw a person faces looking along (dx, dz): forward is (-sin yaw, -cos yaw). */
const yawAlong = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

// ---------- the way along the trails ----------

/** The way and point index of the tread point nearest (x, z). */
function nearestTread(network: TrailNetwork, x: number, z: number): { readonly way: number; readonly point: number } | null {
  let best: { way: number; point: number } | null = null;
  let near = Infinity;
  network.ways.forEach((w, i) => {
    for (let p = 0; p < w.points.length / 2; p++) {
      const d = ((w.points[p * 2] as number) - x) ** 2 + ((w.points[p * 2 + 1] as number) - z) ** 2;
      if (d < near) {
        near = d;
        best = { way: i, point: p };
      }
    }
  });
  return best;
}

/** Meters along a way to its point `p`, since its points are evenly spaced. */
const alongWay = (w: Way, p: number): number => (p / Math.max(1, w.points.length / 2 - 1)) * w.length;

/** Points `from` to `to` of a way, both included, in that order. */
function slice(w: Way, from: number, to: number, out: Walker[]): void {
  const step = to >= from ? 1 : -1;
  for (let p = from; p !== to + step; p += step) out.push({ x: w.points[p * 2] as number, z: w.points[p * 2 + 1] as number });
}

/** The ways at each place and junction, cached per network. */
const joins = new WeakMap<TrailNetwork, Map<string, number[]>>();
function joinsOf(network: TrailNetwork): Map<string, number[]> {
  let out = joins.get(network);
  if (out === undefined) {
    out = new Map();
    network.ways.forEach((w, i) => {
      for (const end of new Set([w.from, w.to])) out?.set(end, [...(out.get(end) ?? []), i]);
    });
    joins.set(network, out);
  }
  return out;
}

/**
 * The shortest way along the trails from the tread nearest `from` to the
 * tread nearest `to`, as points about a meter apart. Returns null when there
 * are no ways or none connect the two.
 */
export function trailWay(network: TrailNetwork, from: Walker, to: Walker): Walker[] | null {
  const a = nearestTread(network, from.x, from.z);
  const b = nearestTread(network, to.x, to.z);
  if (a === null || b === null) return null;
  const start = network.ways[a.way] as Way;
  const end = network.ways[b.way] as Way;
  const out: Walker[] = [];
  if (a.way === b.way) {
    slice(start, a.point, b.point, out);
    return out;
  }
  // Dijkstra over places and junctions, starting from both ends of the trip's first way.
  const onStart = alongWay(start, a.point);
  const cost = new Map<string, number>([[start.from, onStart]]);
  cost.set(start.to, Math.min(cost.get(start.to) ?? Infinity, start.length - onStart));
  const via = new Map<string, number>();
  const done = new Set<string>();
  const ways = joinsOf(network);
  for (;;) {
    let at: string | null = null;
    for (const [node, c] of cost) if (!done.has(node) && (at === null || c < (cost.get(at) as number))) at = node;
    if (at === null) break;
    done.add(at);
    for (const i of ways.get(at) ?? []) {
      const w = network.ways[i] as Way;
      const next = w.from === at ? w.to : w.from;
      const c = (cost.get(at) as number) + w.length;
      if (c < (cost.get(next) ?? Infinity)) {
        cost.set(next, c);
        via.set(next, i);
      }
    }
  }
  // Enter the last way from whichever end gives the shorter total.
  const inFrom = (cost.get(end.from) ?? Infinity) + alongWay(end, b.point);
  const inTo = (cost.get(end.to) ?? Infinity) + end.length - alongWay(end, b.point);
  if (!Number.isFinite(Math.min(inFrom, inTo))) return null;
  const enter = inFrom <= inTo ? end.from : end.to;
  // Walk back from that end to the start way, recording each way taken and the end the trip entered it by.
  const taken: { way: number; from: string }[] = [];
  let first = enter;
  while (via.has(first)) {
    const i = via.get(first) as number;
    const w = network.ways[i] as Way;
    first = w.to === first ? w.from : w.to;
    taken.unshift({ way: i, from: first });
  }
  slice(start, a.point, first === start.from ? 0 : start.points.length / 2 - 1, out);
  for (const step of taken) {
    const w = network.ways[step.way] as Way;
    const n = w.points.length / 2 - 1;
    if (w.from === step.from) slice(w, 0, n, out);
    else slice(w, n, 0, out);
  }
  slice(end, enter === end.from ? 0 : end.points.length / 2 - 1, b.point, out);
  // Where two ways meet, their shared end is listed twice.
  return out.filter((p, i) => i === 0 || Math.hypot(p.x - (out[i - 1] as Walker).x, p.z - (out[i - 1] as Walker).z) > 1e-3);
}

// ---------- the way straight across ----------

/** Water depth in meters at (x, z), or 0 on dry ground and in the wild. It reads through `Lattice.beyond` past the land's window. */
function waterAt(t: Terrain, x: number, z: number): number {
  if (inWilds(t, x, z)) return 0;
  const level = heightAt(t.lattice, x, z, t.waterLevel);
  return level > DRY / 2 ? Math.max(0, level - heightAt(t.lattice, x, z)) : 0;
}

/** Water depth in meters below which walking counts as dry, with no splash. */
const DAMP = 0.05;

/** Whether a person at (x, z) wades, meaning in water and not on a footbridge's deck. */
export function wadingAt(t: Terrain, decks: readonly Footbed[], x: number, z: number): boolean {
  return waterAt(t, x, z) > DAMP && deckAt(decks, x, z) === -Infinity;
}

/** Whether the straight line from a to b stays dry, checked every meter. */
function dryLine(t: Terrain, a: Walker, b: Walker): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
  for (let i = 1; i < n; i++) if (waterAt(t, a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n) > DAMP) return false;
  return true;
}

/**
 * The way across the land from `from` to `to`, on a grid of `ACROSS.cell`
 * meters. It stays out of water, crossing a stream on one of the trails'
 * `crossings`, such as a footbridge or stepping stones, or else where the
 * stream is narrowest and shallow enough to wade. The path is then pulled
 * taut over dry ground and planned around solids a leg at a time
 * (`planWalk`). Returns null where deep water rings either end.
 */
export function acrossWay(t: Terrain, solids: Solids, from: Walker, to: Walker, crossings: readonly Crossing[] = []): Walker[] | null {
  const h = ACROSS.cell;
  const x0 = Math.min(from.x, to.x) - ACROSS.margin;
  const z0 = Math.min(from.z, to.z) - ACROSS.margin;
  const nx = Math.ceil((Math.max(from.x, to.x) + ACROSS.margin - x0) / h) + 1;
  const nz = Math.ceil((Math.max(from.z, to.z) + ACROSS.margin - z0) / h) + 1;
  const cellOf = (p: Walker): number => Math.round((p.z - z0) / h) * nx + Math.round((p.x - x0) / h);
  const at = (i: number): Walker => ({ x: x0 + (i % nx) * h, z: z0 + Math.floor(i / nx) * h });
  const start = cellOf(from);
  const goal = cellOf(to);
  const state = new Uint8Array(nx * nz); // 0 unknown, 1 dry, 2 wet, 3 deep
  // Mark a crossing's cells dry from bank to bank along its axis, where local +x runs along the way.
  for (const c of crossings) {
    const dx = Math.cos(c.yaw);
    const dz = -Math.sin(c.yaw);
    for (let u = -c.span / 2 - h; u <= c.span / 2 + h; u += 1) {
      const i = cellOf({ x: c.x + dx * u, z: c.z + dz * u });
      if (i >= 0 && i < state.length) state[i] = 1;
    }
  }
  const kind = (i: number): number => {
    if (i === start || i === goal) return 1;
    if (state[i] === 0) {
      const p = at(i);
      const depth = waterAt(t, p.x, p.z);
      state[i] = depth > ACROSS.deep ? 3 : depth > DAMP ? 2 : 1;
    }
    return state[i] as number;
  };
  const open = (i: number): boolean => kind(i) !== 3;
  const g = new Float32Array(nx * nz).fill(Infinity);
  const parent = new Int32Array(nx * nz).fill(-1);
  const done = new Uint8Array(nx * nz);
  const gx = goal % nx;
  const gz = Math.floor(goal / nx);
  const guess = (i: number): number => Math.hypot((i % nx) - gx, Math.floor(i / nx) - gz);
  // A binary heap of cells by g + guess.
  const heap: number[] = [];
  const key = new Float32Array(nx * nz);
  const push = (i: number): void => {
    let c = heap.length;
    heap.push(i);
    while (c > 0) {
      const up = (c - 1) >> 1;
      if ((key[heap[up] as number] as number) <= (key[i] as number)) break;
      heap[c] = heap[up] as number;
      c = up;
    }
    heap[c] = i;
  };
  const pop = (): number => {
    const top = heap[0] as number;
    const last = heap.pop() as number;
    if (heap.length > 0) {
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        if (l >= heap.length) break;
        const r = l + 1;
        const m = r < heap.length && (key[heap[r] as number] as number) < (key[heap[l] as number] as number) ? r : l;
        if ((key[heap[m] as number] as number) >= (key[last] as number)) break;
        heap[c] = heap[m] as number;
        c = m;
      }
      heap[c] = last;
    }
    return top;
  };
  g[start] = 0;
  key[start] = guess(start);
  push(start);
  while (heap.length > 0) {
    const i = pop();
    if (done[i] === 1) continue;
    done[i] = 1;
    if (i === goal) break;
    const ix = i % nx;
    const iz = Math.floor(i / nx);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dz === 0) || ix + dx < 0 || ix + dx >= nx || iz + dz < 0 || iz + dz >= nz) continue;
        const j = i + dz * nx + dx;
        // A diagonal step never cuts a corner of deep water.
        if (!open(j) || (dx !== 0 && dz !== 0 && (!open(i + dx) || !open(i + dz * nx)))) continue;
        const c = (g[i] as number) + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1) * (kind(j) === 2 ? ACROSS.wet : 1);
        if (c < (g[j] as number)) {
          g[j] = c;
          parent[j] = i;
          key[j] = c + guess(j);
          push(j);
        }
      }
    }
  }
  if (done[goal] !== 1) return null;
  const cells: Walker[] = [];
  for (let i = goal; i !== -1; i = parent[i] as number) cells.unshift(at(i));
  cells[0] = { x: from.x, z: from.z };
  cells[cells.length - 1] = { x: to.x, z: to.z };
  // Pull the path taut by going straight from each corner to the farthest cell with a dry straight line.
  const taut: Walker[] = [cells[0] as Walker];
  for (let i = 0; i < cells.length - 1; ) {
    let j = i + 1;
    while (j + 1 < cells.length && dryLine(t, cells[i] as Walker, cells[j + 1] as Walker)) j++;
    taut.push(cells[j] as Walker);
    i = j;
  }
  // Plan around solids a piece at a time, each piece starting where the last ended.
  const way: Walker[] = [taut[0] as Walker];
  for (let k = 1; k < taut.length; k++) {
    const a = taut[k - 1] as Walker;
    const b = taut[k] as Walker;
    const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / ACROSS.leg));
    for (let p = 1; p <= pieces; p++) {
      const target = { x: a.x + ((b.x - a.x) * p) / pieces, z: a.z + ((b.z - a.z) * p) / pieces };
      const walk = planWalk(t, solids, way[way.length - 1] as Walker, target);
      way.push(...walk.way.slice(1));
    }
  }
  return way;
}

// ---------- a broken footbridge ----------

/** Meters past a broken deck's rail where a trip fords (`clear`), and meters of bank either side over which it eases out to that line (`ease`). */
const FORD_BESIDE = { clear: 0.9, ease: 4 } as const;

/**
 * Moves a way that crosses a footbridge whose decks no longer hold (`broken`)
 * to ford the stream beside it. The way runs through the water
 * `FORD_BESIDE.clear` meters past the rail, on the side where the water is
 * shallower, and eases out to that line over the bank either side. Every
 * other point stays where it is.
 */
export function fordBeside(t: Terrain, way: readonly Walker[], broken: readonly Deck[]): Walker[] {
  if (broken.length === 0) return [...way];
  const sides = broken.map((d) => {
    const off = d.halfWidth + FORD_BESIDE.clear;
    const depth = (v: number): number => waterAt(t, d.x + v * d.sin, d.z + v * d.cos);
    return depth(off) <= depth(-off) ? off : -off;
  });
  return way.map((p) => {
    let { x, z } = p;
    broken.forEach((d, i) => {
      const dx = x - d.x;
      const dz = z - d.z;
      const u = dx * d.cos - dz * d.sin;
      const v = dx * d.sin + dz * d.cos;
      const side = sides[i] as number;
      if (Math.abs(v) > Math.abs(side) || Math.abs(u) > d.half + FORD_BESIDE.ease) return;
      const e = Math.min(1, Math.max(0, (d.half + FORD_BESIDE.ease - Math.abs(u)) / FORD_BESIDE.ease));
      const nv = v + (side - v) * e * e * (3 - 2 * e);
      x = d.x + u * d.cos + nv * d.sin;
      z = d.z - u * d.sin + nv * d.cos;
    });
    return { x, z };
  });
}

// ---------- the trip ----------

/** A trip planned along its way, sampled `TRAVEL.spacing` apart. */
export interface Trip {
  /** x and z pairs from where it starts to where it ends. */
  readonly points: Float32Array;
  /** The yaw that looks along the way ahead from each point. */
  readonly heading: Float32Array;
  /**
   * The top speed in meters per second at each point. It is the pace on or
   * off the tread, lowered for wading, for the bends ahead and to arrive.
   */
  readonly pace: Float32Array;
  readonly length: number;
  /** The yaw the trip leaves the person facing, or null to face as they arrived. */
  readonly face: number | null;
}

/**
 * Plans a trip along `way`. Its first `off.start` and last `off.end` meters
 * are off the tread. It goes at `pace` on the tread and at walking pace
 * wherever it is `wading` (`TRAVEL.ford`), and ends facing `face` if given.
 */
export function planTrip(way: readonly Walker[], off: { readonly start: number; readonly end: number }, face: number | null = null, pace: number = TRAVEL.pace, wading: (x: number, z: number) => boolean = () => false): Trip {
  const along = [0];
  for (let i = 1; i < way.length; i++) along.push((along[i - 1] as number) + Math.hypot((way[i] as Walker).x - (way[i - 1] as Walker).x, (way[i] as Walker).z - (way[i - 1] as Walker).z));
  const length = along[along.length - 1] ?? 0;
  const n = Math.max(2, Math.ceil(length / TRAVEL.spacing) + 1);
  const ds = length / (n - 1);
  const points = new Float32Array(n * 2);
  let leg = 0;
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    while (leg < way.length - 2 && (along[leg + 1] as number) < s) leg++;
    const p = way[leg] as Walker;
    const q = way[Math.min(leg + 1, way.length - 1)] as Walker;
    const span = (along[Math.min(leg + 1, way.length - 1)] as number) - (along[leg] as number);
    const k = span > 1e-9 ? Math.min(1, Math.max(0, (s - (along[leg] as number)) / span)) : 0;
    points[i * 2] = p.x + (q.x - p.x) * k;
    points[i * 2 + 1] = p.z + (q.z - p.z) * k;
  }
  // The heading is the chord over the next `TRAVEL.ahead` meters. Near the end the chord keeps its length and ends at the last point.
  const reach = Math.max(1, Math.round(TRAVEL.ahead / Math.max(ds, 1e-9)));
  const heading = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + reach);
    const lo = Math.max(0, hi - reach);
    const dx = (points[hi * 2] as number) - (points[lo * 2] as number);
    const dz = (points[hi * 2 + 1] as number) - (points[lo * 2 + 1] as number);
    heading[i] = Math.hypot(dx, dz) > 1e-6 ? yawAlong(dx, dz) : i > 0 ? (heading[i - 1] as number) : 0;
  }
  // Where the way wades, and `fordReach` either side, it goes at walking pace.
  const wet = new Uint8Array(n);
  const reachFord = Math.ceil(TRAVEL.fordReach / Math.max(ds, 1e-9));
  for (let i = 0; i < n; i++) {
    if (!wading(points[i * 2] as number, points[i * 2 + 1] as number)) continue;
    for (let j = Math.max(0, i - reachFord); j <= Math.min(n - 1, i + reachFord); j++) wet[j] = 1;
  }
  const paces = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    // A sample within a step of the tread's end is off it too, so the pace between samples never rises past `off`.
    const offTread = s < off.start + ds || s > length - off.end - ds;
    // How fast the heading turns here in radians per meter, over the steps either side.
    let bend = 0;
    for (const j of [i - 1, i]) if (j >= 0 && j < n - 1) bend = Math.max(bend, Math.abs(turnTo(heading[j] as number, heading[j + 1] as number)) / Math.max(ds, 1e-9));
    paces[i] = Math.min(offTread ? Math.min(TRAVEL.off, pace) : pace, wet[i] === 1 ? TRAVEL.ford : Infinity, bend > 1e-9 ? (TRAVEL.bend * TRAVEL.turn) / bend : Infinity);
  }
  // Cap each pace so the body can slow at `TRAVEL.accel` for every bend ahead and stop at the end. `travelStep` handles speeding up.
  paces[n - 1] = 0;
  for (let i = n - 2; i >= 0; i--) paces[i] = Math.min(paces[i] as number, Math.sqrt((paces[i + 1] as number) ** 2 + 2 * TRAVEL.accel * ds));
  return { points, heading, pace: paces, length, face };
}

/** A person's state on a trip: meters along (`s`), speed (`v`), position and yaw. */
export interface Travel {
  readonly s: number;
  readonly v: number;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** Whether the trip turns the view. It stops when a hand turns the view away, and resumes when the view faces the way again. */
  readonly follows: boolean;
  /** Whether the body has set off. It waits until the view faces the way ahead. */
  readonly going: boolean;
  /** Whether the trip is over: arrived and facing its final yaw. */
  readonly done: boolean;
}

/** Linear interpolation between a trip's samples at `s` meters. */
function sampleAt(trip: Trip, values: Float32Array, s: number, stride = 1, offset = 0): number {
  const n = values.length / stride;
  const f = Math.min(n - 1, Math.max(0, (s / Math.max(trip.length, 1e-9)) * (n - 1)));
  const i = Math.min(n - 2, Math.floor(f));
  const a = values[i * stride + offset] as number;
  const b = values[(i + 1) * stride + offset] as number;
  return a + (b - a) * (f - i);
}
function paceAt(trip: Trip, s: number): number {
  const n = trip.pace.length;
  const f = Math.min(n - 1, Math.max(0, (s / Math.max(trip.length, 1e-9)) * (n - 1)));
  const i = Math.min(n - 2, Math.floor(f));
  const a = (trip.pace[i] as number) ** 2;
  return Math.sqrt(a + ((trip.pace[i + 1] as number) ** 2 - a) * (f - i));
}
function headingAt(trip: Trip, s: number): number {
  const n = trip.heading.length;
  const f = Math.min(n - 1, Math.max(0, (s / Math.max(trip.length, 1e-9)) * (n - 1)));
  const i = Math.min(n - 2, Math.floor(f));
  const a = trip.heading[i] as number;
  return a + turnTo(a, trip.heading[i + 1] as number) * (f - i);
}

/** The point `s` meters along a trip's way. */
export function travelPoint(trip: Trip, s: number): Walker {
  return { x: sampleAt(trip, trip.points, s, 2, 0), z: sampleAt(trip, trip.points, s, 2, 1) };
}

/** The rest of a trip's way from `s` meters along: the point there, then each later sample to the end. */
export function wayLeft(trip: Trip, s: number): Walker[] {
  const n = trip.points.length / 2;
  const f = Math.min(n - 1, Math.max(0, (s / Math.max(trip.length, 1e-9)) * (n - 1)));
  const out = [travelPoint(trip, s)];
  for (let i = Math.floor(f) + 1; i < n; i++) out.push({ x: trip.points[i * 2] as number, z: trip.points[i * 2 + 1] as number });
  return out;
}

/**
 * The speed multiplier a trip needs from `at` to arrive within `seconds`. It
 * steps the trip at its own pace, without waiting on the land, and divides
 * that time by `seconds`. It is never under 1, so a trip that arrives sooner
 * keeps its own pace. Stepping the trip `hurry` times as far in time each
 * frame plays its pace, turns and slowing that much faster along the same way.
 */
export function hurryFor(trip: Trip, at: Travel, seconds: number = TRAVEL.underBook): number {
  const dt = 1 / 60;
  let t = at;
  let own = 0;
  while (!t.done && own < 3600) {
    t = travelStep(trip, t, dt, t.yaw);
    own += dt;
  }
  return Math.max(1, own / seconds);
}

/** A trip about to begin, the person facing `yaw`. */
export function travelFrom(trip: Trip, yaw: number): Travel {
  return { s: 0, v: 0, x: trip.points[0] as number, z: trip.points[1] as number, yaw, follows: true, going: false, done: trip.length <= 0 && trip.face === null };
}

/**
 * One step of `dt` seconds. `yaw` is where the view faces now: the trip's
 * last yaw, or where a hand or a key turned it since. With `stop`, the person
 * has taken over with the keys, so the trip slows them at `TRAVEL.brake` and
 * leaves the view to them. The world is ready only up to `ready` meters
 * along. The body slows at `TRAVEL.accel` toward that point and continues as
 * it moves on, never slower than `least`, so a trip keeps moving at that pace
 * instead of stopping while the way ahead loads.
 */
export function travelStep(trip: Trip, at: Travel, dt: number, yaw: number, stop = false, ready = Infinity, least = 0): Travel {
  if (at.done || dt <= 0) return at;
  const arrived = at.s >= trip.length - 1e-3;
  const ahead = arrived ? (trip.face ?? yaw) : headingAt(trip, at.s);
  // A hand that turned the view takes control of it. Facing the way again gives control back.
  let follows = at.follows && Math.abs(turnTo(at.yaw, yaw)) < 1e-6;
  if (!follows && !stop && Math.abs(turnTo(yaw, ahead)) < TRAVEL.facing) follows = true;
  let y = yaw;
  if (follows && !stop) {
    const left = turnTo(yaw, ahead);
    y = yaw + Math.sign(left) * Math.min(Math.abs(left), TRAVEL.turn * dt);
  }
  if (arrived) return { ...at, v: 0, yaw: y, follows, done: stop || !follows || Math.abs(turnTo(y, ahead)) < 1e-6 };
  const going = at.going || !follows || Math.abs(turnTo(y, ahead)) < TRAVEL.facing;
  // The pace where this step would take the body, with its square interpolated between samples so slowing is steady
  // between them too. It also slows steadily toward the point where the world ahead is not yet ready.
  const next = Math.min(trip.length, at.s + at.v * dt);
  const waits = ready < trip.length;
  const cap = Math.min(paceAt(trip, next), waits ? Math.max(least, Math.sqrt(2 * TRAVEL.accel * Math.max(0, ready - next))) : Infinity);
  let v = 0;
  if (stop) v = Math.min(cap, Math.max(0, at.v - TRAVEL.brake * dt));
  else if (going) v = Math.min(cap, at.v + TRAVEL.accel * dt);
  // Near the end the pace falls to 0, so the body creeps the last of the way at `TRAVEL.creep` instead of never arriving.
  if (going && !stop && !waits) v = Math.max(v, Math.min(TRAVEL.creep, at.v));
  const s = Math.min(trip.length, waits && least <= 0 ? Math.max(at.s, ready) : Infinity, at.s + ((at.v + v) / 2) * dt);
  const x = sampleAt(trip, trip.points, s, 2, 0);
  const z = sampleAt(trip, trip.points, s, 2, 1);
  const end = s >= trip.length - 1e-3;
  const stood = stop && v === 0;
  return { s, v, x, z, yaw: y, follows, going, done: stood || (end && (stop || trip.face === null || !follows || Math.abs(turnTo(y, trip.face)) < 1e-6)) };
}
