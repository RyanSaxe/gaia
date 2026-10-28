// Steps a walking person's body and eye height one pure frame at a time. The
// body speeds up and stops within a fraction of a second without overshoot,
// slows on climbs, and stands on decks and built floors. The eyes follow the
// ground on a critically damped spring and nothing else moves them, so the
// view never bobs, sways or rolls.

import type { Part } from "@gaia/schema";
import { footbridgeDeck, footbridgeHolds } from "@gaia/primitives";
import { type Crossing, type Way, crossingSeed } from "./paths.ts";
import { EYE_HEIGHT } from "./sight.ts";
import type { SolidShape, Solids } from "./solids.ts";
import { type Intent, type Stance, WALK_TO, moveBy, stanceAt, wadeSpeed } from "./walk.ts";
import { groundHeightAt } from "./wilds.ts";
import type { Terrain } from "./world.ts";

/** Gait constants. The design rationale is in docs/design-system.md#terrain-walking-and-travel. */
export const GAIT = {
  /** Seconds to reach 95% of a new pace when speeding up (`start`) and slowing down (`stop`). Fast as in games, but never a one-frame jump. */
  start: 0.15,
  stop: 0.12,
  /** Shift's pace, as a multiple of walking pace. */
  hurry: 2.4,
  /**
   * Pace by grade, a gentler form of Tobler's hiking function. The pace is
   * multiplied by exp(-grade * (|S + peak| - peak)) for a rise S, so climbing
   * slows, a descent of `peak` is fastest, and a steep descent slows. The
   * factor stays between `floor` and `ceiling`. The grade is measured over
   * `reach` meters either side.
   */
  grade: 2,
  peak: 0.08,
  floor: 0.35,
  ceiling: 1.1,
  reach: 1,
  /** Radius in meters around the body over which the eyes' target height is averaged. */
  footprint: 0.5,
  /**
   * The ride's natural frequency in radians per second, critically damped so
   * it never overshoots. Before the spring, the footing eases at `level`
   * radians per second, so a deck's edge rises as a ramp and the ride's
   * acceleration never jumps. The footing is read ahead of the body by the
   * ride's lag, so the eyes keep their height on a slope and lift as a foot
   * reaches a step.
   */
  ride: 11,
  level: 16,
  /** Deceleration in meters per second squared for a tap's walk as it arrives within `WALK_TO.reach`. */
  arrive: 2.5,
} as const;

/** The height underfoot from the ground or a deck, the stance there, and whether it is a deck. */
export interface Footing extends Stance {
  readonly ground: number;
  readonly deck: boolean;
}

/**
 * A footbridge's deck for walking: its center, its axis, its half span and half width, and its top above `base`. It
 * also has its way and crossing, and `holds`, the vitality below which a gap too wide to step across opens in it
 * (`footbridgeHolds`), so it can no longer be walked.
 */
export interface Deck {
  readonly x: number;
  readonly z: number;
  readonly cos: number;
  readonly sin: number;
  readonly half: number;
  readonly halfWidth: number;
  readonly base: number;
  readonly topAt: (u: number) => number;
  readonly way: number;
  readonly crossing: Crossing;
  readonly holds: number;
}

/** The decks of every footbridge on the ways. A person can walk on a deck above the water while it holds. */
export function decksOf(ways: readonly Way[]): Deck[] {
  const out: Deck[] = [];
  ways.forEach((way, i) => {
    if (way.style.crossing !== "footbridge") return;
    way.crossings.forEach((c, k) => {
      const deck = footbridgeDeck(c.span, way.style.width);
      out.push({ x: c.x, z: c.z, cos: Math.cos(c.yaw), sin: Math.sin(c.yaw), half: c.span / 2, halfWidth: deck.halfWidth, base: c.bank, topAt: deck.topAt, way: i, crossing: c, holds: footbridgeHolds(c.span, crossingSeed(way, k)) });
    });
  });
  return out;
}

/** A deck that no longer holds as a solid a walk goes around, covering its span from bank to bank and its width with rails. */
export function deckShape(d: Deck): SolidShape {
  const w = d.halfWidth + 0.15;
  return { points: [[-d.half, -w], [d.half, -w], [d.half, w], [-d.half, w]].flatMap(([u, v]) => [d.x + (u as number) * d.cos + (v as number) * d.sin, d.z - (u as number) * d.sin + (v as number) * d.cos]) };
}

/** Side in meters of a floor's cells. */
export const FLOOR_CELL = 0.25;

/**
 * A built floor to walk on, such as a landmark's steps and the floor inside. `tops` holds the height of its upward
 * faces on a grid of `FLOOR_CELL` cells from (x0, z0), and -Infinity where there is none.
 */
export interface Floor {
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  readonly tops: Float32Array;
}

/** A surface above the ground to walk on: a footbridge's deck or a built floor. */
export type Footbed = Deck | Floor;

/**
 * The floor that a built thing's walkable parts make, placed at (x, y, z) and turned by `yaw` as Three turns it. It
 * holds the tops of their upward faces, which a walk climbs as it climbs the ground. They block no walk, since
 * `piecesShapes` reads only solid parts. Null when there are none.
 */
export function floorOf(parts: readonly Part[], at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }): Floor | null {
  const c = Math.cos(at.yaw);
  const s = Math.sin(at.yaw);
  const tris: number[] = [];
  for (const part of parts) {
    if (part.collision !== "walkable") continue;
    const p = part.positions;
    const n = part.normals;
    for (let t = 0; t < part.indices.length; t += 3) {
      const vs = [part.indices[t] as number, part.indices[t + 1] as number, part.indices[t + 2] as number];
      if (vs.reduce((up, v) => up + (n[v * 3 + 1] as number), 0) < 1.5) continue;
      for (const v of vs) {
        const lx = p[v * 3] as number;
        const lz = p[v * 3 + 2] as number;
        tris.push(at.x + lx * c + lz * s, at.y + (p[v * 3 + 1] as number), at.z - lx * s + lz * c);
      }
    }
  }
  if (tris.length === 0) return null;
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let k = 0; k < tris.length; k += 3) {
    x0 = Math.min(x0, tris[k] as number);
    x1 = Math.max(x1, tris[k] as number);
    z0 = Math.min(z0, tris[k + 2] as number);
    z1 = Math.max(z1, tris[k + 2] as number);
  }
  const cols = Math.ceil((x1 - x0) / FLOOR_CELL) + 1;
  const rows = Math.ceil((z1 - z0) / FLOOR_CELL) + 1;
  const tops = new Float32Array(cols * rows).fill(-Infinity);
  // Sample each upward face's height at the center of every cell it covers. The highest face over a cell is its top.
  for (let k = 0; k < tris.length; k += 9) {
    const [ax, ay, az, bx, by, bz, qx, qy, qz] = tris.slice(k, k + 9) as [number, number, number, number, number, number, number, number, number];
    const area = (bx - ax) * (qz - az) - (qx - ax) * (bz - az);
    if (Math.abs(area) < 1e-9) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, qx) - x0) / FLOOR_CELL));
    const i1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx, qx) - x0) / FLOOR_CELL));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, qz) - z0) / FLOOR_CELL));
    const j1 = Math.min(rows - 1, Math.ceil((Math.max(az, bz, qz) - z0) / FLOOR_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * FLOOR_CELL;
        const pz = z0 + (j + 0.5) * FLOOR_CELL;
        const u = ((qx - bx) * (pz - bz) - (px - bx) * (qz - bz)) / area;
        const v = ((ax - qx) * (pz - qz) - (px - qx) * (az - qz)) / area;
        const w = 1 - u - v;
        if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
        const y = u * ay + v * by + w * qy;
        if (y > (tops[j * cols + i] as number)) tops[j * cols + i] = y;
      }
    }
  }
  // A joint between paving stones can be narrower than a cell. A cell that misses every face but has floor on both
  // sides takes the lower side's height, so a walk never drops into a joint.
  const filled = tops.slice();
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) {
      const k = j * cols + i;
      if ((tops[k] as number) > -Infinity) continue;
      const across = Math.min(tops[k - 1] as number, tops[k + 1] as number);
      const along = Math.min(tops[k - cols] as number, tops[k + cols] as number);
      const side = Math.max(across, along);
      if (side > -Infinity) filled[k] = side;
    }
  }
  return { x0, z0, cols, rows, tops: filled };
}

/** The highest deck's or floor's top over a point, or -Infinity off every one. */
export function deckAt(decks: readonly Footbed[], x: number, z: number): number {
  let top = -Infinity;
  for (const d of decks) {
    if ("tops" in d) {
      const i = Math.floor((x - d.x0) / FLOOR_CELL);
      const j = Math.floor((z - d.z0) / FLOOR_CELL);
      if (i >= 0 && j >= 0 && i < d.cols && j < d.rows) top = Math.max(top, d.tops[j * d.cols + i] as number);
      continue;
    }
    const dx = x - d.x;
    const dz = z - d.z;
    // Local +x runs along the span as Three's rotation about y turns it.
    const u = dx * d.cos - dz * d.sin;
    const v = dx * d.sin + dz * d.cos;
    if (Math.abs(u) <= d.half && Math.abs(v) <= d.halfWidth) top = Math.max(top, d.base + d.topAt(u));
  }
  return top;
}

/** A person's footing at a point: dry on a deck or floor above the ground or water there, else on the ground, wading or swimming. */
export function footingAt(t: Terrain, decks: readonly Footbed[], x: number, z: number): Footing {
  const stance = stanceAt(t, x, z);
  const ground = groundHeightAt(t, x, z);
  const top = decks.length === 0 ? -Infinity : deckAt(decks, x, z);
  if (top > ground + stance.depth) return { eye: top + EYE_HEIGHT, depth: 0, swim: 0, ground: top, deck: true };
  return { ...stance, ground, deck: false };
}

/** A person's body and eyes while walking. */
export interface Stride {
  readonly x: number;
  readonly z: number;
  /** Velocity over the ground in meters per second (`vx`, `vz`), and its rate of change (`ax`, `az`). */
  readonly vx: number;
  readonly vz: number;
  readonly ax: number;
  readonly az: number;
  /** The eyes' height (`eye`) and its rate of change (`climb`). */
  readonly eye: number;
  readonly climb: number;
  /** The eased eye height that the ride's spring follows. */
  readonly level: number;
  /** Whether solids held this step to less than `WALK_TO.stall` of its intended move. */
  readonly blocked: boolean;
}

/**
 * Advances `x` toward `target` as a critically damped spring of natural
 * frequency `w`, exactly, so it never overshoots at any frame rate.
 */
function settle(x: number, v: number, target: number, w: number, dt: number): readonly [number, number] {
  const e = x - target;
  const k = v + w * e;
  const decay = Math.exp(-w * dt);
  return [target + (e + k * dt) * decay, (v - w * k * dt) * decay];
}

/** A critically damped spring of natural frequency w comes within 5% of a step in 4.744 / w seconds. */
const RATE = 4.744;

/** The share of the pace kept on a rise of `slope`, in meters up per meter along, negative going down. */
export function gradePace(slope: number): number {
  return Math.max(GAIT.floor, Math.min(GAIT.ceiling, Math.exp(-GAIT.grade * (Math.abs(slope + GAIT.peak) - GAIT.peak))));
}

/** Where the footprint is sampled, as shares of its radius, and each sample's weight: a center, an inner ring and an outer ring. */
const FOOTPRINT: readonly (readonly [number, number, number])[] = [
  [0, 0, 3],
  ...Array.from({ length: 6 }, (_, k) => [Math.cos((k * Math.PI) / 3) * 0.5, Math.sin((k * Math.PI) / 3) * 0.5, 2] as const),
  ...Array.from({ length: 12 }, (_, k) => [Math.cos(((k + 0.5) * Math.PI) / 6), Math.sin(((k + 0.5) * Math.PI) / 6), 1] as const),
];
const FOOTPRINT_WEIGHT = FOOTPRINT.reduce((sum, [, , w]) => sum + w, 0);
/** Seconds the ride lags the footing: a critically damped spring's lag on a ramp plus the easing before it. */
const RIDE_LAG = 2 / GAIT.ride + 1 / GAIT.level;

/** The mean eye height over the footprint around a point, weighted toward its center, which smooths the ground's facets. */
function rideTarget(t: Terrain, decks: readonly Footbed[], x: number, z: number): number {
  const r = GAIT.footprint;
  let sum = 0;
  for (const [ox, oz, w] of FOOTPRINT) sum += footingAt(t, decks, x + ox * r, z + oz * r).eye * w;
  return sum / FOOTPRINT_WEIGHT;
}

/** A body standing still at a point, eyes at rest. */
export function standAt(t: Terrain, decks: readonly Footbed[], x: number, z: number): Stride {
  const eye = rideTarget(t, decks, x, z);
  return { x, z, vx: 0, vz: 0, ax: 0, az: 0, eye, climb: 0, level: eye, blocked: false };
}

/**
 * One frame of walking. The body's velocity eases toward `want`, a direction
 * of length up to 1 and a speed, slowed by water and by the grade in the
 * direction of travel. Solids slide the move as they slide any step. The eyes
 * follow the footing.
 */
export function stride(t: Terrain, solids: Solids, decks: readonly Footbed[], from: Stride, want: Intent, dt: number): Stride {
  if (dt <= 0) return from;
  const here = footingAt(t, decks, from.x, from.z);
  const len = Math.hypot(want.dx, want.dz);
  let tvx = 0;
  let tvz = 0;
  if (len > 1e-9 && want.speed > 0) {
    const ux = want.dx / len;
    const uz = want.dz / len;
    const r = GAIT.reach;
    const slope = (footingAt(t, decks, from.x + ux * r, from.z + uz * r).ground - footingAt(t, decks, from.x - ux * r, from.z - uz * r).ground) / (2 * r);
    const speed = want.speed * Math.min(1, len) * wadeSpeed(here.depth) * gradePace(slope);
    tvx = ux * speed;
    tvz = uz * speed;
  }
  const w = RATE / (tvx * tvx + tvz * tvz > from.vx * from.vx + from.vz * from.vz ? GAIT.start : GAIT.stop);
  let [vx, ax] = settle(from.vx, from.ax, tvx, w, dt);
  let [vz, az] = settle(from.vz, from.az, tvz, w, dt);
  const mx = ((from.vx + vx) / 2) * dt;
  const mz = ((from.vz + vz) / 2) * dt;
  const meant = Math.hypot(mx, mz);
  const moved = meant > 1e-9 ? moveBy(solids, from, mx, mz) : from;
  const went = Math.hypot(moved.x - from.x, moved.z - from.z);
  // A solid in the way removes the part of the body's velocity that runs into it.
  if (meant > 1e-9 && meant - went > 1e-6) {
    vx = (moved.x - from.x) / dt;
    vz = (moved.z - from.z) / dt;
    ax = 0;
    az = 0;
  }
  return { ...ride(t, decks, from, moved.x, moved.z, vx, vz, dt), ax, az, blocked: meant > 1e-4 && went < meant * WALK_TO.stall };
}

/** Moves the eyes along the footing as the body arrives at (x, z) with velocity (vx, vz). */
function ride(t: Terrain, decks: readonly Footbed[], from: Stride, x: number, z: number, vx: number, vz: number, dt: number): Stride {
  const ahead = rideTarget(t, decks, x + vx * RIDE_LAG, z + vz * RIDE_LAG);
  const level = ahead + (from.level - ahead) * Math.exp(-GAIT.level * dt);
  const [eye, climb] = settle(from.eye, from.climb, level, GAIT.ride, dt);
  return { x, z, vx, vz, ax: (vx - from.vx) / dt, az: (vz - from.vz) / dt, eye, climb, level, blocked: false };
}

/** One frame of moving the body to (x, z), as travel along the trails does. The eyes follow the footing as in a walk. */
export function carry(t: Terrain, decks: readonly Footbed[], from: Stride, x: number, z: number, dt: number): Stride {
  if (dt <= 0) return from;
  return ride(t, decks, from, x, z, (x - from.x) / dt, (z - from.z) / dt, dt);
}
