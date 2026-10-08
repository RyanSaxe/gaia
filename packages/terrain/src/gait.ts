// How a person's body carries their eyes while they walk, one pure step at a
// time. The body eases into a stride and settles when it stops, slows
// climbing and quickens a little on a gentle descent, stands on a
// footbridge's deck, and its eyes ride over the ground on a critically
// damped spring that follows the land's shape and smooths away its facets.
// Each step lifts the eyes a little and sways them a little, at the stride's
// own low frequency, with no roll and no pitch, fading with speed; water
// softens it, and a swimmer bobs instead.

import { footbridgeDeck } from "@gaia/primitives";
import type { Way } from "./paths.ts";
import { EYE_HEIGHT } from "./sight.ts";
import type { Solids } from "./solids.ts";
import { type Intent, type Stance, WADE, WALK_TO, moveBy, stanceAt, wadeSpeed } from "./walk.ts";
import { groundHeightAt } from "./wilds.ts";
import type { Terrain } from "./world.ts";

/** Every parameter of the gait. Sources for each are in docs/design-system.md (Terrain, walking). */
export const GAIT = {
  /** The one switch: false walks without the stride's rise and fall and sway; the easing, the grade and the ride over the ground stay. */
  on: true,
  /** Seconds to reach 95% of a new pace speeding up, and slowing down: about two steps to get going, one to stop. */
  start: 1,
  stop: 0.7,
  /** Shift's pace, as a multiple of walking pace. */
  hurry: 2.4,
  /** Turning on the arrow keys: radians a second, and seconds to reach 95% of that rate or to stop turning. */
  turn: 1.8,
  turnEase: 0.25,
  /**
   * Pace by grade, Tobler's hiking function made gentler: the pace is
   * multiplied by exp(-grade * (|S + peak| - peak)) for a rise S, so climbing
   * slows, a gentle descent of `peak` is quickest, and a steep one is careful;
   * never below `floor` nor above `ceiling`. The grade is measured over `reach` meters either side.
   */
  grade: 2,
  peak: 0.08,
  floor: 0.35,
  ceiling: 1.1,
  reach: 1,
  /** Steps a second: when a stride begins, at walking pace, and at Shift's pace. Faster paces lengthen the stride as well. */
  cadence: { begin: 1.4, walk: 1.9, run: 2.6 },
  /** Half the rise and fall of each step, meters, at walking pace and at Shift's pace. */
  lift: { walk: 0.011, run: 0.018 },
  /** Half the side-to-side sway, meters, once each stride of two steps. */
  sway: { walk: 0.006, run: 0.008 },
  /** The stride shows from this share of walking pace and fully by this one, so it fades in and out with speed. */
  showFrom: 0.15,
  showBy: 0.65,
  /** Wading softens the stride by up to this share as the water slows the walk. */
  wade: 0.65,
  /** The ground the eyes ride on is the mean under the feet, sampled this far round the body, meters. */
  footprint: 0.5,
  /**
   * The ride's natural frequency, radians a second: critically damped, so it
   * never overshoots or floats. Before it, the footing eases at `level`
   * radians a second, so a deck's edge rises as a ramp and the ride's
   * acceleration never jumps. The footing is read ahead of the body by the
   * ride's own lag, so the eyes keep their height on a slope and lift as a
   * foot reaches a step.
   */
  ride: 11,
  level: 16,
  /** A swimmer's gentle bob: meters up and down, and seconds per bob. */
  swim: { height: 0.03, period: 2.8 },
  /** A tap's walk slows to arrive as if braking at this rate, meters a second squared, ending within `WALK_TO.reach`. */
  arrive: 2.5,
} as const;

/** Where the feet are: the ground or deck underfoot, how the person stands there, and whether on a deck. */
export interface Footing extends Stance {
  readonly ground: number;
  readonly deck: boolean;
}

/** A footbridge's deck as a walk stands on it: its middle, its axis, its half span and width, and its top above `base`. */
export interface Deck {
  readonly x: number;
  readonly z: number;
  readonly cos: number;
  readonly sin: number;
  readonly half: number;
  readonly halfWidth: number;
  readonly base: number;
  readonly topAt: (u: number) => number;
}

/** The decks of every footbridge on the ways, where a walk stands above the water. */
export function decksOf(ways: readonly Way[]): Deck[] {
  const out: Deck[] = [];
  for (const way of ways) {
    if (way.style.crossing !== "footbridge") continue;
    for (const c of way.crossings) {
      const deck = footbridgeDeck(c.span, way.style.width);
      out.push({ x: c.x, z: c.z, cos: Math.cos(c.yaw), sin: Math.sin(c.yaw), half: c.span / 2, halfWidth: deck.halfWidth, base: c.bank, topAt: deck.topAt });
    }
  }
  return out;
}

/** The highest deck's top over a point, or -Infinity off every deck. */
function deckAt(decks: readonly Deck[], x: number, z: number): number {
  let top = -Infinity;
  for (const d of decks) {
    const dx = x - d.x;
    const dz = z - d.z;
    // Local +x runs along the span as Three's rotation about y turns it.
    const u = dx * d.cos - dz * d.sin;
    const v = dx * d.sin + dz * d.cos;
    if (Math.abs(u) <= d.half && Math.abs(v) <= d.halfWidth) top = Math.max(top, d.base + d.topAt(u));
  }
  return top;
}

/** How a person stands at a point: on a deck where one stands above the ground or the water there, dry; otherwise on the ground, wading or swimming. */
export function footingAt(t: Terrain, decks: readonly Deck[], x: number, z: number): Footing {
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
  /** Velocity over the ground, meters a second, and how fast it is changing. */
  readonly vx: number;
  readonly vz: number;
  readonly ax: number;
  readonly az: number;
  /** Steps taken: a foot falls at each whole number. */
  readonly steps: number;
  /** The eyes' height riding over the ground, before the stride's rise and fall, and how fast it is changing. */
  readonly eye: number;
  readonly climb: number;
  /** The eased footing the ride follows: the eyes' height there. */
  readonly level: number;
  /** A swimmer's bob, in turns. */
  readonly float: number;
  /** What the stride adds to the eyes now: up, and to the right of the way the body moves, meters. */
  readonly lift: number;
  readonly sway: number;
  /** Whether solids held this step to less than a fiftieth of what it meant to move. */
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

/** Seconds to come within 5% of a step in a critically damped spring of natural frequency w is 4.74 / w. */
const RATE = 4.744;

const smoothstep = (lo: number, hi: number, x: number): number => {
  const c = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return c * c * (3 - 2 * c);
};

/** The share of the pace kept on a rise of `slope` (meters up per meter along; negative going down). */
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
/** Seconds the ride trails the footing it follows: a critically damped spring's lag on a ramp, and the easing before it. */
const RIDE_LAG = 2 / GAIT.ride + 1 / GAIT.level;

/** The eyes' height above the mean footing round a point, weighted toward its middle: the ground's shape without its facets. */
function rideTarget(t: Terrain, decks: readonly Deck[], x: number, z: number): number {
  const r = GAIT.footprint;
  let sum = 0;
  for (const [ox, oz, w] of FOOTPRINT) sum += footingAt(t, decks, x + ox * r, z + oz * r).eye * w;
  return sum / FOOTPRINT_WEIGHT;
}

/** A body standing still at a point, eyes at rest. */
export function standAt(t: Terrain, decks: readonly Deck[], x: number, z: number): Stride {
  const eye = rideTarget(t, decks, x, z);
  return { x, z, vx: 0, vz: 0, ax: 0, az: 0, steps: 0, eye, climb: 0, level: eye, float: 0, lift: 0, sway: 0, blocked: false };
}

/** Linear between walking and Shift's pace by `run`, 0 to 1. */
const byPace = (v: { readonly walk: number; readonly run: number }, run: number): number => v.walk + (v.run - v.walk) * run;

/**
 * One frame of walking. The body's velocity eases toward what the person
 * wants (a direction of length up to 1 and a speed), slowed by water and by
 * the grade along the way it would go; solids turn it aside as they turn any
 * step. The eyes ride the footing, and each step lifts and sways them.
 */
export function stride(t: Terrain, solids: Solids, decks: readonly Deck[], from: Stride, want: Intent, dt: number): Stride {
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
  // A solid in the way takes the body's speed with it, but only the part running into it.
  if (meant > 1e-9 && meant - went > 1e-6) {
    vx = (moved.x - from.x) / dt;
    vz = (moved.z - from.z) / dt;
    ax = 0;
    az = 0;
  }
  const ahead = rideTarget(t, decks, moved.x + vx * RIDE_LAG, moved.z + vz * RIDE_LAG);
  const level = ahead + (from.level - ahead) * Math.exp(-GAIT.level * dt);
  const [eye, climb] = settle(from.eye, from.climb, level, GAIT.ride, dt);
  // The stride: its cadence and size follow the pace, and it fades with speed and in water.
  const share = Math.hypot(vx, vz) / WALK_TO.pace;
  const run = smoothstep(1, GAIT.hurry, share);
  const cadence = share < 1 ? GAIT.cadence.begin + (GAIT.cadence.walk - GAIT.cadence.begin) * share : GAIT.cadence.walk + (GAIT.cadence.run - GAIT.cadence.walk) * run;
  const steps = (from.steps + cadence * dt * smoothstep(0, GAIT.showFrom, share)) % 2;
  const after = footingAt(t, decks, moved.x, moved.z);
  const soft = (1 - GAIT.wade * smoothstep(WADE.slowFrom, WADE.slowTo, after.depth)) * (1 - after.swim);
  const shown = GAIT.on ? smoothstep(GAIT.showFrom, GAIT.showBy, share) * soft : 0;
  const float = (from.float + dt / GAIT.swim.period) % 1;
  // A foot falls at each whole step, where the eyes are lowest; they are highest over the foot in mid-stride.
  const lift = -Math.cos(steps * Math.PI * 2) * byPace(GAIT.lift, run) * shown + Math.sin(float * Math.PI * 2) * GAIT.swim.height * after.swim;
  const sway = Math.sin(steps * Math.PI) * byPace(GAIT.sway, run) * shown;
  return { x: moved.x, z: moved.z, vx, vz, ax, az, steps, eye, climb, level, float, lift, sway, blocked: meant > 1e-4 && went < meant * WALK_TO.stall };
}
