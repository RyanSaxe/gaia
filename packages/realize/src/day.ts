// The light at any hour of a world's day. The hour comes from the person's
// clock, which only the renderer reads; this stays a pure function of it.

import type { DaySpec, LightSpec, Rgb, Vec3 } from "@gaia/schema";
import { mixLab } from "@gaia/primitives";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Turns `a` toward `b` at a constant angular rate. */
function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.acos(dot);
  if (angle < 1e-6) return a;
  const s = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / s;
  const wb = Math.sin(t * angle) / s;
  const v: Vec3 = [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
  const len = Math.hypot(...v);
  return [v[0] / len, v[1] / len, v[2] / len];
}

const mixColor = (a: Rgb, b: Rgb, t: number): Rgb => (t <= 0 ? a : t >= 1 ? b : mixLab(a, b, t));

function mixLight(a: LightSpec, b: LightSpec, t: number): LightSpec {
  const sunDirection = slerp(a.sunDirection, b.sunDirection, t);
  const moonDirection = slerp(a.moonDirection, b.moonDirection, t);
  return {
    sunDirection,
    sunColor: mixColor(a.sunColor, b.sunColor, t),
    // A body below the horizon lends the land no direct light.
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t) * smoothstep(-0.04, 0.06, sunDirection[1]),
    moonDirection,
    moonColor: mixColor(a.moonColor, b.moonColor, t),
    moonIntensity: lerp(a.moonIntensity, b.moonIntensity, t) * smoothstep(-0.04, 0.08, moonDirection[1]),
    nightness: lerp(a.nightness, b.nightness, t),
    ambientColor: mixColor(a.ambientColor, b.ambientColor, t),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, t),
    shadowColor: mixColor(a.shadowColor, b.shadowColor, t),
    celBands: lerp(a.celBands, b.celBands, t),
    celSoftness: lerp(a.celSoftness, b.celSoftness, t),
    horizonGlow: mixColor(a.horizonGlow, b.horizonGlow, t),
    glow: lerp(a.glow, b.glow, t),
    zenithDim: lerp(a.zenithDim, b.zenithDim, t),
  };
}

/**
 * The light at a local hour (any real number; 24 hours wrap). Between two
 * keys, colors mix in OKLab, directions turn at a constant rate, and numbers
 * move linearly; the last key wraps to the first across midnight.
 */
export function lightAt(day: DaySpec, hour: number): LightSpec {
  const keys = day.keys;
  const last = keys[keys.length - 1];
  if (last === undefined) throw new Error("A day needs at least one key.");
  const h = ((hour % 24) + 24) % 24;
  let i = keys.length - 1;
  keys.forEach((k, j) => {
    if (k.hour <= h) i = j;
  });
  const a = keys[i] ?? last;
  const b = keys[(i + 1) % keys.length] ?? last;
  const span = (b.hour - a.hour + 24) % 24 || 24;
  const t = ((h - a.hour + 24) % 24) / span;
  return mixLight(a.light, b.light, t);
}
