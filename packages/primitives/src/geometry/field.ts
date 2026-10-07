// The one evaluator for height fields. Pure and deterministic: the same field
// and point give the same height on every thread and machine.

import type { HeightField } from "@gaia/schema";

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function hash(seed: number, x: number, z: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const GX = [1, -1, 1, -1, 1.4142, -1.4142, 0, 0];
const GZ = [1, 1, -1, -1, 0, 0, 1.4142, -1.4142];

/** Gradient noise, about -1..1. */
export function gradientNoise(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const corner = (ix: number, iz: number): number => {
    const h = hash(seed, x0 + ix, z0 + iz) & 7;
    return (GX[h] as number) * (fx - ix) + (GZ[h] as number) * (fz - iz);
  };
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * ux;
  const b = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * ux;
  return (a + (b - a) * uz) * 1.25;
}

/** Fractal sum of gradient noise, normalized to about -1..1. */
export function fbm(seed: number, x: number, z: number, octaves: number, gain: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gradientNoise(seed + i * 1013, x * f + i * 17.3, z * f - i * 9.1);
    norm += amp;
    amp *= gain;
    f *= 2.03;
  }
  return sum / norm;
}

function ridged(seed: number, x: number, z: number, octaves: number, gain: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    const r = 1 - Math.abs(gradientNoise(seed + i * 1013, x * f + i * 17.3, z * f - i * 9.1));
    sum += amp * r * r;
    norm += amp;
    amp *= gain;
    f *= 2.03;
  }
  return sum / norm;
}

/** The sideways offset of a trough's axis at distance `u` along it. Streams use it to follow the floor. */
export function troughOffset(f: Extract<HeightField, { op: "trough" }>, u: number): number {
  const p1 = ((f.seed % 997) / 997) * Math.PI * 2;
  const p2 = ((f.seed % 613) / 613) * Math.PI * 2;
  const w = (Math.PI * 2) / f.meanderWavelength;
  return f.meander * f.halfWidth * (0.7 * Math.sin(u * w + p1) + 0.3 * Math.sin(u * w * 2.3 + p2));
}

export function fieldAt(f: HeightField, x: number, z: number): number {
  switch (f.op) {
    case "constant":
      return f.value;
    case "noise": {
      const c = Math.cos(f.angle);
      const s = Math.sin(f.angle);
      const u = (x * c + z * s) / (f.wavelength * f.stretch);
      const v = (-x * s + z * c) / f.wavelength;
      return f.style === "ridged" ? ridged(f.seed, u, v, f.octaves, f.gain) : fbm(f.seed, u, v, f.octaves, f.gain);
    }
    case "dunes": {
      const c = Math.cos(f.angle);
      const s = Math.sin(f.angle);
      const u = x * c + z * s;
      const big = f.wavelength * 2.5;
      const p = u / f.wavelength + f.wander * 0.8 * fbm(f.seed, x / big, z / big, 2, 0.5);
      const t = p - Math.floor(p);
      // A long windward climb, then a shorter, steeper lee; both ends flat.
      const rise = 0.62;
      const shape = t < rise ? smooth(0, rise, t) : 1 - smooth(rise, 1, t);
      const crest = 0.68 + 0.32 * fbm(f.seed + 7, x / (big * 1.3), z / (big * 1.3), 2, 0.5);
      return shape * crest;
    }
    case "trough": {
      const c = Math.cos(f.angle);
      const s = Math.sin(f.angle);
      const u = x * c + z * s;
      const v = -x * s + z * c;
      const across = Math.abs(v - troughOffset(f, u)) / f.halfWidth;
      return smooth(0.14, 1, across);
    }
    case "plane": {
      const u = x * Math.cos(f.angle) + z * Math.sin(f.angle);
      return f.grade * f.reach * Math.tanh(u / f.reach);
    }
    case "dome":
      return 1 - smooth(0, f.radius, Math.hypot(x, z));
    case "ring": {
      const d = (Math.hypot(x, z) - f.radius) / f.width;
      return Math.exp(-d * d);
    }
    case "terrace": {
      const q = fieldAt(f.of, x, z) / f.step;
      const i = Math.floor(q);
      return f.step * (i + smooth(1 - f.riser, 1, q - i));
    }
    case "sum": {
      let total = 0;
      for (const g of f.of) total += fieldAt(g, x, z);
      return total;
    }
    case "product": {
      let total = 1;
      for (const g of f.of) {
        total *= fieldAt(g, x, z);
        if (total === 0) return 0;
      }
      return total;
    }
    case "scale":
      return f.by * fieldAt(f.of, x, z);
  }
}
