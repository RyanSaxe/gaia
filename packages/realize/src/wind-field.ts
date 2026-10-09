// The one wind field: where and when the air moves over the land. Gusts
// travel downwind as broad soft bands, their fronts bowed by a slow meander,
// so a gust that bows the grass reaches the trees standing in it. Everything
// that moves in the wind reads its gusts from here; how a plant answers them
// is `sway.ts`. The shaders read these numbers (`WIND_FIELD_GLSL` in
// @gaia/render), and `gustAt` is the CPU reference.

/** A unit direction over the ground (x, z): where the wind blows toward. */
const DIR: readonly [number, number] = (() => {
  const l = Math.hypot(0.94, 0.34);
  return [0.94 / l, 0.34 / l];
})();

export const WIND_FIELD = {
  dir: DIR,
  /** Gust bands: radians of phase per meter downwind, and how fast they travel, meters per second. */
  gust: { wave: 0.1, speed: 8.5 },
} as const;

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * How strongly a gust blows at (x, z) and time t, 0 to 1: soft bands that
 * travel downwind, their fronts bowed by a slow meander across the wind, so
 * a gust reaches each tree in turn rather than all at once.
 */
export function gustAt(x: number, z: number, t: number): number {
  const along = x * DIR[0] + z * DIR[1];
  const across = -x * DIR[1] + z * DIR[0];
  const g = WIND_FIELD.gust;
  const phase = along * g.wave - t * g.wave * g.speed + 1.6 * Math.sin(across * 0.023 + 0.7 * Math.sin(along * 0.011 + t * 0.05));
  return smoothstep(0.35, 1, 0.5 + 0.5 * Math.sin(phase));
}
