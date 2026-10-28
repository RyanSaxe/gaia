// The world's single wind field: where and when the air moves over the land.
// Everything that moves in the wind reads it, and `sway.ts` computes how plants
// respond. The shaders run the same formula (`WIND_FIELD_GLSL` in
// @gaia/render), and `gustAt` and `windDirAt` are the CPU reference.

const TAU = 6.283185307179586;

/** The average direction the wind blows toward, a unit vector over the ground (x, z). */
const DIR: readonly [number, number] = (() => {
  const l = Math.hypot(0.94, 0.34);
  return [0.94 / l, 0.34 / l];
})();

/**
 * The wind is mostly a light, steady breeze that swells and eases over tens of
 * seconds, with its direction varying a few degrees. Gusts come irregularly,
 * most mild and some strong. Each is a soft front that travels downwind across
 * the land, bowed by a slow meander and stronger in some places along it than
 * others, so a gust that bends the grass also reaches the trees in its path.
 */
export const WIND_FIELD = {
  dir: DIR,
  /** The direction varies about `dir` in two slow swings, with amplitudes in radians and rates in radians per second. */
  wander: { swing: [0.08, 0.05], rate: [0.071, 0.029] },
  /** The breeze between gusts, 0 to 1: its level, and two slow swells that travel downwind with it. */
  breeze: { level: 0.25, swell: [0.06, 0.04] },
  /**
   * Gusts travel downwind at `speed` meters per second, about `spacing`
   * meters apart, though many are too mild to notice. `most` sharpens
   * their strengths, so most are mild and a few strong. `patch` is how much
   * a front's strength varies along its length.
   */
  gust: { speed: 6, spacing: 54, most: 1.4, patch: 0.35 },
} as const;

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The direction the wind blows toward at time t: `dir`, turned a few degrees by its slow variation (`wander`). */
export function windDirAt(t: number): [number, number] {
  const w = WIND_FIELD.wander;
  const a = w.swing[0] * Math.sin(t * w.rate[0] + 0.6) + w.swing[1] * Math.sin(t * w.rate[1] + 2.1);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [DIR[0] * c - DIR[1] * s, DIR[0] * s + DIR[1] * c];
}

/**
 * How hard the air blows at (x, z) and time t, 0 to 1: the breeze, and a
 * gust while one passes. In the air's own frame, which travels downwind,
 * the gusts lie about `spacing` apart, each with its own strength. A gust
 * rises quickly at its front and eases off behind it.
 */
export function gustAt(x: number, z: number, t: number): number {
  const along = x * DIR[0] + z * DIR[1];
  const across = z * DIR[0] - x * DIR[1];
  const g = WIND_FIELD.gust;
  const b = WIND_FIELD.breeze;
  // Radians of the gust cycle in the air's frame, the fronts bowed by a slow meander.
  const u = (along - t * g.speed) * (TAU / g.spacing) + 2.2 * Math.sin(across * 0.02 + 0.7 * Math.sin(along * 0.011 + t * 0.05));
  const breeze = b.level + b.swell[0] * Math.sin(u * 0.21 + across * 0.012 + 0.4) + b.swell[1] * Math.sin(u * 0.083 - across * 0.0084 + 2.0);
  // Which gust this is and how far through its cycle, the spacing stretching and shrinking a little.
  const c = (u + 0.5 * Math.sin(u * 0.37 + 0.9)) / TAU;
  const n = Math.floor(c);
  const s = c - n;
  // A point reaches the high end of a cycle first, with a quick rise at the front and a slower easing behind.
  const pulse = smoothstep(0.25, 0.68, s) * (1 - smoothstep(0.68, 0.9, s));
  // Each gust's strength, spread evenly over 0 to 1 from gust to gust, in no order a person could follow.
  const v = n * 0.618034 + 0.35 * Math.sin(n * 1.7 + 1.1);
  const r = 1 - Math.abs(2 * (v - Math.floor(v)) - 1);
  const strength = r ** g.most * (1 - g.patch + g.patch * Math.sin(across * 0.03 + n * 2.9));
  return breeze + (1 - breeze) * strength * pulse;
}
