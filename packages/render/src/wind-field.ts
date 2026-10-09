// The one wind field in GLSL: every shader that moves in the wind (plants,
// grass, smoke) reads its breeze and gusts from here, so a gust that bows
// the grass reaches the trees standing in it at the same moment. `gustAt` is
// a line-for-line transcription of `gustAt` in @gaia/realize, with
// WIND_FIELD's numbers; a test runs this text against it. The wind's
// direction is one value a frame, so the scene light computes it with
// `windDirAt` (`uWindDir`) rather than every vertex turning it again. How a
// plant answers the field is `SWAY_GLSL`.

import { WIND_FIELD } from "@gaia/realize";

const f = (x: number): string => x.toFixed(8);
const { breeze, gust } = WIND_FIELD;

/**
 * `WIND_DIR`, where the wind blows toward now (the scene light's `uWindDir`,
 * which every material using this chunk takes), and `gustAt(p, t)`.
 */
export const WIND_FIELD_GLSL = /* glsl */ `
const vec2 WIND_MEAN = vec2(${f(WIND_FIELD.dir[0])}, ${f(WIND_FIELD.dir[1])});
uniform vec2 uWindDir;
#define WIND_DIR uWindDir
// How hard the air blows at p and time t, 0 to 1: a breeze that swells and
// eases, and irregular gusts, most of them mild, that travel downwind as
// soft fronts bowed by a slow meander.
float gustAt(vec2 p, float t) {
  float along = p.x * WIND_MEAN.x + p.y * WIND_MEAN.y;
  float across = p.y * WIND_MEAN.x - p.x * WIND_MEAN.y;
  float u = (along - t * ${f(gust.speed)}) * ${f((2 * Math.PI) / gust.spacing)} + 2.2 * sin(across * 0.02 + 0.7 * sin(along * 0.011 + t * 0.05));
  float breeze = ${f(breeze.level)} + ${f(breeze.swell[0])} * sin(u * 0.21 + across * 0.012 + 0.4) + ${f(breeze.swell[1])} * sin(u * 0.083 - across * 0.0084 + 2.0);
  float c = (u + 0.5 * sin(u * 0.37 + 0.9)) * ${f(1 / (2 * Math.PI))};
  float n = floor(c);
  float s = c - n;
  float pulse = smoothstep(0.25, 0.68, s) * (1.0 - smoothstep(0.68, 0.9, s));
  float r = 1.0 - abs(2.0 * fract(n * 0.618034 + 0.35 * sin(n * 1.7 + 1.1)) - 1.0);
  float strength = pow(r, ${f(gust.most)}) * (${f(1 - gust.patch)} + ${f(gust.patch)} * sin(across * 0.03 + n * 2.9));
  return breeze + (1.0 - breeze) * strength * pulse;
}
`;
