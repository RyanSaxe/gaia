// Color math in OKLab, where equal distances look equally different. Season
// shifts and the decline guard work here, never in raw RGB.

import type { ColorShift, Rgb } from "@gaia/schema";

export type Lab = readonly [number, number, number];

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export const hex = (h: number): Rgb => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

export function toOklab(c: Rgb): Lab {
  const r = toLinear(c[0]);
  const g = toLinear(c[1]);
  const b = toLinear(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function fromOklab(lab: Lab): Rgb {
  const l = (lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2]) ** 3;
  const m = (lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2]) ** 3;
  const s = (lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2]) ** 3;
  return [
    clamp01(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp01(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp01(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

/** Lightness, chroma and hue in degrees. */
export function toLch(c: Rgb): Lab {
  const [L, a, b] = toOklab(c);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
}

export function fromLch(L: number, C: number, h: number): Rgb {
  const r = (h * Math.PI) / 180;
  return fromOklab([L, C * Math.cos(r), C * Math.sin(r)]);
}

/** Perceptual distance. About 0.02 is barely noticeable; 0.1 is plainly different. */
export function deltaE(x: Rgb, y: Rgb): number {
  const a = toOklab(x);
  const b = toOklab(y);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function mixRgb(x: Rgb, y: Rgb, t: number): Rgb {
  return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
}

/** Mixes in OKLab, so a blend of two colors never passes through grey mud. */
export function mixLab(x: Rgb, y: Rgb, t: number): Rgb {
  const a = toOklab(x);
  const b = toOklab(y);
  return fromOklab([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

export const NO_SHIFT: ColorShift = { hue: 0, pull: 0, maxTurn: 0, chroma: 1, lightness: 0 };

/**
 * Applies a seasonal shift. The hue turns at most `maxTurn`, and colors far
 * around the wheel from the season's hue barely turn at all, so a pink canopy
 * is never dragged through orange into green: a family keeps its identity.
 */
export function shiftColor(c: Rgb, s: ColorShift): Rgb {
  const [L, C, h] = toLch(c);
  const d = ((s.hue - h + 540) % 360) - 180;
  const x = Math.min(1, Math.max(0, (Math.abs(d) - 60) / 90));
  // Deep, dark greens hold like evergreens; bright ones turn with the season.
  const y = Math.min(1, Math.max(0, (L - 0.32) / 0.3));
  const reach = (1 - x * x * (3 - 2 * x)) * y * y * (3 - 2 * y);
  // Near-grey colors have no meaningful hue; turning them would invent one.
  const turn = Math.max(-s.maxTurn, Math.min(s.maxTurn, d * s.pull)) * reach * Math.min(1, C / 0.04);
  return fromLch(Math.min(0.97, Math.max(0.05, L + s.lightness)), C * s.chroma, h + turn);
}

/**
 * Pushes `c` away from `anchor` in OKLab until they are at least `margin`
 * apart, so a shifted healthy color can never be mistaken for decline.
 * Steps along the existing difference; if the two coincide, brightens.
 */
export function keepApart(c: Rgb, anchor: Rgb, margin: number): Rgb {
  let out = c;
  for (let i = 0; i < 40 && deltaE(out, anchor) < margin; i++) {
    const a = toOklab(out);
    const b = toOklab(anchor);
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) [dx, dy, dz] = [1, 0, 0];
    else [dx, dy, dz] = [dx / len, dy / len, dz / len];
    // Gamut clamping can stall a step along one axis, so lightness also leans
    // away from the anchor each step.
    const lean = a[0] >= b[0] ? 1 : -1;
    out = fromOklab([a[0] + dx * 0.02 + lean * 0.006, a[1] + dy * 0.02, a[2] + dz * 0.02]);
  }
  return out;
}
