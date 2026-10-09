// How everything that grows answers the wind field (`wind-field.ts`). A
// plant bends where it stands, level by level: the whole plant from its
// base, each bough about the joint where it leaves the trunk, each twig about
// where it leaves its bough, and each leaf or flower turns on its stalk.
// Every level turns about one axis per joint, so whatever a joint carries
// turns as one and a broad leaf or a round stem keeps its shape; the turn
// grows smoothly along the piece and eases toward a most it never passes.
// A long hanging piece swings less the farther it hangs, its lower end
// trailing its top, and a tall plant leans less than a small one. The
// shaders read these numbers (`SWAY_GLSL` in @gaia/render), and `swayAt` is
// the CPU reference the tests run against.

import { CUT, type Part } from "@gaia/schema";
import { WIND_FIELD, gustAt, windDirAt } from "./wind-field.ts";

/** One level of a plant's bend: how far it leans downwind and swings about that lean, as an angle. */
export interface WindLevel {
  /** The steady lean at full gust, in radians, for a supple plant in a light breeze. */
  readonly lean: number;
  /** How far it swings about its lean, as a share of the lean. */
  readonly swing: number;
  /** How fast it swings, radians per second at a gentle rhythm: smaller parts swing faster. */
  readonly rate: number;
  /** The most it ever turns, in radians: a strong wind on a supple plant eases toward this and never past it. */
  readonly most: number;
}

/** The wind field (`WIND_FIELD`) and how every plant answers it, level by level. */
export const WIND = {
  ...WIND_FIELD,
  /** The whole plant bends from its base, by height. */
  trunk: { lean: 0.05, swing: 0.45, rate: 0.75, most: 0.1 },
  /** A bough turns about its joint; its reach is a share of the plant's height, within bounds in meters. */
  bough: { lean: 0.07, swing: 0.6, rate: 1.55, most: 0.2, reach: 0.35, least: 0.6, longest: 4 },
  /** A twig turns about where it leaves its bough, over its reach in meters. */
  twig: { lean: 0.1, swing: 0.8, rate: 2.7, most: 0.28, reach: 0.6 },
  /** Leaves and flowers turn on their stalks, only in a gust; past its reach in meters a piece turns less, so a long strand only rustles. */
  leaf: { lean: 0, swing: 0.16, rate: 6.5, most: 0.3, reach: 1 },
  /**
   * How a plant answers the gust where it stands, 0 to 1: its lean and swing
   * scale by calm + (full - calm) x gust², so the steady breeze only stirs it
   * and a strong gust bows it; a leaf's flutter scales by full x gust².
   */
  answer: { calm: 0.2, full: 1.8 },
  /** A level's turn grows along the piece over this many reaches, steepest at the joint, then holds. */
  grow: 1.5,
  /** Past where its turn holds, a hanging piece swings less with distance, and its lower end trails its top by this many radians a meter. */
  trail: 0.6,
  /**
   * Stiffness from build: a plant's trunk leans by sqrt(height / its height)
   * of a plant this tall, within these bounds, and its boughs by the square
   * root of that, because a taller plant's trunk and boughs are thicker.
   */
  build: { height: 4, least: 0.45, most: 1.3 },
} as const;

/** Swatches whose pieces turn on their stalks in a gust: leaves and flowers, never the stems and moss that carry or cling. */
export const FLUTTERS: ReadonlySet<string> = new Set(["leaf", "bloom", "eye"]);

/**
 * Cuts that never turn on their own, only with their twig and bough: a fir's
 * needles and the heart of its frond, too stiff to flutter, and a willow's
 * strand, too long to turn as one leaf: its rows would turn by different
 * angles and pull apart.
 */
export const STIFF: ReadonlySet<number> = new Set([CUT.needles, CUT.core, CUT.strand]);

/** A seeded phase in radians from a joint's place, so neighboring boughs never swing in step. */
export function jointPhase(x: number, y: number, z: number, seed: number): number {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return (h - Math.floor(h) + seed) * 6.283185307179586;
}

/** The air where a copy stands: the hour, the world's wind, the plant's own response, its height and where it is. */
export interface WindState {
  readonly time: number;
  /** The world's wind at this moment, 1 a light breeze. */
  readonly strength: number;
  /** The plant's `MotionSpec`: how far it gives, and how quickly it swings. */
  readonly sway: number;
  readonly frequency: number;
  /** The plant's height, meters. */
  readonly height: number;
  /** Where the copy's base stands in the world, and its seed. */
  readonly at: readonly [number, number, number];
  readonly seed: number;
}

/** How much a plant of `height` meters gives at its trunk, from its build (`WIND.build`). */
export function trunkGive(height: number): number {
  const b = WIND.build;
  return Math.min(b.most, Math.max(b.least, Math.sqrt(b.height / Math.max(height, 0.3))));
}

/** Eases an angle toward `most`, never past it. */
const ease = (angle: number, most: number): number => most * Math.tanh(angle / most);

/**
 * One level's turn at a joint, as a horizontal vector (x, z) whose length is
 * the angle and whose direction is where it leans: downwind by its lean,
 * swinging about it. `gust` is the gust at the joint; `fade` scales the
 * swing; `lag` delays it, in radians.
 */
function leanOf(level: WindLevel, s: WindState, give: number, gust: number, phase: number, fade: number, lag: number): [number, number] {
  const t = s.time * (0.5 + s.frequency) * level.rate + phase - lag;
  const answer = WIND.answer.calm + (WIND.answer.full - WIND.answer.calm) * gust * gust;
  const lean = level.lean * answer;
  const swing = level.lean * level.swing * answer * fade;
  const along = give * (lean + swing * Math.sin(t));
  const across = give * swing * 0.4 * Math.sin(t * 1.31 + phase * 1.7);
  const [dx, dz] = windDirAt(s.time);
  const x = along * dx - across * dz;
  const z = along * dz + across * dx;
  const l = Math.hypot(x, z);
  const k = l > 1e-9 ? ease(l, level.most) / l : 0;
  return [x * k, z * k];
}

/** Turns `p` about the unit axis `k` through `j` by `angle`, keeping its distance from `j`. Writes into `p`. */
function turnAbout(p: number[], j0: number, j1: number, j2: number, k0: number, k1: number, k2: number, angle: number): void {
  const vx = (p[0] as number) - j0;
  const vy = (p[1] as number) - j1;
  const vz = (p[2] as number) - j2;
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const dot = (k0 * vx + k1 * vy + k2 * vz) * (1 - c);
  p[0] = j0 + vx * c + (k1 * vz - k2 * vy) * sn + k0 * dot;
  p[1] = j1 + vy * c + (k2 * vx - k0 * vz) * sn + k1 * dot;
  p[2] = j2 + vz * c + (k0 * vy - k1 * vx) * sn + k2 * dot;
}

/**
 * Bends `p` about a joint by `level`, in the gust where its bough stands:
 * one axis for the whole joint, square to where it leans, and an angle that grows smoothly from the joint over
 * `WIND.grow` reaches. Past that, the swing fades and trails with distance,
 * so a long hanging piece sways rather than whips. Writes into `p`.
 */
function bendAt(p: number[], j0: number, j1: number, j2: number, level: WindLevel, s: WindState, give: number, gust: number, reach: number, phase: number): void {
  const d = Math.hypot((p[0] as number) - j0, (p[1] as number) - j1, (p[2] as number) - j2);
  if (d < 1e-4) return;
  const full = reach * WIND.grow;
  const x = 1 - Math.min(d / full, 1);
  const grow = 1 - x * x;
  const [lx, lz] = leanOf(level, s, give, gust, phase, full / Math.max(d, full), Math.max(0, d - full) * WIND.trail);
  const angle = Math.hypot(lx, lz);
  if (angle < 1e-7) return;
  // up x lean: a positive turn about it carries what stands above the joint toward the lean.
  turnAbout(p, j0, j1, j2, lz / angle, 0, -lx / angle, angle * grow);
}

const same = (a: Float32Array, i: number, b: Float32Array, k: number): boolean =>
  Math.abs((a[i * 3] as number) - (b[k * 3] as number)) + Math.abs((a[i * 3 + 1] as number) - (b[k * 3 + 1] as number)) + Math.abs((a[i * 3 + 2] as number) - (b[k * 3 + 2] as number)) < 1e-5;

/**
 * Where each vertex of `part`, at `positions` (as `applyVitality` places
 * them), stands in the wind. Leaves and flowers turn on their stalks only
 * where `flutter` is set, as the shader turns only `FLUTTERS` swatches, and
 * never where their cut is `STIFF`. The
 * copy stands unturned at `s.at`; the shader does the same in the copy's own
 * frame.
 */
export function swayAt(part: Part, positions: Float32Array, s: WindState, flutter: boolean): Float32Array {
  const out = new Float32Array(positions.length);
  const { pivot, bough, twig } = part.channels;
  const give = s.strength * s.sway;
  const trunk = trunkGive(s.height);
  const boughReach = Math.min(WIND.bough.longest, Math.max(WIND.bough.least, WIND.bough.reach * s.height));
  const [wx, wz] = windDirAt(s.time);
  const p = [0, 0, 0];
  const [tx, tz] = leanOf(WIND.trunk, s, give * trunk, gustAt(s.at[0], s.at[2], s.time), s.seed * 6.283185307179586, 1, 0);
  for (let i = 0; i < part.shade.length; i++) {
    p[0] = positions[i * 3] as number;
    p[1] = positions[i * 3 + 1] as number;
    p[2] = positions[i * 3 + 2] as number;
    const j = (a: Float32Array, c: number): number => a[i * 3 + c] as number;
    // One gust for everything a bough carries, where its joint stands: the gust varies over tens of meters.
    const gust = gustAt(s.at[0] + j(bough, 0), s.at[2] + j(bough, 2), s.time);
    if (flutter && !STIFF.has(Math.floor(part.cutout[i * 3 + 2] as number))) {
      // The piece turns as one about its foot (its pivot): it nods across its stalk and the wind, and twists about the stalk, by a mix its own.
      const [p0, p1, p2] = [j(pivot, 0), j(pivot, 1), j(pivot, 2)];
      const phase = jointPhase(p0, p1, p2, s.seed);
      let sx = p0 - j(twig, 0);
      let sy = p1 - j(twig, 1);
      let sz = p2 - j(twig, 2);
      const sl = Math.hypot(sx, sy, sz);
      [sx, sy, sz] = sl > 1e-3 ? [sx / sl, sy / sl, sz / sl] : [0, 1, 0];
      // stalk x wind, or up x wind when the stalk lies along the wind.
      let nx = sy * wz;
      let ny = sz * wx - sx * wz;
      let nz = -sy * wx;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-3) [nx, ny, nz, nl] = [wz, 0, -wx, 1];
      const twist = Math.sin(phase * 1.7);
      const nod = Math.cos(phase * 1.7);
      const ax = (nx / nl) * nod + sx * twist;
      const ay = (ny / nl) * nod + sy * twist;
      const az = (nz / nl) * nod + sz * twist;
      const al = Math.hypot(ax, ay, az) || 1;
      const amp = ease(give * WIND.leaf.swing * WIND.answer.full * gust * gust * Math.sin(s.time * (0.5 + s.frequency) * WIND.leaf.rate + phase), WIND.leaf.most);
      const d = Math.hypot((p[0] as number) - p0, (p[1] as number) - p1, (p[2] as number) - p2);
      turnAbout(p, p0, p1, p2, ax / al, ay / al, az / al, amp * Math.min(1, WIND.leaf.reach / Math.max(d, 1e-4)));
    }
    if (!same(twig, i, bough, i)) bendAt(p, j(twig, 0), j(twig, 1), j(twig, 2), WIND.twig, s, give, gust, WIND.twig.reach, jointPhase(j(twig, 0), j(twig, 1), j(twig, 2), s.seed));
    if (Math.hypot(j(bough, 0), j(bough, 1), j(bough, 2)) > 1e-4) bendAt(p, j(bough, 0), j(bough, 1), j(bough, 2), WIND.bough, s, give * Math.sqrt(trunk), gust, boughReach, jointPhase(j(bough, 0), j(bough, 1), j(bough, 2), s.seed));
    // The whole plant bends from its base: each point leans by its height, and drops to keep its length.
    const y = Math.max(0, p[1] as number);
    const k = (y * y) / Math.max(s.height, 0.3);
    const ux = tx * k;
    const uz = tz * k;
    const drop = y > 1e-4 ? (ux * ux + uz * uz) / (2 * y) : 0;
    out[i * 3] = (p[0] as number) + ux;
    out[i * 3 + 1] = (p[1] as number) - drop;
    out[i * 3 + 2] = (p[2] as number) + uz;
  }
  return out;
}
