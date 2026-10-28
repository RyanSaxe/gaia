// The wind field in GLSL. Every shader that moves in the wind, such as plants,
// grass and smoke, reads its breeze and gusts here, so a gust that bends the
// grass reaches the trees in it at the same moment. `gustAt` transcribes
// `gustAt` in @gaia/realize line for line with WIND_FIELD's numbers, and a
// test runs this text against it.

import { WIND_FIELD } from "@gaia/realize";

const f = (x: number): string => x.toFixed(8);
const { breeze, gust } = WIND_FIELD;

/**
 * `WIND_DIR`, the direction the wind blows toward now, and `gustAt(p, t)`.
 * `WIND_DIR` is the scene light's `uWindDir`, which the light computes once a
 * frame with `windDirAt` instead of every vertex computing it. `SWAY_GLSL`
 * moves a plant in this field.
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
