// The only evaluator for height fields. It is deterministic, so the same field
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

/** A valley's bends. The second, shorter wave keeps them from repeating. No bend is tighter than `tightest` half widths, so the shoulders never fold onto each other. */
const VALLEY_BENDS = { second: 0.15, apart: 2.1, tightest: 1.5 } as const;

/**
 * The sideways offset of a trough's axis at distance `u` along it. The axis swings `meander` meters to either side
 * every `meanderWavelength`, or less where a swing that wide would bend tighter than `VALLEY_BENDS.tightest` half
 * widths.
 */
export function troughOffset(f: Extract<HeightField, { op: "trough" }>, u: number): number {
  const p1 = ((f.seed % 997) / 997) * Math.PI * 2;
  const p2 = ((f.seed % 613) / 613) * Math.PI * 2;
  const w = (Math.PI * 2) / f.meanderWavelength;
  const sharper = 1 - VALLEY_BENDS.second + VALLEY_BENDS.second * VALLEY_BENDS.apart * VALLEY_BENDS.apart;
  const swing = Math.min(f.meander, 1 / (VALLEY_BENDS.tightest * f.halfWidth * w * w * sharper));
  return swing * ((1 - VALLEY_BENDS.second) * Math.sin(u * w + p1) + VALLEY_BENDS.second * Math.sin(u * w * VALLEY_BENDS.apart + p2));
}

/**
 * How a stream winds across its trough's floor. `apart` is the distance between bends in channel widths, from barely
 * winding to strongly winding. `tightest` is the smallest bend radius in channel widths, as in real stream meanders.
 * `toe` is how far a bend may reach onto the gentle toe past the floor's edge, as a multiple of the floor's half width.
 */
const BENDS = { apart: [10, 26], tightest: 2, toe: 1.4 } as const;
/** The range of a trough's `meander` in meters, from straight to strongly meandering in `valley@1`. It sets how the stream winds. */
const MEANDER = [4, 30] as const;
/** The stream's two bend waves. The second, shorter wave keeps the bends from repeating. `sharper` is how much tighter their sum bends than one wave. */
const WAVES = { second: 0.15, apart: 2.1, sharper: 0.85 + 0.15 * 2.1 * 2.1 } as const;

/** The trough fields that set how a stream bends: seed, `meander` in meters, floor share and half width. */
export type BendOf = Pick<Extract<HeightField, { op: "trough" }>, "seed" | "meander" | "floor" | "halfWidth">;

/**
 * How far a stream `width` meters wide swings from its valley's axis at distance `s` along it. These are the stream's
 * own meanders across the floor, at the stream's scale.
 */
export function bedBend(f: BendOf, s: number, width: number): number {
  const m = Math.max(0, Math.min(1, (f.meander - MEANDER[0]) / (MEANDER[1] - MEANDER[0])));
  const apart = width * (BENDS.apart[0] + (BENDS.apart[1] - BENDS.apart[0]) * m);
  const k = (Math.PI * 2) / apart;
  // The widest swing that keeps every bend within `BENDS.tightest` and the channel on the floor and its toe, never up
  // the valley's sides. A winding valley's stream swings that wide, and a straight valley's stream barely swings.
  const onFloor = BENDS.toe * f.floor * f.halfWidth - width / 2;
  const swing = Math.min(onFloor, 1 / (BENDS.tightest * width * k * k * WAVES.sharper)) * Math.min(1, 0.15 + 1.4 * m);
  const p1 = ((f.seed % 811) / 811) * Math.PI * 2;
  const p2 = ((f.seed % 467) / 467) * Math.PI * 2;
  return swing * ((1 - WAVES.second) * Math.sin(s * k + p1) + WAVES.second * Math.sin(s * k * WAVES.apart + p2));
}

/**
 * The sideways offset of a stream bed `width` meters wide at distance `u` along its trough. It adds the stream's own
 * meanders (`bedBend`) to the trough's axis (`troughOffset`), whose long bends are too broad to look like a stream's.
 */
export function bedOffset(f: Extract<HeightField, { op: "trough" }>, u: number, width: number): number {
  return troughOffset(f, u) + bedBend(f, u, width);
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
      // A long windward climb, then a shorter, steeper lee face, flat at both ends.
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
      // Distance is measured from the bent axis, not across the valley's run, so a bend keeps the valley's width and
      // sides. A few Newton steps from the point straight across find the nearest point on the axis.
      let a = u;
      for (let step = 0; step < 4; step++) {
        const off = troughOffset(f, a);
        const d1 = (troughOffset(f, a + 0.5) - troughOffset(f, a - 0.5)) / 1;
        const d2 = (troughOffset(f, a + 0.5) - 2 * off + troughOffset(f, a - 0.5)) / 0.25;
        const g1 = a - u + (off - v) * d1;
        const g2 = 1 + d1 * d1 + (off - v) * d2;
        if (g2 <= 0) break;
        a -= g1 / g2;
      }
      const across = Math.hypot(a - u, troughOffset(f, a) - v) / f.halfWidth;
      return smooth(f.floor, 1, across);
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
