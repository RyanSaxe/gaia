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
 * The wild land's height at a point past the land: the lattice's height at
 * the nearest point of its edge, settling over `WILDS.settle` meters into the
 * roll, which swells into soft hills farther out. At the edge it is the
 * lattice's own height, so the two meet without a step.
 */
export function wildHeightAt(t: Terrain, x: number, z: number): number {
  const h = landHalf(t);
  const ex = Math.max(-h, Math.min(h, x));
  const ez = Math.max(-h, Math.min(h, z));
  const edge = heightAt(t.lattice, ex, ez);
  const past = Math.hypot(x - ex, z - ez);
  const swell = smooth((past - WILDS.hillsIn[0]) / (WILDS.hillsIn[1] - WILDS.hillsIn[0]));
  const hill = Math.max(-1, Math.min(1, wildNoise(x * WILDS.hillScale + 5000, z * WILDS.hillScale - 3000) * 1.6));
  const roll = wildBase(t) + Math.max(-1, Math.min(1, wildNoise(x, z) * 1.6)) * (WILDS.variation / 2) + swell * hill * (WILDS.hills / 2);
  return edge + (roll - edge) * smooth(past / WILDS.settle);
}

/** Whether a point lies past the land, in the wild that stands for nothing. */
export const inWilds = (t: Terrain, x: number, z: number): boolean => Math.max(Math.abs(x), Math.abs(z)) > landHalf(t);

/** The ground's height anywhere: the baked lattice on the land, the wild land past it. */
export function groundHeightAt(t: Terrain, x: number, z: number): number {
  return inWilds(t, x, z) ? wildHeightAt(t, x, z) : heightAt(t.lattice, x, z);
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
