// The light at any hour of a world's day. The hour comes from the person's
// clock, which only the renderer reads; this stays a pure function of it.

import type { DayKey, DaySpec, LightSpec, Rgb, Vec3 } from "@gaia/schema";
import { mixLab } from "@gaia/primitives";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** A direction's height above the horizon and its bearing (0 along +z), in radians. */
const heightOf = (v: Vec3): number => Math.asin(Math.min(1, Math.max(-1, v[1])));
const bearingOf = (v: Vec3): number => Math.atan2(v[0], v[2]);
/** The short way round from one bearing to another, radians. */
const turn = (from: number, to: number): number => ((to - from + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

/**
 * The slope at a key of a monotone cubic through it, from the changes over the spans before and after (Fritsch and
 * Butland): zero where the key is a peak or a trough, so the curve never overshoots a key.
 */
function slopeAt(before: number, after: number, spanBefore: number, spanAfter: number): number {
  const a = before / spanBefore;
  const b = after / spanAfter;
  if (a * b <= 0) return 0;
  const wa = 2 * spanAfter + spanBefore;
  const wb = spanAfter + 2 * spanBefore;
  return (wa + wb) / (wa / a + wb / b);
}

/** A cubic from `p0` to `p1` over `span` hours, leaving and arriving at the slopes `m0` and `m1`, at fraction `t`. */
function hermite(p0: number, p1: number, m0: number, m1: number, span: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * span * m0 + (3 * t2 - 2 * t3) * p1 + (t3 - t2) * span * m1;
}

/**
 * Where a body stands `t` of the way from key `i` to the next: a smooth curve through the keys' directions, in
 * height and bearing, that passes each key at its hour, turns the short way between keys and never overshoots a key.
 * A body moves along it without a corner or a jump in speed, so the sun rises and sets on a steady slant.
 */
function bodyAt(keys: readonly DayKey[], i: number, t: number, direction: (light: LightSpec) => Vec3): Vec3 {
  const n = keys.length;
  const key = (k: number): DayKey => keys[(((i + k) % n) + n) % n] as DayKey;
  const span = (k: number): number => (key(k + 1).hour - key(k).hour + 24) % 24 || 24;
  const [d0, d1, d2, d3] = [-1, 0, 1, 2].map((k) => direction(key(k).light)) as [Vec3, Vec3, Vec3, Vec3];
  const [h0, h1, h2, h3] = [d0, d1, d2, d3].map(heightOf) as [number, number, number, number];
  const b1 = bearingOf(d1);
  const b0 = b1 - turn(bearingOf(d0), b1);
  const b2 = b1 + turn(b1, bearingOf(d2));
  const b3 = b2 + turn(bearingOf(d2), bearingOf(d3));
  const along = (p0: number, p1: number, p2: number, p3: number): number =>
    hermite(p1, p2, slopeAt(p1 - p0, p2 - p1, span(-1), span(0)), slopeAt(p2 - p1, p3 - p2, span(0), span(1)), span(0), t);
  const height = along(h0, h1, h2, h3);
  const bearing = along(b0, b1, b2, b3);
  return [Math.sin(bearing) * Math.cos(height), Math.sin(height), Math.cos(bearing) * Math.cos(height)];
}

const mixColor = (a: Rgb, b: Rgb, t: number): Rgb => (t <= 0 ? a : t >= 1 ? b : mixLab(a, b, t));

function mixLight(a: LightSpec, b: LightSpec, t: number, sunDirection: Vec3, moonDirection: Vec3): LightSpec {
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
 * keys, colors mix in OKLab, the sun and moon move along a smooth curve
 * through the keys (`bodyAt`), and numbers move linearly; the last key wraps
 * to the first across midnight.
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
  return mixLight(a.light, b.light, t, bodyAt(keys, i, t, (l) => l.sunDirection), bodyAt(keys, i, t, (l) => l.moonDirection));
}
