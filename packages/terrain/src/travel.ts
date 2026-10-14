// Travel along the trails to a far place, one pure step at a time (round 23's
// travel thread). A pick on the map no longer jumps the person there: they
// hurry along the ways, the world streaming in around them as it does for a
// walk, until they arrive or take the keys. Travel moves the view only as the
// person could have moved it with the keys: it turns at a held key's steady
// rate or slower, taking each bend only as fast as that allows; it gets going
// and slows at one steady rate; nothing bobs. A hand on the view takes it from
// the trail until the person looks along the way ahead again.

import { type Deck, deckAt } from "./gait.ts";
import { heightAt } from "./lattice.ts";
import type { Crossing, TrailNetwork, Way } from "./paths.ts";
import type { Solids } from "./solids.ts";
import { STEER } from "./steer.ts";
import { type Walker, planWalk } from "./walk.ts";
import { inWilds } from "./wilds.ts";
import { DRY, type Terrain } from "./world.ts";

const DEG = Math.PI / 180;
/** Every number of travel. Sources are in docs/design-system.md (Terrain, travel). */
export const TRAVEL = {
  /** The pace along a straight way, meters a second: about five times a walk. */
  pace: 20,
  /** Off the tread, joining it and leaving it for the place, no faster than this, meters a second: a hurried walk. */
  off: 8,
  /** The most the view turns, radians a second: a held key's own rate. */
  turn: STEER.rate,
  /** Each bend is taken slowly enough that the way ahead turns at most this share of `turn`, so the view keeps up and is never held back. */
  bend: 0.8,
  /** Getting going and slowing to arrive, meters a second squared, steady and never easing. */
  accel: 6,
  /** Slowing once the person takes the keys, meters a second squared. */
  brake: 9,
  /** The view looks along the way this far ahead, meters, so a tread's small wiggles never turn it. */
  ahead: 12,
  /** The body sets off once the view faces within this of the way ahead, radians; a hand on the view follows the way again within it. */
  facing: 6 * DEG,
  /** The trip is sampled this far apart, meters. */
  spacing: 1,
  /** The body never crawls slower than this before it arrives, meters a second. */
  creep: 0.3,
  /** A trip goes straight across the land, around what stands and the water, where the trails' way is longer than this many times the straight distance. */
  detour: 1.5,
  /** Wherever a trip wades, and this far either side, it goes at walking pace, meters a second, and meters. */
  ford: 4.2,
  fordReach: 4,
} as const;

/**
 * The way straight across the land: its grid's cell and reach past both
 * ends, meters. Water is kept out of as solids are: water up to `deep`
 * meters is waded only where no crossing is near, each wet cell costing
 * `wet` dry ones, so a stream is crossed where it is narrowest; deeper water
 * is gone around. Each leg is planned around solids `leg` meters at a time.
 */
const ACROSS = { cell: 4, margin: 240, deep: 0.4, wet: 25, leg: 80 } as const;

/** The angle from `a` to `b`, between -π and π. */
const turnTo = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));
/** The yaw a person faces looking along (dx, dz): forward is (-sin yaw, -cos yaw). */
const yawAlong = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

// ---------- the way along the trails ----------

/** The point of the tread nearest (x, z): its way and the point's index there. */
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

/** Meters along a way to its point `p`: its points lie evenly along it. */
const alongWay = (w: Way, p: number): number => (p / Math.max(1, w.points.length / 2 - 1)) * w.length;

/** Points `from` to `to` of a way, both included, in that order. */
function slice(w: Way, from: number, to: number, out: Walker[]): void {
  const step = to >= from ? 1 : -1;
  for (let p = from; p !== to + step; p += step) out.push({ x: w.points[p * 2] as number, z: w.points[p * 2 + 1] as number });
}

/** Each place's and junction's ways, kept with the network. */
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
 * tread nearest `to`, as points about a meter apart from one to the other;
 * null when there are no ways, or none join the two.
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
  // Shortest paths over the places and junctions the ways join, from either end of the way the trip starts on.
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
  // The trip leaves the last way's end that brings it nearest to the point it ends on.
  const inFrom = (cost.get(end.from) ?? Infinity) + alongWay(end, b.point);
  const inTo = (cost.get(end.to) ?? Infinity) + end.length - alongWay(end, b.point);
  if (!Number.isFinite(Math.min(inFrom, inTo))) return null;
  const enter = inFrom <= inTo ? end.from : end.to;
  // Walked back from the end to the start way's end it leaves by: each way taken, and the end it was entered by.
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

/** How deep the water is at (x, z), meters, read from the land's water level wherever the land is held; 0 on dry ground and in the wild. */
function waterAt(t: Terrain, x: number, z: number): number {
  if (inWilds(t, x, z)) return 0;
  const level = heightAt(t.lattice, x, z, t.waterLevel);
  return level > DRY / 2 ? Math.max(0, level - heightAt(t.lattice, x, z)) : 0;
}

/** Water shallower than this is dry enough to walk through without a splash, meters. */
const DAMP = 0.05;

/** Whether a person at (x, z) wades: in water, and not on a footbridge's deck. */
export function wadingAt(t: Terrain, decks: readonly Deck[], x: number, z: number): boolean {
  return waterAt(t, x, z) > DAMP && deckAt(decks, x, z) === -Infinity;
}

/** Whether the straight line from a to b stays dry, looked at every meter. */
function dryLine(t: Terrain, a: Walker, b: Walker): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
  for (let i = 1; i < n; i++) if (waterAt(t, a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n) > DAMP) return false;
  return true;
}

/**
 * The way straight across the land from `from` to `to`, on a grid of
 * `ACROSS.cell` meters: out of the water, crossing a stream on one of the
 * trails' `crossings` (a footbridge or stepping stones) or else where it is
 * narrowest and shallow enough to wade, then pulled taut over dry ground and
 * planned around whatever stands in the way a leg at a time (`planWalk`);
 * null where deep water rings either end.
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
  // A crossing's cells, from bank to bank along its axis (local +x runs along the way), are dry.
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
  // Pulled taut: from each corner, straight to the farthest cell still in sight over dry ground.
  const taut: Walker[] = [cells[0] as Walker];
  for (let i = 0; i < cells.length - 1; ) {
    let j = i + 1;
    while (j + 1 < cells.length && dryLine(t, cells[i] as Walker, cells[j + 1] as Walker)) j++;
    taut.push(cells[j] as Walker);
    i = j;
  }
  // Around what stands, a leg at a time: each piece starts where the last ended.
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

// ---------- the trip ----------

/** A trip planned along its way, sampled `TRAVEL.spacing` apart. */
export interface Trip {
  /** x and z pairs from where it starts to where it ends. */
  readonly points: Float32Array;
  /** The yaw that looks along the way ahead from each point. */
  readonly heading: Float32Array;
  /**
   * The fastest the body may go at each point, meters a second: the pace on
   * the tread and off it, slowed for the bends ahead, and slowing to arrive.
   */
  readonly pace: Float32Array;
  readonly length: number;
  /** The yaw the trip leaves the person facing, or null to face as they arrived. */
  readonly face: number | null;
}

/**
 * Plans a trip along `way`, its first `off.start` and last `off.end` meters
 * walked off the tread, ending facing `face` if given, at `pace` on the tread,
 * and at walking pace wherever it is `wading` (`TRAVEL.ford`).
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
  // The way ahead is the chord over the next `ahead` meters; near the end it keeps its length, ending at the end.
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
    // How fast the way ahead turns here, radians a meter, over the steps either side.
    let bend = 0;
    for (const j of [i - 1, i]) if (j >= 0 && j < n - 1) bend = Math.max(bend, Math.abs(turnTo(heading[j] as number, heading[j + 1] as number)) / Math.max(ds, 1e-9));
    paces[i] = Math.min(offTread ? Math.min(TRAVEL.off, pace) : pace, wet[i] === 1 ? TRAVEL.ford : Infinity, bend > 1e-9 ? (TRAVEL.bend * TRAVEL.turn) / bend : Infinity);
  }
  // Slowing at the steady rate for every bend ahead and to stand at the end; getting going is the step's.
  paces[n - 1] = 0;
  for (let i = n - 2; i >= 0; i--) paces[i] = Math.min(paces[i] as number, Math.sqrt((paces[i + 1] as number) ** 2 + 2 * TRAVEL.accel * ds));
  return { points, heading, pace: paces, length, face };
}

/** Where a trip has the person: how far along, how fast, where and facing where. */
export interface Travel {
  readonly s: number;
  readonly v: number;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** Whether the view follows the way ahead: not since a hand turned it away, until it looks along the way again. */
  readonly follows: boolean;
  /** Whether the body has set off: it waits until the view faces the way ahead. */
  readonly going: boolean;
  /** Whether the trip is over: arrived, and facing as it ends. */
  readonly done: boolean;
}

/** Linear between a trip's samples at `s` meters. */
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

/** Where a trip's way is `s` meters along. */
export function travelPoint(trip: Trip, s: number): Walker {
  return { x: sampleAt(trip, trip.points, s, 2, 0), z: sampleAt(trip, trip.points, s, 2, 1) };
}

/** A trip about to begin, the person facing `yaw`. */
export function travelFrom(trip: Trip, yaw: number): Travel {
  return { s: 0, v: 0, x: trip.points[0] as number, z: trip.points[1] as number, yaw, follows: true, going: false, done: trip.length <= 0 && trip.face === null };
}

/**
 * One step of `dt` seconds. `yaw` is where the view faces now: the trip's own
 * last yaw, or where a hand or a key turned it since. With `stop`, the person
 * has taken the keys: the trip slows them along the way at `TRAVEL.brake`
 * and leaves the view to them. The world stands ready only `ready` meters
 * along: the body slows at the steady rate to wait there, and goes on as it
 * moves on.
 */
export function travelStep(trip: Trip, at: Travel, dt: number, yaw: number, stop = false, ready = Infinity): Travel {
  if (at.done || dt <= 0) return at;
  const arrived = at.s >= trip.length - 1e-3;
  const ahead = arrived ? (trip.face ?? yaw) : headingAt(trip, at.s);
  // A hand that turned the view takes it; looking along the way again gives it back.
  let follows = at.follows && Math.abs(turnTo(at.yaw, yaw)) < 1e-6;
  if (!follows && !stop && Math.abs(turnTo(yaw, ahead)) < TRAVEL.facing) follows = true;
  let y = yaw;
  if (follows && !stop) {
    const left = turnTo(yaw, ahead);
    y = yaw + Math.sign(left) * Math.min(Math.abs(left), TRAVEL.turn * dt);
  }
  if (arrived) return { ...at, v: 0, yaw: y, follows, done: stop || !follows || Math.abs(turnTo(y, ahead)) < 1e-6 };
  const going = at.going || !follows || Math.abs(turnTo(y, ahead)) < TRAVEL.facing;
  // The pace where this step would take the body, its square read between samples, so slowing is steady between them
  // too; and slowing as steadily to wait where the world ahead is not yet ready.
  const next = Math.min(trip.length, at.s + at.v * dt);
  const waits = ready < trip.length;
  const cap = Math.min(paceAt(trip, next), waits ? Math.sqrt(2 * TRAVEL.accel * Math.max(0, ready - next)) : Infinity);
  let v = 0;
  if (stop) v = Math.min(cap, Math.max(0, at.v - TRAVEL.brake * dt));
  else if (going) v = Math.min(cap, at.v + TRAVEL.accel * dt);
  // Near the end the pace falls to nothing; the body creeps the last of the way rather than never arriving.
  if (going && !stop && !waits) v = Math.max(v, Math.min(TRAVEL.creep, at.v));
  const s = Math.min(trip.length, waits ? Math.max(at.s, ready) : Infinity, at.s + ((at.v + v) / 2) * dt);
  const x = sampleAt(trip, trip.points, s, 2, 0);
  const z = sampleAt(trip, trip.points, s, 2, 1);
  const end = s >= trip.length - 1e-3;
  const stood = stop && v === 0;
  return { s, v, x, z, yaw: y, follows, going, done: stood || (end && (stop || trip.face === null || !follows || Math.abs(turnTo(y, trip.face)) < 1e-6)) };
}
