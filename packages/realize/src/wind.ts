// The one wind field, and how everything that grows moves in it. Gusts
// travel downwind across the land as broad soft bands; a plant bends where
// it stands, level by level: the whole plant from its base, each bough about
// the joint where it leaves the trunk, each twig about where it leaves its
// bough, and each leaf flutters on its stalk. Every level is a bend about a
// joint that keeps each point's distance from it, and a piece carried by a
// joint moves with everything else that joint carries, so nothing ever
// parts from what holds it. The shaders read these numbers (`WIND_GLSL` in
// @gaia/render), and `swayAt` is the CPU reference the tests run against.

import type { Part } from "@gaia/schema";

/** A unit direction over the ground (x, z): where the wind blows toward. */
const DIR: readonly [number, number] = (() => {
  const l = Math.hypot(0.94, 0.34);
  return [0.94 / l, 0.34 / l];
})();

/** One level of a plant's bend: how far it leans downwind and swings about that lean, as an angle at its reach. */
export interface WindLevel {
  /** The steady lean at full gust, in radians at the level's reach, for a supple plant in a breeze. */
  readonly lean: number;
  /** How far it swings about its lean, as a share of the lean. */
  readonly swing: number;
  /** How fast it swings, radians per second at a gentle rhythm: smaller parts swing faster. */
  readonly rate: number;
}

export const WIND = {
  dir: DIR,
  /** Gust bands: radians of phase per meter downwind, and how fast they travel, meters per second. */
  gust: { wave: 0.1, speed: 8.5 },
  /** The whole plant bends from its base, by height. */
  trunk: { lean: 0.05, swing: 0.45, rate: 0.75 },
  /** A bough bends about its joint; its reach is a share of the plant's height, within bounds in meters. */
  bough: { lean: 0.07, swing: 0.6, rate: 1.55, reach: 0.35, least: 0.6, most: 4 },
  /** A twig bends about where it leaves its bough, over its reach in meters. */
  twig: { lean: 0.1, swing: 0.8, rate: 2.7, reach: 0.6 },
  /** A leaf flutters on its stalk, only in a gust, over its reach in meters. */
  leaf: { lean: 0, swing: 0.16, rate: 6.5, reach: 0.3 },
  /** A level's bend grows with distance from its joint up to this many reaches, then holds its angle. */
  most: 1.5,
} as const;

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * How strongly a gust blows at (x, z) and time t, 0 to 1: soft bands that
 * travel downwind, their fronts bowed by a slow meander across the wind, so
 * a gust reaches each tree in turn rather than all at once.
 */
export function gustAt(x: number, z: number, t: number): number {
  const along = x * DIR[0] + z * DIR[1];
  const across = -x * DIR[1] + z * DIR[0];
  const g = WIND.gust;
  const phase = along * g.wave - t * g.wave * g.speed + 1.6 * Math.sin(across * 0.023 + 0.7 * Math.sin(along * 0.011 + t * 0.05));
  return smoothstep(0.35, 1, 0.5 + 0.5 * Math.sin(phase));
}

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

/**
 * One level's push at a joint: downwind by its lean, swinging about it, with
 * a little bob, as a vector whose length is the bend's angle at its reach.
 * `gust` is the gust at the joint.
 */
function pushOf(level: WindLevel, s: WindState, gust: number, phase: number): [number, number, number] {
  const w = s.strength * s.sway;
  const t = s.time * (0.5 + s.frequency) * level.rate + phase;
  const lean = level.lean * (0.25 + 0.75 * gust);
  const swing = level.lean * level.swing * (0.35 + 0.65 * gust);
  const along = w * (lean + swing * Math.sin(t));
  const across = w * swing * 0.4 * Math.sin(t * 1.31 + phase * 1.7);
  const bob = w * swing * 0.5 * Math.sin(t * 1.13 + phase);
  return [along * DIR[0] - across * DIR[1], bob, along * DIR[1] + across * DIR[0]];
}

/** Bends `p` about `joint` by `push` (an angle at `reach`), keeping its distance from the joint. Writes into `p`. */
function bendAbout(p: number[], j0: number, j1: number, j2: number, push: readonly number[], reach: number): void {
  const ox = (p[0] as number) - j0;
  const oy = (p[1] as number) - j1;
  const oz = (p[2] as number) - j2;
  const d = Math.hypot(ox, oy, oz);
  if (d < 1e-4) return;
  const k = d * Math.min(d / reach, WIND.most);
  const bx = ox + (push[0] as number) * k;
  const by = oy + (push[1] as number) * k;
  const bz = oz + (push[2] as number) * k;
  const l = Math.hypot(bx, by, bz) || 1;
  p[0] = j0 + (bx / l) * d;
  p[1] = j1 + (by / l) * d;
  p[2] = j2 + (bz / l) * d;
}

const same = (a: Float32Array, i: number, b: Float32Array, k: number): boolean =>
  Math.abs((a[i * 3] as number) - (b[k * 3] as number)) + Math.abs((a[i * 3 + 1] as number) - (b[k * 3 + 1] as number)) + Math.abs((a[i * 3 + 2] as number) - (b[k * 3 + 2] as number)) < 1e-5;

/**
 * Where each vertex of `part`, at `positions` (as `applyVitality` places
 * them), stands in the wind. Leaves flutter only where `flutter` is set,
 * as the shader flutters only thin swatches. The copy stands unturned at
 * `s.at`; the shader does the same in the copy's own frame.
 */
export function swayAt(part: Part, positions: Float32Array, s: WindState, flutter: boolean): Float32Array {
  const out = new Float32Array(positions.length);
  const { pivot, bough, twig } = part.channels;
  const [ax, , az] = s.at;
  const boughReach = Math.min(WIND.bough.most, Math.max(WIND.bough.least, WIND.bough.reach * s.height));
  const p = [0, 0, 0];
  const trunkPush = pushOf(WIND.trunk, s, gustAt(ax, az, s.time), s.seed * 6.283185307179586);
  for (let i = 0; i < part.shade.length; i++) {
    p[0] = positions[i * 3] as number;
    p[1] = positions[i * 3 + 1] as number;
    p[2] = positions[i * 3 + 2] as number;
    const j = (a: Float32Array, c: number): number => a[i * 3 + c] as number;
    if (flutter) {
      const g = gustAt(ax + j(pivot, 0), az + j(pivot, 2), s.time);
      const amp = s.strength * s.sway * WIND.leaf.swing * g * g * Math.sin(s.time * (0.5 + s.frequency) * WIND.leaf.rate + jointPhase(j(pivot, 0), j(pivot, 1), j(pivot, 2), s.seed));
      bendAbout(p, j(pivot, 0), j(pivot, 1), j(pivot, 2), [j(part.normals, 0) * amp, j(part.normals, 1) * amp, j(part.normals, 2) * amp], WIND.leaf.reach);
    }
    if (!same(twig, i, bough, i)) {
      const g = gustAt(ax + j(twig, 0), az + j(twig, 2), s.time);
      bendAbout(p, j(twig, 0), j(twig, 1), j(twig, 2), pushOf(WIND.twig, s, g, jointPhase(j(twig, 0), j(twig, 1), j(twig, 2), s.seed)), WIND.twig.reach);
    }
    if (Math.hypot(j(bough, 0), j(bough, 1), j(bough, 2)) > 1e-4) {
      const g = gustAt(ax + j(bough, 0), az + j(bough, 2), s.time);
      bendAbout(p, j(bough, 0), j(bough, 1), j(bough, 2), pushOf(WIND.bough, s, g, jointPhase(j(bough, 0), j(bough, 1), j(bough, 2), s.seed)), boughReach);
    }
    // The whole plant bends from its base: each point leans by its height, and drops to keep its length.
    const y = Math.max(0, p[1] as number);
    const k = (y * y) / Math.max(s.height, 0.3);
    const ux = (trunkPush[0] as number) * k;
    const uz = (trunkPush[2] as number) * k;
    const drop = y > 1e-4 ? (ux * ux + uz * uz) / (2 * y) : 0;
    out[i * 3] = (p[0] as number) + ux;
    out[i * 3 + 1] = (p[1] as number) - drop;
    out[i * 3 + 2] = (p[2] as number) + uz;
  }
  return out;
}
