// The one wind field in GLSL: every shader that moves in the wind (plants,
// grass, smoke) reads its gusts from here, so a gust that bows the grass
// reaches the trees standing in it at the same moment. The numbers are
// WIND_FIELD in @gaia/realize, whose `gustAt` is the CPU reference; how a
// plant answers the field is `SWAY_GLSL`.

import { WIND_FIELD } from "@gaia/realize";

const f = (x: number): string => x.toFixed(5);

/** `WIND_DIR` and `gustAt(p, t)`. */
export const WIND_FIELD_GLSL = /* glsl */ `
const vec2 WIND_DIR = vec2(${f(WIND_FIELD.dir[0])}, ${f(WIND_FIELD.dir[1])});
// Gusts travel downwind as broad soft bands, their fronts bowed by a slow
// meander across the wind, so a gust reaches each thing in turn.
float gustAt(vec2 p, float t) {
  float along = dot(p, WIND_DIR);
  float across = dot(p, vec2(-WIND_DIR.y, WIND_DIR.x));
  float phase = along * ${f(WIND_FIELD.gust.wave)} - t * ${f(WIND_FIELD.gust.wave * WIND_FIELD.gust.speed)} + 1.6 * sin(across * 0.023 + 0.7 * sin(along * 0.011 + t * 0.05));
  return smoothstep(0.35, 1.0, 0.5 + 0.5 * sin(phase));
}
`;
