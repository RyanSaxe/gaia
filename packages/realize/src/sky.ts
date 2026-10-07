// The sky's color in any direction, and the air between the eye and the land.
// These are the CPU references for SKY_GLSL and `aerial()` in @gaia/render:
// the dome and every distant surface compute their color with the same
// function, so far land dissolves into exactly the sky behind it.

import type { LightSpec, Rgb, Vec3 } from "@gaia/schema";

/** How the air treats distance, in meters. Land fully dissolves into the sky by `dissolveEnd`. */
export const AIR = {
  /** Past this, the haze reaches its full strength. */
  hazeFull: 900,
  /** The local air's tint gives way to the sky's own color between these distances. */
  tintFade: [300, 900],
  dissolveStart: 900,
  dissolveEnd: 1400,
} as const;

/** What the sky function reads: the hour's light and the sky's three gradient colors. */
export interface SkyInput {
  readonly light: Pick<LightSpec, "sunDirection" | "sunColor" | "horizonGlow" | "glow">;
  readonly sky: { readonly zenith: Rgb; readonly mid: Rgb; readonly horizon: Rgb };
}

/** What the air reads besides the sky: the local air's tint, its density and its low mist. */
export interface AirInput extends SkyInput {
  readonly fog: { readonly color: Rgb; readonly density: number; readonly mist: number };
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = clamp01((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const normalize2 = (x: number, y: number): [number, number] => {
  const len = Math.hypot(x, y);
  return [x / len, y / len];
};

/**
 * The sky's color looking along `dir` (a unit vector): the gradient from
 * horizon to zenith, the hour's glow on the sun's side, and the haze around
 * the sun. Below the horizon it holds the horizon's color, so nothing seen
 * there can meet the sky at a line. Clouds, stars and the moon are drawn on
 * top by the dome only.
 */
export function skyColorAt(look: SkyInput, dir: Vec3): Rgb {
  const { light, sky } = look;
  const e = Math.max(dir[1], 0);
  let color = mix(sky.horizon, sky.mid, smoothstep(0, 0.32, e));
  color = mix(color, sky.zenith, smoothstep(0.28, 0.9, e));
  const sl = Math.hypot(...light.sunDirection);
  const sun: Vec3 = [light.sunDirection[0] / sl, light.sunDirection[1] / sl, light.sunDirection[2] / sl];
  const sunUp = smoothstep(-0.08, 0.02, sun[1]);
  const flatDir = normalize2(dir[0] + 1e-4, dir[2] + 1e-4);
  const flatSun = normalize2(sun[0] + 1e-4, sun[2] + 1e-4);
  const toward = (flatDir[0] * flatSun[0] + flatDir[1] * flatSun[1]) * 0.5 + 0.5;
  color = mix(color, light.horizonGlow, Math.exp(-e * 5) * (0.35 + 0.65 * toward * toward) * light.glow * 0.75);
  const sunDot = Math.max(dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2], 0);
  color = mix(color, light.sunColor, Math.pow(sunDot, 10) * 0.28 * sunUp);
  const halo = Math.pow(sunDot, 180) * 0.18 * sunUp;
  return [color[0] + light.sunColor[0] * halo, color[1] + light.sunColor[1] * halo, color[2] + light.sunColor[2] * halo];
}

/**
 * The color of a surface at `point` seen from `eye` through the air. Near
 * and middle distance haze toward the local air's tint; farther, toward the
 * sky's own color along the same ray; past `AIR.dissolveEnd` the surface is
 * gone and only the sky remains.
 */
export function aerialAt(look: AirInput, color: Rgb, eye: Vec3, point: Vec3): Rgb {
  const ray: Vec3 = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const dist = Math.hypot(...ray);
  const k = 1 / Math.max(dist, 1e-4);
  const sky = skyColorAt(look, [ray[0] * k, ray[1] * k, ray[2] * k]);
  const air = mix(sky, look.fog.color, 1 - smoothstep(AIR.tintFade[0], AIR.tintFade[1], dist));
  const haze = (1 - Math.exp(-dist * look.fog.density)) * (0.65 + 0.35 * smoothstep(150, AIR.hazeFull, dist));
  const mist = look.fog.mist * Math.exp(-Math.max(point[1], 0) * 0.45) * (1 - Math.exp(-dist * 0.035));
  const hazed = mix(color, air, clamp01(haze + mist * 0.7));
  return mix(hazed, sky, smoothstep(AIR.dissolveStart, AIR.dissolveEnd, dist));
}
