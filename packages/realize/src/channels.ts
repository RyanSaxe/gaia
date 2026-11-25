// The vitality channel math, defined once. The renderer's shader reads these
// same constants, and `applyVitality` is the CPU reference that tests run against.

import { type Part, SPRAYS, type Swatch } from "@gaia/schema";
import { type WindState, swayAt } from "./sway.ts";

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
  /**
   * The vitality range a thing's look spans (`shownVitality`). At `shownRuin`
   * or below it shows full decline, at `shownWhole` or above it looks fully
   * healthy, and between them it declines evenly. Vitality is Jev's quality, a
   * mean of nine or ten concepts, so real code falls between about 0.36 and
   * 0.99. The range puts the poorest code at full decline and the best quarter
   * of Gaia's definitions at full health.
   */
  shownRuin: 0.45,
  shownWhole: 0.85,
  /**
   * Seconds for each of two easing stages to close about two thirds of a
   * vitality change. The shown vitality eases toward the given vitality, and
   * the previous shown value eases toward the shown one (`followVitality` in
   * @gaia/render), so a change starts and stops gently.
   */
  vitalityLag: 3,
} as const;

/**
 * The shown vitality for vitality `v`, from 0 at `shownRuin` to 1 at
 * `shownWhole`. Every channel uses this, not `v` itself. The renderer passes
 * it to the shaders and the ground declines by it, so one rule sets how
 * plainly vitality shows.
 */
export const shownVitality = (v: number): number =>
  Math.min(
    1,
    Math.max(
      0,
      (v - CHANNEL_MATH.shownRuin) /
        (CHANNEL_MATH.shownWhole - CHANNEL_MATH.shownRuin),
    ),
  );

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

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** The integral of smoothstep(0, 1, t) from 0 to t. */
const smoothRise = (t: number): number => {
  if (t <= 0) return 0;
  if (t >= 1) return t - 0.5;
  return t * t * t * (1 - 0.5 * t);
};

const clampRise = (u: number): number => {
  if (u <= 0) return 0;
  if (u >= 1) return u - 0.5;
  return 0.5 * u * u;
};

/**
 * smoothstep(e0, e1, v) averaged over the shown vitality from `v + lag` to
 * `v`. It is how far through one step of its decline a piece looks while a
 * vitality change eases in, so a step that the change crosses in one frame
 * spreads over the frames the lag spans. It matches the plant shader's
 * `eased`. With no lag it is the step itself.
 */
export function easedStep(
  e0: number,
  e1: number,
  v: number,
  lag: number,
): number {
  if (Math.abs(lag) < 1e-4) return smoothstep(e0, e1, v);
  const w = e1 - e0;
  return (
    (w * (smoothRise((v - e0) / w) - smoothRise((v + lag - e0) / w))) / -lag
  );
}

/** clamp(u, 0, 1) averaged as u runs evenly from `was` to `now` (the plant shader's `easedClamp`). */
export function easedClamp(now: number, was: number): number {
  if (Math.abs(now - was) < 1e-4) return clamp01(now);
  return (clampRise(now) - clampRise(was)) / (now - was);
}

/** A neutral swatch for tests that only care whether colors move. */
export const REFERENCE_SWATCH: Swatch = {
  healthy: [0.3, 0.6, 0.3],
  decline: [0.6, 0.5, 0.35],
};

/**
 * Rotates a color's hue by `turns` in YIQ space, which the shader does the
 * same way. Brightness is unchanged, so tint never alters shade.
 */
export function hueRotate(
  rgb: readonly [number, number, number],
  turns: number,
): [number, number, number] {
  const [r, g, b] = rgb;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const i = 0.596 * r - 0.274 * g - 0.322 * b;
  const q = 0.211 * r - 0.523 * g + 0.312 * b;
  const a = turns * 2 * Math.PI;
  const i2 = i * Math.cos(a) - q * Math.sin(a);
  const q2 = i * Math.sin(a) + q * Math.cos(a);
  return [
    clamp01(y + 0.956 * i2 + 0.621 * q2),
    clamp01(y - 0.272 * i2 - 0.647 * q2),
    clamp01(y - 1.106 * i2 + 1.703 * q2),
  ];
}

/** Turns `v` about the unit `axis` by `angle` radians (Rodrigues), as the shader does. */
function turn(
  v: readonly [number, number, number],
  axis: readonly [number, number, number],
  angle: number,
): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [x, y, z] = v;
  const [ux, uy, uz] = axis;
  const d = (ux * x + uy * y + uz * z) * (1 - c);
  return [
    x * c + (uy * z - uz * y) * s + ux * d,
    y * c + (uz * x - ux * z) * s + uy * d,
    z * c + (ux * y - uy * x) * s + uz * d,
  ];
}

/** How deep rot has reached at vitality `v`: a surface with rot `r` is a hole wherever its noise is below `r * rotAt(v)`. */
export const rotAt = (v: number): number =>
  CHANNEL_MATH.rotMost *
  Math.min(1, Math.max(0, 1 - v / CHANNEL_MATH.rotStart));

/** How fast a spinning piece turns at vitality `v`, as a share of its full speed. */
export const spinAt = (v: number): number =>
  smoothstep(CHANNEL_MATH.spinStop, CHANNEL_MATH.spinFull, v);

/** The wind on a copy at one moment, and whether the part flutters, as thin swatches do. */
export interface InWind {
  readonly state: WindState;
  readonly flutter: boolean;
}

/**
 * CPU reference of the plant shader's channel math. Each piece first
 * collapses onto its pivot, or falls about it, in the plant's rest shape. Then
 * the wind, when given, bends it about its joints (`swayAt`). Then droop bends
 * its whole bough down about the bough's joint. The shader cuts rot holes per
 * fragment, so only `rotAt` gives how much shows, and spinning pieces stay at
 * their starting angle. `lag` is how far the shown vitality trails its value a
 * moment ago while a change eases in. Each step is averaged over that lag, and
 * anything linear in vitality uses the midpoint.
 */
const readChannel = (
  arr: Float32Array | undefined,
  index: number,
  fallback = 0,
): number => arr?.[index] ?? fallback;

function keepFactor(part: Part, i: number, v: number, lag: number): number {
  const m = CHANNEL_MATH;
  // A spray's leaves drop in place, cut away per fragment. Every other piece collapses onto its pivot.
  const threshold = SPRAYS.has(Math.floor(readChannel(part.cutout, i * 3 + 2)))
    ? 0
    : readChannel(part.channels.loss, i);
  const grows = readChannel(part.channels.grow, i);
  const keepLoss =
    threshold > 0 ? easedStep(threshold, threshold + m.lossBand, v, lag) : 1;
  const keepGrow =
    grows > 0 ? 1 - easedStep(grows, grows + m.lossBand, v, lag) : 1;
  return keepLoss * keepGrow;
}

function fallOffset(
  ox: number,
  oy: number,
  oz: number,
  fall: Float32Array | undefined,
  i: number,
  v: number,
  lag: number,
): [number, number, number] {
  const from = readChannel(fall, i * 4 + 3);
  if (fall === undefined || from <= 0) return [ox, oy, oz];
  const ax = readChannel(fall, i * 4);
  const ay = readChannel(fall, i * 4 + 1);
  const az = readChannel(fall, i * 4 + 2);
  const most = Math.hypot(ax, ay, az);
  const angle =
    most * (1 - easedStep(from - CHANNEL_MATH.fallBand, from, v, lag));
  if (most <= 1e-6 || angle === 0) return [ox, oy, oz];
  return turn([ox, oy, oz], [ax / most, ay / most, az / most], angle);
}

function writeVertexColor(
  colors: Float32Array,
  emission: Float32Array,
  part: Part,
  i: number,
  mid: number,
  swatch: Swatch,
): void {
  const m = CHANNEL_MATH;
  const w = readChannel(part.channels.wither, i) * (1 - mid);
  const bright =
    m.shadeLow + (m.shadeHigh - m.shadeLow) * readChannel(part.shade, i, 0.5);
  const g = readChannel(part.channels.glow, i) * mid * m.glowStrength;
  // Tint varies only the healthy color, so decline reads the same across a canopy.
  const tinted = hueRotate(swatch.healthy, readChannel(part.tint, i));
  for (let c = 0; c < 3; c++) {
    const healthy = tinted[c] ?? 0;
    const decline = swatch.decline[c] ?? 0;
    colors[i * 3 + c] = (healthy + (decline - healthy) * w) * bright;
    emission[i * 3 + c] = healthy * g;
  }
}

function applyDroop(
  positions: Float32Array,
  droop: Float32Array,
  bough: Float32Array,
  count: number,
  mid: number,
): void {
  for (let i = 0; i < count; i++) {
    const s = readChannel(droop, i) * (1 - mid);
    if (s <= 0) continue;
    const bx = readChannel(bough, i * 3);
    const by = readChannel(bough, i * 3 + 1);
    const bz = readChannel(bough, i * 3 + 2);
    const dx = readChannel(positions, i * 3) - bx;
    const dy = readChannel(positions, i * 3 + 1) - by;
    const dz = readChannel(positions, i * 3 + 2) - bz;
    const d = Math.hypot(dx, dy, dz);
    if (d <= 1e-5) continue;
    const ly = dy - s * d * CHANNEL_MATH.sag;
    const bl = Math.hypot(dx, ly, dz);
    positions[i * 3] = bx + (dx / bl) * d;
    positions[i * 3 + 1] = by + (ly / bl) * d;
    positions[i * 3 + 2] = bz + (dz / bl) * d;
  }
}

export function applyVitality(
  part: Part,
  vitality: number,
  swatch: Swatch = REFERENCE_SWATCH,
  wind?: InWind,
  lag = 0,
): VitalityView {
  const v = clamp01(vitality);
  const mid = v + 0.5 * lag;
  const { droop, pivot, bough } = part.channels;
  const count = part.shade.length;
  const collapsed = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const emission = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const px = readChannel(pivot, i * 3);
    const py = readChannel(pivot, i * 3 + 1);
    const pz = readChannel(pivot, i * 3 + 2);
    const keep = keepFactor(part, i, v, lag);
    // A spinning piece stays at its starting angle here. The shader adds the turning.
    const [ox, oy, oz] = fallOffset(
      (readChannel(part.positions, i * 3) - px) * keep,
      (readChannel(part.positions, i * 3 + 1) - py) * keep,
      (readChannel(part.positions, i * 3 + 2) - pz) * keep,
      part.channels.fall,
      i,
      v,
      lag,
    );
    collapsed[i * 3] = px + ox;
    collapsed[i * 3 + 1] = py + oy;
    collapsed[i * 3 + 2] = pz + oz;
    writeVertexColor(colors, emission, part, i, mid, swatch);
  }
  const positions =
    wind === undefined
      ? collapsed
      : swayAt(part, collapsed, wind.state, wind.flutter);
  // Droop bends the whole bough down about its joint, keeping each point's distance from it.
  applyDroop(positions, droop, bough, count, mid);
  return { positions, colors, emission };
}
