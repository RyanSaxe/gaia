// Moves a person one pure step at a time. Solids stop the step and slide it
// along their edge, and water only slows it until the person swims. A walk to
// a tapped point plans a way around solids, and no boundary stops a walk,
// since the wild land continues past the codebase's land.

import { heightAt } from "./lattice.ts";
import { EYE_HEIGHT } from "./sight.ts";
import { type Edge, type Solids, nearestEdge } from "./solids.ts";
import { groundHeightAt, inWilds } from "./wilds.ts";
import { DRY, type Terrain } from "./world.ts";

export const WADE = {
  /** Speed falls by up to this share as the water deepens from `slowFrom` to `slowTo` meters. */
  slow: 0.6,
  slowFrom: 0.1,
  slowTo: 1.1,
} as const;

export const SWIM = {
  /** Depths in meters over which the person goes from wading to swimming. */
  from: 1.1,
  to: 1.5,
  /** Swimming pace, as a share of walking pace. */
  pace: 0.3,
  /** Meters the eyes stay above the water surface while swimming. */
  eye: 0.3,
  /** Width in meters of the smooth blend between standing eye height and `eye` above the surface. */
  ease: 0.4,
} as const;

/** Meters a person's body stays from the edge of any solid. */
export const BODY_RADIUS = 0.4;

export interface Walker {
  readonly x: number;
  readonly z: number;
}

/** A requested move: a ground direction of length up to 1, and a speed in meters per second. */
export interface Intent {
  readonly dx: number;
  readonly dz: number;
  readonly speed: number;
}

/** The water's depth at lattice sample i, 0 where it is dry. */
const sampleDepth = (t: Terrain, i: number): number => {
  const level = t.waterLevel[i] as number;
  return level > DRY / 2 ? Math.max(0, level - (t.lattice.heights[i] as number)) : 0;
};

/**
 * Water depth at a point: the water surface minus the ground, never below 0,
 * and 0 in the wild. It reads the land's arrays on every call, so a land
 * whose arrays change in place, such as the page's moving window, is always
 * read as it is now. Past a land's window it reads the finest level that
 * holds the point (`Lattice.beyond`).
 */
export function waterDepthAt(t: Terrain, x: number, z: number): number {
  if (inWilds(t, x, z)) return 0;
  const l = t.lattice;
  const ux = (x - l.origin) / l.spacing;
  const uz = (z - (l.originZ ?? l.origin)) / l.spacing;
  if (l.beyond !== undefined && (ux < 0 || uz < 0 || ux > l.n - 1 || uz > l.n - 1)) {
    const level = heightAt(l, x, z, t.waterLevel);
    return level > DRY / 2 ? Math.max(0, level - heightAt(l, x, z)) : 0;
  }
  // Interpolate the cell's corner depths with the same triangles as the ground.
  const gx = Math.min(l.n - 1.000001, Math.max(0, ux));
  const gz = Math.min(l.n - 1.000001, Math.max(0, uz));
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const i = iz * l.n + ix;
  if (fx + fz <= 1) {
    const d00 = sampleDepth(t, i);
    return d00 + fx * (sampleDepth(t, i + 1) - d00) + fz * (sampleDepth(t, i + l.n) - d00);
  }
  const d11 = sampleDepth(t, i + l.n + 1);
  return d11 + (1 - fx) * (sampleDepth(t, i + l.n) - d11) + (1 - fz) * (sampleDepth(t, i + 1) - d11);
}

const smoothstep = (lo: number, hi: number, x: number): number => {
  const c = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return c * c * (3 - 2 * c);
};

/** The share of full speed left at `depth`: wading slows to 40% by 1.1 m, and swimming is slower again. */
export const wadeSpeed = (depth: number): number =>
  1 - WADE.slow * smoothstep(WADE.slowFrom, WADE.slowTo, depth) - (1 - WADE.slow - SWIM.pace) * smoothstep(SWIM.from, SWIM.to, depth);

/** A person's eye height, the water depth, and how much they swim, 0 to 1, at a point. */
export interface Stance {
  readonly eye: number;
  readonly depth: number;
  readonly swim: number;
}

/**
 * Eyes stay `EYE_HEIGHT` above the ground until the water nears them. Then, as
 * the bottom falls away, they ease down to `SWIM.eye` above the surface. The
 * height is smooth in depth, so it never jumps, and it is never below the
 * surface.
 */
export function stanceAt(t: Terrain, x: number, z: number): Stance {
  const depth = waterDepthAt(t, x, z);
  const wading = EYE_HEIGHT - depth;
  // A smooth maximum of standing and floating, exact outside the ease band.
  const h = Math.max(0, SWIM.ease - Math.abs(wading - SWIM.eye)) / SWIM.ease;
  const above = Math.max(wading, SWIM.eye) + (h * h * SWIM.ease) / 4;
  return { eye: groundHeightAt(t, x, z) + depth + above, depth, swim: smoothstep(SWIM.from, SWIM.to, depth) };
}

/** Longest substep in meters, so a step never passes through a thin solid. */
const SUBSTEP = 0.2;
const edge: Edge = { distance: 0, nx: 0, nz: 0 };

/**
 * Moves by (mx, mz), sliding along the edge of any solid in the way. Each
 * substep that would end inside one is pushed back out along the edge's
 * normal, which keeps only the part along the edge. A substep that cannot be
 * freed, as in a wedge between two solids, is not taken.
 */
export function moveBy(solids: Solids, from: Walker, mx: number, mz: number): Walker {
  const parts = Math.max(1, Math.ceil(Math.hypot(mx, mz) / SUBSTEP));
  let x = from.x;
  let z = from.z;
  // A walker placed inside a solid can always move outward.
  let allowed = Math.max(0, BODY_RADIUS - nearestEdge(solids, x, z, edge).distance) + 1e-6;
  for (let p = 0; p < parts; p++) {
    let nx = x + mx / parts;
    let nz = z + mz / parts;
    for (let k = 0; k < 4; k++) {
      const into = BODY_RADIUS - nearestEdge(solids, nx, nz, edge).distance;
      if (into <= 1e-7) break;
      nx += edge.nx * into;
      nz += edge.nz * into;
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
 * One step of walking. Speed falls as the water deepens and is lowest while
 * swimming, but water never stops the step. Solids slide it along their
 * edge, so pushing straight at one stops and pushing at an angle slides.
 */
export function walkStep(t: Terrain, solids: Solids, from: Walker, intent: Intent, dt: number): Walker {
  const len = Math.hypot(intent.dx, intent.dz);
  if (len < 1e-9 || dt <= 0 || intent.speed <= 0) return from;
  const step = (intent.speed * wadeSpeed(waterDepthAt(t, from.x, from.z)) * dt) / Math.max(1, len);
  return moveBy(solids, from, intent.dx * step, intent.dz * step);
}

export const WALK_TO = {
  /** Walking pace, meters per second. */
  pace: 4.2,
  /** While more than `jogFrom` meters remain the walker jogs at this multiple of the pace, easing back to a walk by `walkWithin`. */
  jog: 1.8,
  jogFrom: 25,
  walkWithin: 15,
  /** Meters from the target within which a walk ends, or does not start. */
  reach: 1.5,
  /** Meters ahead along the way that the walker aims for, so it rounds corners in curves. */
  lookAhead: 1.2,
  /** Extra meters a planned way keeps from solids beyond `BODY_RADIUS`. */
  clearance: 0.2,
  /** A step that moves less than this share of its length ends the walk, since the walker is wedged. */
  stall: 0.02,
} as const;

/** A walk to a tapped point. */
export interface Walk {
  /** The walk's end: the tapped point, or the nearest point short of it where the body fits. */
  readonly target: Walker;
  /** The way there: where the walk began, each corner, and the target. */
  readonly way: readonly Walker[];
  /** The leg of the way being walked, from `way[leg]` to `way[leg + 1]`. */
  readonly leg: number;
}

/** Whether a body walking straight from a to b stays `room` meters clear of every solid. */
function clearWay(solids: Solids, ax: number, az: number, bx: number, bz: number, room: number): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2));
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const z = az + ((bz - az) * i) / n;
    if (nearestEdge(solids, x, z, edge).distance < room) return false;
  }
  return true;
}

/** The planner's grid: meters per cell, its reach past both ends of the walk and to either side, and its search budget. */
const PLAN = { cell: 0.5, past: 8, side: 16, expansions: 40_000 } as const;

/**
 * The way from `at` to `to` around every solid. It is straight when nothing
 * is in the way. Otherwise it is the shortest path on a grid aligned with the
 * walk, pulled taut to its corners. A tap on a solid walks up to the tapped
 * face. When solids ring the target, the way ends at the nearest reachable
 * point.
 */
export function planWalk(t: Terrain, solids: Solids, at: Walker, to: Walker): Walk {
  // Copy the start point, since the caller's walker keeps moving.
  const from = { x: at.x, z: at.z };
  let tx = to.x;
  let tz = to.z;
  for (let left = Math.hypot(tx - from.x, tz - from.z); left > 0.1 && nearestEdge(solids, tx, tz, edge).distance < BODY_RADIUS; left -= 0.1) {
    tx += ((from.x - tx) / left) * 0.1;
    tz += ((from.z - tz) / left) * 0.1;
  }
  const target = { x: tx, z: tz };
  if (clearWay(solids, from.x, from.z, tx, tz, BODY_RADIUS)) return { target, way: [from, target], leg: 0 };
  const way = routeAround(solids, from, target);
  return { target: way[way.length - 1] as Walker, way, leg: 0 };
}

/** A* on a grid aligned with the walk, with cells closed where a solid is nearer than the body plus its clearance, then pulled taut. */
function routeAround(solids: Solids, from: Walker, to: Walker): Walker[] {
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
  const state = new Uint8Array(count); // 0 unknown, 1 open, 2 closed
  const open = (i: number): boolean => {
    if (state[i] === 0) {
      const x = xAt(i);
      const z = zAt(i);
      // Within 1.5 m of the start only the body must fit, so a walker standing close to a solid can leave.
      const room = Math.hypot(x - from.x, z - from.z) < 1.5 ? BODY_RADIUS : BODY_RADIUS + WALK_TO.clearance;
      state[i] = nearestEdge(solids, x, z, edge).distance >= room ? 1 : 2;
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
        // Do not cut a corner between two closed cells.
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
  // Pull the way taut by going straight from each corner to the farthest point with a clear line.
  const way: Walker[] = [from];
  for (let a = 0; a < points.length - 1; ) {
    const p = points[a] as Walker;
    let lo = a + 1;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const q = points[mid] as Walker;
      if (clearWay(solids, p.x, p.z, q.x, q.z, BODY_RADIUS + WALK_TO.clearance / 2)) lo = mid;
      else hi = mid - 1;
    }
    way.push(points[lo] as Walker);
    a = lo;
  }
  if (way.length < 2) way.push(from);
  return way;
}

/** The point `ahead` meters along the way past the walker's projection on it. Advances to the next leg once the walker passes a leg's end. */
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

/** Where a walk heads from a point: the walk with its current leg, the point to aim for, the pace, and the meters left to the target. */
export interface Heading {
  readonly walk: Walk;
  readonly aim: Walker;
  readonly pace: number;
  readonly remaining: number;
}

/** The point `WALK_TO.lookAhead` along the way to aim for, so corners round in curves, at walking pace or jogging while the target is far. */
export function wayAhead(walk: Walk, from: Walker): Heading {
  const remaining = Math.hypot(walk.target.x - from.x, walk.target.z - from.z);
  const pace = WALK_TO.pace * (1 + (WALK_TO.jog - 1) * smoothstep(WALK_TO.walkWithin, WALK_TO.jogFrom, remaining));
  const aim = pursue(walk, from.x, from.z, WALK_TO.lookAhead);
  return { walk: aim.leg === walk.leg ? walk : { ...walk, leg: aim.leg }, aim: { x: aim.x, z: aim.z }, pace, remaining };
}
