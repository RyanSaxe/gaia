// Walking at eye height, one pure step at a time. Solid things stop a person
// and turn the step aside along their edge; water never does. A person wades
// more slowly as the water deepens and swims where it is deep, eyes a little
// above the surface. A walk to a tapped point plans its way around whatever
// stands between, follows that way smoothly, and ends on arrival.

import { heightAt } from "./lattice.ts";
import { EYE_HEIGHT } from "./sight.ts";
import { type Edge, type Solids, nearestEdge } from "./solids.ts";
import { DRY, type Terrain } from "./world.ts";

export const WADE = {
  /** Speed falls by up to this share as the water deepens from `slowFrom` to `slowTo` meters. */
  slow: 0.6,
  slowFrom: 0.1,
  slowTo: 1.1,
  /** The walker stays this far inside the walkable square's edge, meters. */
  margin: 6,
} as const;

export const SWIM = {
  /** Between these depths, meters, the feet leave the bottom and the person swims. */
  from: 1.1,
  to: 1.5,
  /** Swimming pace, as a share of walking pace. */
  pace: 0.3,
  /** Eyes stay this far above the water's surface while swimming, meters. */
  eye: 0.3,
  /** Over this band of depth, meters, the eyes ease from their height above the ground to `eye` above the surface. */
  ease: 0.4,
} as const;

/** How far a person's body keeps from the edge of anything solid, meters. */
export const BODY_RADIUS = 0.4;

export interface Walker {
  readonly x: number;
  readonly z: number;
}

/** Where the person wants to go: a direction on the ground (length up to 1) and a speed in meters per second. */
export interface Intent {
  readonly dx: number;
  readonly dz: number;
  readonly speed: number;
}

const depthFields = new WeakMap<Terrain, Float32Array>();

/** Water depth per lattice sample, 0 where there is no water: interpolates like the ground does. */
function depthField(t: Terrain): Float32Array {
  let field = depthFields.get(t);
  if (field === undefined) {
    const { heights } = t.lattice;
    field = new Float32Array(heights.length);
    for (let i = 0; i < heights.length; i++) {
      const level = t.waterLevel[i] as number;
      field[i] = level > DRY / 2 ? Math.max(0, level - (heights[i] as number)) : 0;
    }
    depthFields.set(t, field);
  }
  return field;
}

/** Water depth at a point: the water surface minus the ground, never below 0. */
export function waterDepthAt(t: Terrain, x: number, z: number): number {
  return Math.max(0, heightAt(t.lattice, x, z, depthField(t)));
}

const smoothstep = (lo: number, hi: number, x: number): number => {
  const c = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return c * c * (3 - 2 * c);
};

/** The share of full speed left at `depth`: wading slows to 40% by 1.1 m, and swimming is slower again. */
export const wadeSpeed = (depth: number): number =>
  1 - WADE.slow * smoothstep(WADE.slowFrom, WADE.slowTo, depth) - (1 - WADE.slow - SWIM.pace) * smoothstep(SWIM.from, SWIM.to, depth);

/** How a person stands at a point: their eyes' height, the water's depth, and how far they swim, 0 to 1. */
export interface Stance {
  readonly eye: number;
  readonly depth: number;
  readonly swim: number;
}

/**
 * Eyes stay 1.6 m above the ground until the water nears them; then, as the
 * bottom falls away, they ease down to `SWIM.eye` above the surface. The
 * height is smooth in depth, so it never jumps, and never below the surface.
 */
export function stanceAt(t: Terrain, x: number, z: number): Stance {
  const depth = waterDepthAt(t, x, z);
  const wading = EYE_HEIGHT - depth;
  // A smooth maximum of standing and floating, exact outside the ease band.
  const h = Math.max(0, SWIM.ease - Math.abs(wading - SWIM.eye)) / SWIM.ease;
  const above = Math.max(wading, SWIM.eye) + (h * h * SWIM.ease) / 4;
  return { eye: heightAt(t.lattice, x, z) + depth + above, depth, swim: smoothstep(SWIM.from, SWIM.to, depth) };
}

/** Steps longer than this are taken in parts, so nothing thin is ever stepped through, meters. */
const SUBSTEP = 0.2;
const edge: Edge = { distance: 0, nx: 0, nz: 0 };

/**
 * Moves by (mx, mz), turning aside along the edge of any solid in the way:
 * each part of the step that would end inside one is pushed back out along
 * the edge's normal, which keeps only the part running along it. A part that
 * cannot be freed (a wedge between two solids) is not taken.
 */
function moveBy(t: Terrain, solids: Solids, from: Walker, mx: number, mz: number): Walker {
  const half = t.spec.size / 2 - WADE.margin;
  const clamp = (v: number): number => Math.max(-half, Math.min(half, v));
  const parts = Math.max(1, Math.ceil(Math.hypot(mx, mz) / SUBSTEP));
  let x = from.x;
  let z = from.z;
  // A walker set down inside something may always move outward.
  let allowed = Math.max(0, BODY_RADIUS - nearestEdge(solids, x, z, edge).distance) + 1e-6;
  for (let p = 0; p < parts; p++) {
    let nx = clamp(x + mx / parts);
    let nz = clamp(z + mz / parts);
    for (let k = 0; k < 4; k++) {
      const into = BODY_RADIUS - nearestEdge(solids, nx, nz, edge).distance;
      if (into <= 1e-7) break;
      nx = clamp(nx + edge.nx * into);
      nz = clamp(nz + edge.nz * into);
    }
    const into = BODY_RADIUS - nearestEdge(solids, nx, nz, edge).distance;
    if (into > allowed) break;
    allowed = Math.max(0, into) + 1e-6;
    x = nx;
    z = nz;
  }
  return x === from.x && z === from.z ? from : { x, z };
}

/**
 * One step of walking. Speed falls as the water deepens and is slowest
 * swimming; water never stops the step. Solids turn it aside along their
 * edge, so pushing straight at one stops and pushing at an angle slides.
 */
export function walkStep(t: Terrain, solids: Solids, from: Walker, intent: Intent, dt: number): Walker {
  const len = Math.hypot(intent.dx, intent.dz);
  if (len < 1e-9 || dt <= 0 || intent.speed <= 0) return from;
  const step = (intent.speed * wadeSpeed(waterDepthAt(t, from.x, from.z)) * dt) / Math.max(1, len);
  return moveBy(t, solids, from, intent.dx * step, intent.dz * step);
}

export const WALK_TO = {
  /** Walking pace, meters per second. */
  pace: 4.2,
  /** While more than `jogFrom` meters remain the walker jogs at this multiple of the pace, easing back to a walk by `walkWithin`. */
  jog: 1.8,
  jogFrom: 25,
  walkWithin: 15,
  /** A target this close is where the walker stands: the walk ends there, or never starts. */
  reach: 1.5,
  /** The walker heads for the point this far ahead along its way, so it rounds corners in curves, meters. */
  lookAhead: 1.2,
  /** A planned way keeps this much farther from solids than the body must, meters. */
  clearance: 0.2,
  /** A step that moves less than this share of its length ends the walk: the walker is wedged. */
  stall: 0.02,
} as const;

/** A walk to a tapped point. */
export interface Walk {
  /** Where the walk ends: the tapped point, or the nearest place short of it where a person can stand. */
  readonly target: Walker;
  /** The way there: where the walk began, each corner, and the target. */
  readonly way: readonly Walker[];
  /** The leg of the way being walked, from `way[leg]` to `way[leg + 1]`. */
  readonly leg: number;
}

/** One step of a walk to a target, and whether the walk goes on. */
export interface Approach {
  readonly walker: Walker;
  readonly walk: Walk;
  /** `arrived` within `WALK_TO.reach` of the target; `stalled` when the walker is wedged and cannot move on. */
  readonly state: "walking" | "arrived" | "stalled";
}

/** Whether a body walking straight from a to b stays `room` meters clear of every solid and inside the walkable square. */
function clearWay(t: Terrain, solids: Solids, ax: number, az: number, bx: number, bz: number, room: number): boolean {
  const half = t.spec.size / 2 - WADE.margin + 1e-6;
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2));
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const z = az + ((bz - az) * i) / n;
    if (Math.abs(x) > half || Math.abs(z) > half) return false;
    if (nearestEdge(solids, x, z, edge).distance < room) return false;
  }
  return true;
}

/** The planner's grid: meters per cell, its reach past both ends of the walk and to either side, and its search budget. */
const PLAN = { cell: 0.5, past: 8, side: 16, expansions: 40_000 } as const;

/**
 * The way from `from` to `to` around everything solid: straight when nothing
 * is in the way, otherwise the shortest way on a grid laid along the walk,
 * pulled taut to its corners. A tap on a solid walks up to the face that was
 * tapped; when nothing reaches the target (solids ring it), the way ends at
 * the nearest place that can be reached.
 */
export function planWalk(t: Terrain, solids: Solids, at: Walker, to: Walker): Walk {
  // The way keeps its own copy of where it began: the caller's walker moves on.
  const from = { x: at.x, z: at.z };
  const half = t.spec.size / 2 - WADE.margin;
  let tx = Math.max(-half, Math.min(half, to.x));
  let tz = Math.max(-half, Math.min(half, to.z));
  for (let left = Math.hypot(tx - from.x, tz - from.z); left > 0.1 && nearestEdge(solids, tx, tz, edge).distance < BODY_RADIUS; left -= 0.1) {
    tx += ((from.x - tx) / left) * 0.1;
    tz += ((from.z - tz) / left) * 0.1;
  }
  const target = { x: tx, z: tz };
  if (clearWay(t, solids, from.x, from.z, tx, tz, BODY_RADIUS)) return { target, way: [from, target], leg: 0 };
  const way = routeAround(t, solids, from, target);
  return { target: way[way.length - 1] as Walker, way, leg: 0 };
}

/** A* on a grid laid along the walk, where cells nearer a solid than the body and its clearance are closed, pulled taut. */
function routeAround(t: Terrain, solids: Solids, from: Walker, to: Walker): Walker[] {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const ux = (to.x - from.x) / Math.max(1e-9, length);
  const uz = (to.z - from.z) / Math.max(1e-9, length);
  const h = PLAN.cell;
  const back = Math.round(PLAN.past / h);
  const nu = Math.ceil(length / h) + back * 2 + 1;
  const sideCells = Math.round(PLAN.side / h);
  const nv = sideCells * 2 + 1;
  const count = nu * nv;
  const xAt = (i: number): number => from.x + ux * ((i % nu) - back) * h - uz * (Math.floor(i / nu) - sideCells) * h;
  const zAt = (i: number): number => from.z + uz * ((i % nu) - back) * h + ux * (Math.floor(i / nu) - sideCells) * h;
  const half = t.spec.size / 2 - WADE.margin;
  const state = new Uint8Array(count); // 0 unknown, 1 open, 2 closed
  const open = (i: number): boolean => {
    if (state[i] === 0) {
      const x = xAt(i);
      const z = zAt(i);
      // Right by the start the body alone must fit, so a walker standing close to something can leave.
      const room = Math.hypot(x - from.x, z - from.z) < 1.5 ? BODY_RADIUS : BODY_RADIUS + WALK_TO.clearance;
      state[i] = Math.abs(x) <= half && Math.abs(z) <= half && nearestEdge(solids, x, z, edge).distance >= room ? 1 : 2;
    }
    return state[i] === 1;
  };
  const start = sideCells * nu + back;
  const goal = start + Math.round(length / h);
  const gu = goal % nu;
  const gv = Math.floor(goal / nu);
  const toGoal = (i: number): number => Math.hypot((i % nu) - gu, Math.floor(i / nu) - gv);
  const g = new Float32Array(count).fill(Infinity);
  const f = new Float32Array(count);
  const parent = new Int32Array(count).fill(-1);
  const done = new Uint8Array(count);
  const heap: number[] = [];
  const push = (i: number): void => {
    let c = heap.length;
    heap.push(i);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if ((f[heap[p] as number] as number) <= (f[i] as number)) break;
      heap[c] = heap[p] as number;
      c = p;
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
        const m = r < heap.length && (f[heap[r] as number] as number) < (f[heap[l] as number] as number) ? r : l;
        if ((f[heap[m] as number] as number) >= (f[last] as number)) break;
        heap[c] = heap[m] as number;
        c = m;
      }
      heap[c] = last;
    }
    return top;
  };
  g[start] = 0;
  f[start] = toGoal(start);
  push(start);
  let best = start;
  for (let expanded = 0; heap.length > 0 && expanded < PLAN.expansions; expanded++) {
    const i = pop();
    if (done[i] === 1) continue;
    done[i] = 1;
    if (toGoal(i) < toGoal(best)) best = i;
    if (i === goal) break;
    const iu = i % nu;
    const iv = Math.floor(i / nu);
    for (let dv = -1; dv <= 1; dv++) {
      for (let du = -1; du <= 1; du++) {
        const u = iu + du;
        const v = iv + dv;
        if ((du === 0 && dv === 0) || u < 0 || u >= nu || v < 0 || v >= nv) continue;
        const j = v * nu + u;
        if (done[j] === 1 || !open(j)) continue;
        // No cutting a corner between two closed cells.
        if (du !== 0 && dv !== 0 && (!open(iv * nu + u) || !open(v * nu + iu))) continue;
        const cost = (g[i] as number) + (du !== 0 && dv !== 0 ? Math.SQRT2 : 1);
        if (cost >= (g[j] as number)) continue;
        g[j] = cost;
        parent[j] = i;
        f[j] = cost + toGoal(j) * 1.1;
        push(j);
      }
    }
  }
  const cells: number[] = [];
  for (let i = best; i !== -1; i = parent[i] as number) cells.push(i);
  cells.reverse();
  const points: Walker[] = cells.map((i) => ({ x: xAt(i), z: zAt(i) }));
  points[0] = from;
  if (best === goal) points[points.length - 1] = to;
  // Pull the way taut: from each corner, straight on to the farthest point in plain sight.
  const way: Walker[] = [from];
  for (let a = 0; a < points.length - 1; ) {
    const p = points[a] as Walker;
    let lo = a + 1;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const q = points[mid] as Walker;
      if (clearWay(t, solids, p.x, p.z, q.x, q.z, BODY_RADIUS + WALK_TO.clearance / 2)) lo = mid;
      else hi = mid - 1;
    }
    way.push(points[lo] as Walker);
    a = lo;
  }
  if (way.length < 2) way.push(from);
  return way;
}

/** The point `ahead` meters along the way past the walker's place on it; moves on to the next leg once the walker passes a leg's end. */
function pursue(walk: Walk, x: number, z: number, ahead: number): { leg: number; x: number; z: number } {
  const way = walk.way;
  let leg = walk.leg;
  let u: number;
  for (;;) {
    const a = way[leg] as Walker;
    const b = way[leg + 1] as Walker;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    u = len2 > 1e-12 ? ((x - a.x) * ex + (z - a.z) * ez) / len2 : 1;
    if (u < 1 || leg >= way.length - 2) break;
    leg++;
  }
  let left = ahead;
  for (let k = leg; k < way.length - 1; k++) {
    const a = way[k] as Walker;
    const b = way[k + 1] as Walker;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const along = k === leg ? Math.max(0, Math.min(1, u)) * len : 0;
    if (along + left <= len) {
      const s = (along + left) / Math.max(1e-9, len);
      return { leg, x: a.x + (b.x - a.x) * s, z: a.z + (b.z - a.z) * s };
    }
    left -= len - along;
  }
  return { leg, x: walk.target.x, z: walk.target.z };
}

/**
 * One step of a walk along its planned way, through the same movement as a
 * held key, so wading, swimming and solids work as they do for any walk. The
 * walker heads for a point a little ahead along the way, so it rounds each
 * corner in a curve, and jogs while the target is far.
 */
export function walkToward(t: Terrain, solids: Solids, from: Walker, walk: Walk, dt: number): Approach {
  const remaining = Math.hypot(walk.target.x - from.x, walk.target.z - from.z);
  if (remaining <= WALK_TO.reach) return { walker: from, walk, state: "arrived" };
  const speed = WALK_TO.pace * (1 + (WALK_TO.jog - 1) * smoothstep(WALK_TO.walkWithin, WALK_TO.jogFrom, remaining));
  const full = speed * wadeSpeed(waterDepthAt(t, from.x, from.z)) * dt;
  if (full <= 0) return { walker: from, walk, state: "walking" };
  const aim = pursue(walk, from.x, from.z, WALK_TO.lookAhead);
  const onward = aim.leg === walk.leg ? walk : { ...walk, leg: aim.leg };
  const ax = aim.x - from.x;
  const az = aim.z - from.z;
  // A step longer than the way left lands on the target rather than past it.
  const length = Math.min(full, remaining);
  const k = length / Math.max(1e-9, Math.hypot(ax, az));
  const next = moveBy(t, solids, from, ax * k, az * k);
  if (Math.hypot(next.x - from.x, next.z - from.z) < WALK_TO.stall * length) return { walker: from, walk: onward, state: "stalled" };
  const left = Math.hypot(walk.target.x - next.x, walk.target.z - next.z);
  return { walker: next, walk: onward, state: left <= WALK_TO.reach ? "arrived" : "walking" };
}
