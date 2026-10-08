// The vitality channel math, once. The renderer's shader reads these same
// constants, and `applyVitality` is the CPU reference tests run against.

import { type Part, SPRAYS, type Swatch } from "@gaia/schema";
import { type WindState, swayAt } from "./wind.ts";

export const CHANNEL_MATH = {
  /** Vitality span over which a piece collapses once it falls below its `loss`. */
  lossBand: 0.08,
  /** A spray's leaves drop in place at their own thresholds, spread this far either side of its `loss`. */
  dropSpread: 0.15,
  /** How strongly `droop` bends a vertex's offset from its pivot toward the ground. */
  sag: 1.1,
  /** Emission at full vitality and glow 1, as a fraction of the swatch's healthy color. */
  glowStrength: 0.55,
  /** Brightness at shade 0 and shade 1. */
  shadeLow: 0.62,
  shadeHigh: 1.1,
  /** Vitality span over which a piece turns from upright to fully fallen, once below its `fall` threshold. */
  fallBand: 0.14,
  /**
   * Rot opens holes below `rotStart`, deepening steadily to `rotMost` at
   * vitality 0. A fragment is a hole where the surface's rot noise (about
   * 0.1 to 0.9) falls below its rot times that depth.
   */
  rotStart: 0.85,
  rotMost: 0.8,
  /** A spinning piece stops below `spinStop` and turns at full speed above `spinFull`. */
  spinStop: 0.1,
  spinFull: 0.6,
} as const;

export interface VitalityView {
  /** Positions after loss, the wind when given, and droop. */
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

/** Turns `v` about the unit `axis` by `angle` radians (Rodrigues), as the shader does. */
function turn(v: readonly [number, number, number], axis: readonly [number, number, number], angle: number): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [x, y, z] = v;
  const [ux, uy, uz] = axis;
  const d = (ux * x + uy * y + uz * z) * (1 - c);
  return [x * c + (uy * z - uz * y) * s + ux * d, y * c + (uz * x - ux * z) * s + uy * d, z * c + (ux * y - uy * x) * s + uz * d];
}

/** How deep rot has reached at vitality `v`: a surface with rot `r` is a hole wherever its noise is below `r * rotAt(v)`. */
export const rotAt = (v: number): number => CHANNEL_MATH.rotMost * Math.min(1, Math.max(0, 1 - v / CHANNEL_MATH.rotStart));

/** How fast a spinning piece turns at vitality `v`, as a share of its full speed. */
export const spinAt = (v: number): number => smoothstep(CHANNEL_MATH.spinStop, CHANNEL_MATH.spinFull, v);

/** A moment's wind over a copy, and whether the part flutters (thin swatches do). */
export interface InWind {
  readonly state: WindState;
  readonly flutter: boolean;
}

/**
 * CPU reference of the plant shader's channel math. Each piece first
 * collapses onto its pivot (or falls about it), in the plant's rest shape;
 * then the wind bends it about its joints (`swayAt`), when given; then droop
 * bends its whole bough down about the bough's joint. Rot holes are cut per
 * fragment, so only `rotAt` says how much shows; spinning pieces stand at
 * their first turn.
 */
export function applyVitality(part: Part, vitality: number, swatch: Swatch = REFERENCE_SWATCH, wind?: InWind): VitalityView {
  const v = Math.min(1, Math.max(0, vitality));
  const { loss, droop, wither, glow, pivot, bough } = part.channels;
  const count = part.shade.length;
  const collapsed = new Float32Array(count * 3);
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
    // A spray's leaves drop in place, cut away per fragment; every other piece collapses onto its pivot.
    const threshold = SPRAYS.has(Math.floor(part.cutout[i * 3 + 2] ?? 0)) ? 0 : (loss[i] ?? 0);
    const grows = part.channels.grow?.[i] ?? 0;
    const keep = (threshold > 0 ? smoothstep(threshold, threshold + m.lossBand, v) : 1) * (grows > 0 ? 1 - smoothstep(grows, grows + m.lossBand, v) : 1);
    ox *= keep;
    oy *= keep;
    oz *= keep;
    // A spinning piece stands at its first turn here; the shader adds the turning.
    const fall = part.channels.fall;
    const from = fall?.[i * 4 + 3] ?? 0;
    if (fall !== undefined && from > 0) {
      const ax = fall[i * 4] ?? 0;
      const ay = fall[i * 4 + 1] ?? 0;
      const az = fall[i * 4 + 2] ?? 0;
      const most = Math.hypot(ax, ay, az);
      const angle = most * (1 - smoothstep(from - m.fallBand, from, v));
      if (most > 1e-6 && angle !== 0) [ox, oy, oz] = turn([ox, oy, oz], [ax / most, ay / most, az / most], angle);
    }
    collapsed[i * 3] = px + ox;
    collapsed[i * 3 + 1] = py + oy;
    collapsed[i * 3 + 2] = pz + oz;

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
  const positions = wind === undefined ? collapsed : swayAt(part, collapsed, wind.state, wind.flutter);
  // Droop bends the whole bough down about its joint, keeping each point's distance from it.
  for (let i = 0; i < count; i++) {
    const s = (droop[i] ?? 0) * (1 - v);
    if (s <= 0) continue;
    const bx = bough[i * 3] ?? 0;
    const by = bough[i * 3 + 1] ?? 0;
    const bz = bough[i * 3 + 2] ?? 0;
    const dx = (positions[i * 3] ?? 0) - bx;
    const dy = (positions[i * 3 + 1] ?? 0) - by;
    const dz = (positions[i * 3 + 2] ?? 0) - bz;
    const d = Math.hypot(dx, dy, dz);
    if (d <= 1e-5) continue;
    const ly = dy - s * d * m.sag;
    const bl = Math.hypot(dx, ly, dz);
    positions[i * 3] = bx + (dx / bl) * d;
    positions[i * 3 + 1] = by + (ly / bl) * d;
    positions[i * 3 + 2] = bz + (dz / bl) * d;
  }
  return { positions, colors, emission };
}
