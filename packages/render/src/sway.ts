// How a plant answers the wind field, in GLSL: each level's lean, the turn
// about a joint, a leaf's turn on its stalk and the whole plant's bend from
// its base. The numbers are WIND in @gaia/realize, whose `swayAt` is the CPU
// reference; the gusts it answers are `WIND_FIELD_GLSL`.

import { STIFF, WIND, type WindLevel } from "@gaia/realize";
import { WIND_FIELD_GLSL } from "./wind-field.ts";

const f = (x: number): string => x.toFixed(5);
const level = (l: WindLevel): string => `vec4(${f(l.lean)}, ${f(l.swing)}, ${f(l.rate)}, ${f(l.most)})`;

/** The plant's bend, on `WIND_FIELD_GLSL`'s gusts: `jointPhase`, `trunkGive`, `windLean`, `windBendAt`, `windFlutter`, `windStiff`, `bendUp` and each level's numbers. */
export const SWAY_GLSL = /* glsl */ `
const vec4 WIND_TRUNK = ${level(WIND.trunk)};
const vec4 WIND_BOUGH = ${level(WIND.bough)};
const vec4 WIND_TWIG = ${level(WIND.twig)};
const vec4 WIND_LEAF = ${level(WIND.leaf)};
const vec3 WIND_REACH = vec3(${f(WIND.bough.reach)}, ${f(WIND.bough.least)}, ${f(WIND.bough.longest)});
const vec2 WIND_SMALL = vec2(${f(WIND.twig.reach)}, ${f(WIND.leaf.reach)});
const vec3 WIND_BUILD = vec3(${f(WIND.build.height)}, ${f(WIND.build.least)}, ${f(WIND.build.most)});
// A seeded phase from a joint's place, so neighboring boughs never swing in step.
float jointPhase(vec3 j, float seed) {
  return (fract(sin(j.x * 12.9898 + j.y * 78.233 + j.z * 37.719) * 43758.5453) + seed) * 6.28318530718;
}
// How much a plant this tall gives at its trunk: a taller plant is thicker, so it leans less.
float trunkGive(float height) {
  return clamp(sqrt(WIND_BUILD.x / max(height, 0.3)), WIND_BUILD.y, WIND_BUILD.z);
}
// Eases an angle toward most, never past it.
float windEase(float a, float most) { return most * tanh(a / most); }
// One level's turn at a joint, over the ground along dir: its length is the
// angle, downwind by its lean and swinging about it; fade scales the swing
// and lag delays it.
vec2 windLean(vec4 level, float give, float rhythm, float gust, float t, float phase, float fade, float lag, vec2 dir) {
  float a = t * (0.5 + rhythm) * level.z + phase - lag;
  float lean = level.x * (0.25 + 0.75 * gust);
  float swing = level.x * level.y * (0.35 + 0.65 * gust) * fade;
  float along = give * (lean + swing * sin(a));
  float across = give * swing * 0.4 * sin(a * 1.31 + phase * 1.7);
  vec2 w = vec2(along * dir.x - across * dir.y, along * dir.y + across * dir.x);
  float l = length(w);
  return l > 1e-9 ? w * (windEase(l, level.w) / l) : vec2(0.0);
}
// Turns p about the unit axis k through j, keeping its distance from j.
vec3 turnAbout(vec3 p, vec3 j, vec3 k, float angle) {
  vec3 v = p - j;
  float c = cos(angle);
  return j + v * c + cross(k, v) * sin(angle) + k * dot(k, v) * (1.0 - c);
}
// Bends p about a joint: one axis for the whole joint, square to its lean,
// and an angle that grows from the joint over ${WIND.grow} reaches. Past that a
// hanging piece swings less and trails, so it sways rather than whips.
vec3 windBendAt(vec3 p, vec3 joint, vec4 level, float give, float rhythm, float gust, float t, float phase, float reach, vec2 dir) {
  float d = distance(p, joint);
  if (d < 1e-4) return p;
  float full = reach * ${f(WIND.grow)};
  float x = 1.0 - min(d / full, 1.0);
  vec2 l = windLean(level, give, rhythm, gust, t, phase, full / max(d, full), max(0.0, d - full) * ${f(WIND.trail)}, dir);
  float angle = length(l);
  if (angle < 1e-7) return p;
  return turnAbout(p, joint, vec3(l.y, 0.0, -l.x) / angle, angle * (1.0 - x * x));
}
// A leaf or flower turns as one about its foot (its pivot), only in a gust:
// it nods across its stalk and the wind and twists about the stalk, by a mix
// its own. Past the leaf's reach it turns less, so a long strand only rustles.
vec3 windFlutter(vec3 p, vec3 pivot, vec3 twig, float give, float rhythm, float gust, float t, float phase, vec2 dir) {
  vec3 st = pivot - twig;
  float sl = length(st);
  vec3 s = sl > 1e-3 ? st / sl : vec3(0.0, 1.0, 0.0);
  vec3 w = vec3(dir.x, 0.0, dir.y);
  vec3 n = cross(s, w);
  float nl = length(n);
  n = nl < 1e-3 ? vec3(w.z, 0.0, -w.x) : n / nl;
  vec3 axis = normalize(n * cos(phase * 1.7) + s * sin(phase * 1.7));
  float amp = windEase(give * WIND_LEAF.y * gust * gust * sin(t * (0.5 + rhythm) * WIND_LEAF.z + phase), WIND_LEAF.w);
  return turnAbout(p, pivot, axis, amp * min(1.0, WIND_SMALL.y / max(distance(p, pivot), 1e-4)));
}
// Cuts too stiff to flutter (STIFF in @gaia/realize).
bool windStiff(float cut) {
  float c = floor(cut);
  return ${[...STIFF].map((c) => `abs(c - ${c.toFixed(1)}) < 0.5`).join(" || ")};
}
// The whole plant bends from its base: each point leans by its height and
// drops to keep its length.
vec3 bendUp(vec3 p, vec2 lean, float height) {
  float y = max(p.y, 0.0);
  vec2 u = lean * (y * y / max(height, 0.3));
  float drop = y > 1e-4 ? dot(u, u) / (2.0 * y) : 0.0;
  return vec3(p.x + u.x, p.y - drop, p.z + u.y);
}
`;

/** The field and the plant's bend together: `WIND_FIELD_GLSL` then `SWAY_GLSL`. */
export const WIND_GLSL = WIND_FIELD_GLSL + SWAY_GLSL;
