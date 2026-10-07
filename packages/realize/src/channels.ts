// The vitality channel math, once. The renderer's shader reads these same
// constants, and `applyVitality` is the CPU reference tests run against.

import type { Part, Swatch } from "@gaia/schema";

export const CHANNEL_MATH = {
  /** Vitality span over which a piece collapses once it falls below its `loss`. */
  lossBand: 0.08,
  /** How strongly `droop` bends a vertex's offset from its pivot toward the ground. */
  sag: 1.1,
  /** Emission at full vitality and glow 1, as a fraction of the swatch's healthy color. */
  glowStrength: 0.55,
  /** Brightness at shade 0 and shade 1. */
  shadeLow: 0.62,
  shadeHigh: 1.1,
} as const;

export interface VitalityView {
  /** Positions after loss and droop, before wind. */
  readonly positions: Float32Array;
  /** Albedo per vertex: the swatch mixed toward decline, times shade. */
  readonly colors: Float32Array;
  /** Emitted light per vertex, added after lighting. */
  readonly emission: Float32Array;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** A neutral swatch for tests that only care whether colors move. */
export const REFERENCE_SWATCH: Swatch = { healthy: [0.3, 0.6, 0.3], decline: [0.6, 0.5, 0.35] };

/**
 * Rotates a color's hue by `turns` in YIQ space, which the shader does the
 * same way. Brightness is unchanged, so tint never fights shade.
 */
export function hueRotate(rgb: readonly [number, number, number], turns: number): [number, number, number] {
  const [r, g, b] = rgb;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const i = 0.596 * r - 0.274 * g - 0.322 * b;
  const q = 0.211 * r - 0.523 * g + 0.312 * b;
  const a = turns * 2 * Math.PI;
  const i2 = i * Math.cos(a) - q * Math.sin(a);
  const q2 = i * Math.sin(a) + q * Math.cos(a);
  const c = (x: number): number => Math.min(1, Math.max(0, x));
  return [c(y + 0.956 * i2 + 0.621 * q2), c(y - 0.272 * i2 - 0.647 * q2), c(y - 1.106 * i2 + 1.703 * q2)];
}

/** CPU reference of the plant shader's channel math. */
export function applyVitality(part: Part, vitality: number, swatch: Swatch = REFERENCE_SWATCH): VitalityView {
  const v = Math.min(1, Math.max(0, vitality));
  const { loss, droop, wither, glow, pivot } = part.channels;
  const count = part.shade.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const emission = new Float32Array(count * 3);
  const m = CHANNEL_MATH;
  for (let i = 0; i < count; i++) {
    const px = pivot[i * 3] ?? 0;
    const py = pivot[i * 3 + 1] ?? 0;
    const pz = pivot[i * 3 + 2] ?? 0;
    let ox = (part.positions[i * 3] ?? 0) - px;
    let oy = (part.positions[i * 3 + 1] ?? 0) - py;
    let oz = (part.positions[i * 3 + 2] ?? 0) - pz;
    const s = (droop[i] ?? 0) * (1 - v);
    const d = Math.hypot(ox, oy, oz);
    if (s > 0 && d > 1e-5) {
      const by = oy - s * d * m.sag;
      const bl = Math.hypot(ox, by, oz);
      ox = (ox / bl) * d;
      oy = (by / bl) * d;
      oz = (oz / bl) * d;
    }
    const threshold = loss[i] ?? 0;
    const keep = threshold > 0 ? smoothstep(threshold, threshold + m.lossBand, v) : 1;
    positions[i * 3] = px + ox * keep;
    positions[i * 3 + 1] = py + oy * keep;
    positions[i * 3 + 2] = pz + oz * keep;

    const w = (wither[i] ?? 0) * (1 - v);
    const bright = m.shadeLow + (m.shadeHigh - m.shadeLow) * (part.shade[i] ?? 0.5);
    const g = (glow[i] ?? 0) * v * m.glowStrength;
    // Tint varies only the healthy color, so decline reads the same across a canopy.
    const tinted = hueRotate(swatch.healthy, part.tint[i] ?? 0);
    for (let c = 0; c < 3; c++) {
      const healthy = tinted[c] ?? 0;
      const decline = swatch.decline[c] ?? 0;
      colors[i * 3 + c] = (healthy + (decline - healthy) * w) * bright;
      emission[i * 3 + c] = healthy * g;
    }
  }
  return { positions, colors, emission };
}
