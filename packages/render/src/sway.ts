// How a plant answers the wind field, in GLSL: each level's push, the bend
// about a joint and the whole plant's bend from its base. The numbers are
// WIND in @gaia/realize, whose `swayAt` is the CPU reference; the gusts it
// answers are `WIND_FIELD_GLSL`.

import { WIND } from "@gaia/realize";
import { WIND_FIELD_GLSL } from "./wind-field.ts";

const f = (x: number): string => x.toFixed(5);

/** The plant's bend, on `WIND_FIELD_GLSL`'s gusts: `jointPhase`, `windPush`, `windBend`, `bendUp` and each level's numbers. */
export const SWAY_GLSL = /* glsl */ `
// A seeded phase from a joint's place, so neighboring boughs never swing in step.
float jointPhase(vec3 j, float seed) {
  return (fract(sin(j.x * 12.9898 + j.y * 78.233 + j.z * 37.719) * 43758.5453) + seed) * 6.28318530718;
}
// One level's push: downwind by its lean, swinging about it, with a little
// bob, as (along the wind, up, across it); its length is the bend's angle
// at the level's reach.
vec3 windPush(vec3 level, float give, float rhythm, float gust, float t, float phase) {
  float a = t * (0.5 + rhythm) * level.z + phase;
  float lean = level.x * (0.25 + 0.75 * gust);
  float swing = level.x * level.y * (0.35 + 0.65 * gust);
  return give * vec3(lean + swing * sin(a), swing * 0.5 * sin(a * 1.13 + phase), swing * 0.4 * sin(a * 1.31 + phase * 1.7));
}
// A push's (along, up, across) laid along a direction over the ground.
vec3 pushAlong(vec3 w, vec2 dir) { return vec3(w.x * dir.x - w.z * dir.y, w.y, w.x * dir.y + w.z * dir.x); }
// Bends p about a joint by a push, keeping its distance from the joint: the
// bend grows with distance up to ${WIND.most} reaches, so a bough curves, never slides.
vec3 windBend(vec3 p, vec3 joint, vec3 push, float reach) {
  vec3 o = p - joint;
  float d = length(o);
  if (d < 1e-4) return p;
  return joint + normalize(o + push * (d * min(d / reach, ${f(WIND.most)}))) * d;
}
// The whole plant bends from its base: each point leans by its height and
// drops to keep its length.
vec3 bendUp(vec3 p, vec3 push, float height) {
  float y = max(p.y, 0.0);
  vec2 u = push.xz * (y * y / max(height, 0.3));
  float drop = y > 1e-4 ? dot(u, u) / (2.0 * y) : 0.0;
  return vec3(p.x + u.x, p.y - drop, p.z + u.y);
}
const vec3 WIND_TRUNK = vec3(${f(WIND.trunk.lean)}, ${f(WIND.trunk.swing)}, ${f(WIND.trunk.rate)});
const vec3 WIND_BOUGH = vec3(${f(WIND.bough.lean)}, ${f(WIND.bough.swing)}, ${f(WIND.bough.rate)});
const vec3 WIND_TWIG = vec3(${f(WIND.twig.lean)}, ${f(WIND.twig.swing)}, ${f(WIND.twig.rate)});
const vec3 WIND_LEAF = vec3(${f(WIND.leaf.lean)}, ${f(WIND.leaf.swing)}, ${f(WIND.leaf.rate)});
const vec3 WIND_REACH = vec3(${f(WIND.bough.reach)}, ${f(WIND.bough.least)}, ${f(WIND.bough.most)});
const vec2 WIND_SMALL = vec2(${f(WIND.twig.reach)}, ${f(WIND.leaf.reach)});
`;

/** The field and the plant's bend together: `WIND_FIELD_GLSL` then `SWAY_GLSL`. */
export const WIND_GLSL = WIND_FIELD_GLSL + SWAY_GLSL;
