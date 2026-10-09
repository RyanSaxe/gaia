// The wild land past the codebase's land. It stands for nothing and goes on
// forever: past the baked lattice's square the ground runs on from the rim's crest
// and settles down to the level of the land inside it, into a gentle seeded
// roll of at most 6 m that swells farther out into soft hills, so a person
// on the rim looks out over it. A person can walk on it without end. `groundHeightAt` is the ground anywhere, the baked
// lattice on the land and the wild land past it; the renderer's rings draw
// the same function through a GLSL twin of `wildNoise`, an integer hash that
// both sides compute bit for bit. `wildsRing` is one coarse ring of it
// around the world, for views from above.

import { heightAt } from "./lattice.ts";
import { TERRAIN, type Terrain } from "./world.ts";

export const WILDS = {
  /** The coarse ring for views from above: rings and segments around, 7,680 vertices, one draw call. */
  rings: 48,
  segments: 160,
  /** The coarse ring's outer radius in meters, past where far land has fully dissolved. */
  outer: 1500,
  /** Distance over which the rim's height settles into the wild roll. */
  settle: 160,
  /** The wild roll's whole height range in meters. */
  variation: 6,
  /** The roll's longest wavelength in meters, and its octaves, each half as long and half as high. */
  wavelength: 260,
  octaves: 3,
  /** Soft hills that swell in over `hillsIn` meters past the hand-over: their whole height range, and how much longer their wavelength is than the roll's. */
  hills: 12,
  hillsIn: [200, 1000],
  hillScale: 0.45,
  /** The coarse ring's inner row starts this far inside the land's square. */
  tuck: 6,
} as const;

/** A circle just inside the lattice's square, past which region covers carry on outward from the land's edge. */
export const landRadius = (t: Terrain): number => t.spec.size / 2 + TERRAIN.skirt - 8;

/** The integer hash both sides share: a lattice corner and an octave to a number in [0, 1). */
export function wildHash(ix: number, iz: number, octave: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(octave + 1, 0x5bd1e995);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * (3 - 2 * t);

/**
 * The wild roll's shape at a point, about -1 to 1: value noise over the
 * shared hash, `WILDS.octaves` octaves from `WILDS.wavelength` down.
 */
export function wildNoise(x: number, z: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let wave = WILDS.wavelength;
  for (let o = 0; o < WILDS.octaves; o++) {
    const gx = x / wave;
    const gz = z / wave;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const u = fade(gx - ix);
    const v = fade(gz - iz);
    const a = wildHash(ix, iz, o);
    const b = wildHash(ix + 1, iz, o);
    const c = wildHash(ix, iz + 1, o);
    const d = wildHash(ix + 1, iz + 1, o);
    sum += amp * (a + (b - a) * u + (c - a + (a - b - c + d) * u) * v - 0.5) * 2;
    norm += amp;
    amp *= 0.5;
    wave *= 0.5;
  }
  return sum / norm;
}

const bases = new WeakMap<Terrain, number>();
/** The wild roll's middle: the mean height of the land just inside the rim, so the wild lies level with the land and the rim is a crest between them. */
export function wildBase(t: Terrain): number {
  let base = bases.get(t);
  if (base === undefined) {
    const r = t.spec.size / 2 - TERRAIN.rimWidth;
    const n = 360;
    let sum = 0;
    for (let s = 0; s < n; s++) {
      const a = (s / n) * Math.PI * 2;
      sum += heightAt(t.lattice, Math.cos(a) * r, Math.sin(a) * r);
    }
    base = sum / n;
    bases.set(t, base);
  }
  return base;
}

const smooth = (t: number): number => fade(Math.max(0, Math.min(1, t)));

/** The half side of the square where the baked lattice hands over to the wild land: the lattice's own edge, rim and skirt included. */
export const landHalf = (t: Terrain): number => -t.lattice.origin - TERRAIN.spacing;

/** How far a point lies past the land's square: negative inside it, the distance to it outside. */
export function wildPast(t: Terrain, x: number, z: number): number {
  const h = landHalf(t);
  const qx = Math.abs(x) - h;
  const qz = Math.abs(z) - h;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/**
 * The roll the wild land settles into at a point, swelling into soft hills
 * farther out: the wild's own ground, without the land's edge it settles
 * away from. Past the land's square by `WILDS.settle` meters, it is the
 * ground itself.
 */
export function wildRollAt(t: Terrain, x: number, z: number): number {
  const swell = smooth((wildPast(t, x, z) - WILDS.hillsIn[0]) / (WILDS.hillsIn[1] - WILDS.hillsIn[0]));
  const hill = Math.max(-1, Math.min(1, wildNoise(x * WILDS.hillScale + 5000, z * WILDS.hillScale - 3000) * 1.6));
  return wildBase(t) + Math.max(-1, Math.min(1, wildNoise(x, z) * 1.6)) * (WILDS.variation / 2) + swell * hill * (WILDS.hills / 2);
}

/**
 * The wild land's height at a point past the land: the lattice's height at
 * the nearest point of its edge, settling over `WILDS.settle` meters into the
 * wild's roll (`wildRollAt`). At the edge it is the lattice's own height, so
 * the two meet without a step.
 */
export function wildHeightAt(t: Terrain, x: number, z: number): number {
  const h = landHalf(t);
  const ex = Math.max(-h, Math.min(h, x));
  const ez = Math.max(-h, Math.min(h, z));
  const edge = heightAt(t.lattice, ex, ez);
  const past = Math.hypot(x - ex, z - ez);
  return edge + (wildRollAt(t, x, z) - edge) * smooth(past / WILDS.settle);
}

/** Whether a point lies past the land, in the wild that stands for nothing. */
export const inWilds = (t: Terrain, x: number, z: number): boolean => Math.max(Math.abs(x), Math.abs(z)) > landHalf(t);

/** The ground's height anywhere: the baked lattice on the land, the wild land past it. */
export function groundHeightAt(t: Terrain, x: number, z: number): number {
  return inWilds(t, x, z) ? wildHeightAt(t, x, z) : heightAt(t.lattice, x, z);
}

// What grows on the wild land, as the world grows it: the renderer's ground
// shader draws the wild's covers through GLSL twins of `wildShare`,
// `wildPatch` and `wildScrub` (`wildNoise`'s twin makes them agree), and its
// thickets stand where `wildThicket` says. The field map draws the same
// functions, so the map and the world never disagree.

const smoothstep = (a: number, b: number, v: number): number => smooth((v - a) / (b - a));

/** How much of the wild's own cover grows at a point, 0 to 1: none on the land, all of it some way out, drifting in from the land's covers in islands. */
export function wildShare(t: Terrain, x: number, z: number): number {
  const past = wildPast(t, x, z);
  if (past < -40) return 0;
  return smooth((past - 20 + wildNoise(x * 8 + 311, z * 8 + 311) * 55) / 22);
}

/** Which of the wild's two covers grows at a point, 0 its tall green grass to 1 its golden steppe, in broad swathes a hundred meters and more across. */
export const wildPatch = (x: number, z: number): number => smoothstep(-0.3, 0.3, wildNoise(x * 1.5 + 97, z * 1.5 + 97));

/** Where the wild runs to scrub, 0 to 1, in patches a few hundred meters across, where its thickets gather too. */
export const wildScrub = (x: number, z: number): number => smoothstep(-0.1, 0.5, wildNoise(x * 0.6 + 1000, z * 0.6 + 1000));

export const WILD_THICKETS = {
  /** The world grid thickets stand on, meters, and the chance a cell holds one. */
  cell: 48,
  chance: 0.42,
  /** Bushes per thicket, fewest and most, and how far they spread from its middle, meters. */
  members: [1, 5],
  spread: 5,
  scale: [0.85, 1.45],
  /** Thickets thin in over this band past the land's edge, meters, as the wild's covers take over. */
  thinIn: [20, 140],
} as const;

/** A bush of a wild thicket: where it stands, its size, which way it turns, and its own seeds for color and growth. */
export interface WildBush {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly yaw: number;
  readonly hue: number;
  readonly seed: number;
}

/**
 * The thicket in one cell of the wild's grid (`WILD_THICKETS.cell` meters), if
 * it holds one: its bushes, and a number in [0, 1) that picks which kind of
 * bush it is. Seeded by the cell, so a cell always holds the same thicket.
 * Thickets gather where the wild runs to scrub and thin out over open grass.
 */
export function wildThicket(t: Terrain, ci: number, cj: number): { readonly pick: number; readonly bushes: readonly WildBush[] } | null {
  const g = WILD_THICKETS;
  const cx = (ci + 0.5) * g.cell;
  const cz = (cj + 0.5) * g.cell;
  const past = wildPast(t, cx, cz);
  if (past < 0) return null;
  const scrub = 0.15 + 1.7 * wildScrub(cx, cz);
  if (wildHash(ci, cj, 101) >= g.chance * scrub * smoothstep(g.thinIn[0], g.thinIn[1], past)) return null;
  const tx = (ci + wildHash(ci, cj, 102)) * g.cell;
  const tz = (cj + wildHash(ci, cj, 103)) * g.cell;
  const members = g.members[0] + Math.floor(wildHash(ci, cj, 104) * (g.members[1] - g.members[0] + 1));
  const bushes: WildBush[] = [];
  for (let m = 0; m < members; m++) {
    const a = wildHash(ci, cj, 110 + m) * Math.PI * 2;
    const d = m === 0 ? 0 : g.spread * (0.4 + 0.6 * wildHash(ci, cj, 120 + m));
    const x = tx + Math.cos(a) * d;
    const z = tz + Math.sin(a) * d;
    if (wildPast(t, x, z) < g.thinIn[0]) continue;
    bushes.push({
      x,
      z,
      scale: (g.scale[0] + (g.scale[1] - g.scale[0]) * wildHash(ci, cj, 140 + m)) * (m === 0 ? 1 : 0.85),
      yaw: wildHash(ci, cj, 130 + m) * Math.PI * 2,
      hue: (wildHash(ci, cj, 150 + m) - 0.5) * 0.04,
      seed: wildHash(ci, cj, 160 + m),
    });
  }
  return { pick: wildHash(ci, cj, 105), bushes };
}

export interface WildsRing {
  /** x, y, z per vertex, ring by ring from the inside out. */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

/**
 * A coarse ring of the ground around a baked world, for views from above:
 * from just inside the land's square, where the whole-world mesh draws
 * instead, out past where far land has dissolved. Pure and deterministic.
 */
export function wildsRing(t: Terrain): WildsRing {
  const { rings, segments, outer, tuck } = WILDS;
  const h = landHalf(t);
  const positions = new Float32Array(rings * segments * 3);
  for (let k = 0; k < rings; k++) {
    // Rows widen outward, where distance hides detail.
    const r = h - tuck + (outer - h + tuck) * Math.pow(k / (rings - 1), 1.7);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const v = (k * segments + s) * 3;
      positions[v] = x;
      positions[v + 1] = groundHeightAt(t, x, z);
      positions[v + 2] = z;
    }
  }
  const indices = new Uint32Array((rings - 1) * segments * 6);
  let i = 0;
  for (let k = 0; k < rings - 1; k++) {
    for (let s = 0; s < segments; s++) {
      const a = k * segments + s;
      const b = k * segments + ((s + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      indices.set([a, b, c, b, d, c], i);
      i += 6;
    }
  }
  return { positions, indices };
}
