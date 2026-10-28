// Renders the sky over every world from a `WorldLook`: a dome with its
// gradient, hour glow, sun, moon, stars and one parametric cloud shader. It
// also renders the flat painted ground under the start page's map table, and
// defines the sward paint that the walked world's ground shares with it.

import * as THREE from "three";
import type { Rgb } from "@gaia/schema";
import { AIR, type WorldLook } from "@gaia/realize";
import { LIGHT_GLSL, type SceneLight, applySky } from "@gaia/render";

const v3 = (c: Rgb): THREE.Vector3 => new THREE.Vector3(c[0], c[1], c[2]);

const NOISE_GLSL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = rot * p * 2.07 + 17.0; a *= 0.5; }
  return v;
}
// Where tufts grow when the cover is clumped; the ground shows soil elsewhere.
float tuftMask(vec2 xz) {
  return smoothstep(0.42, 0.6, fbm(xz * 0.32 + 7.0));
}
`;

/**
 * The ground under grass, painted in the cover's own colors with short
 * brushed strokes, so it still looks like the same cover where distant blades
 * thin out. Up close, looking down, the paint is the shaded base of the sward
 * between the blades. Farther away, where only blade tops show, it takes their
 * colors. `lift` moves the paint from the low color toward the high one. Uses
 * the including shader's \`noise(vec2)\` and \`cameraPosition\`.
 */
export const SWARD_GLSL = /* glsl */ `
float swardDab(vec2 p, mat2 turn) {
  vec2 q = turn * p;
  return noise(vec2(q.x * 2.4, q.y * 5.5)) * 0.6 + noise(vec2(q.x * 5.0, q.y * 11.0) + 3.7) * 0.4;
}
vec3 sward(vec3 world, vec3 low, vec3 high, vec3 tip, float lift) {
  // Short dabs in three directions, crossfaded by a broad field, so no one
  // stroke direction runs on long enough to read as streaks across the land.
  vec2 p = world.xz;
  float a = swardDab(p, mat2(0.8, 0.6, -0.6, 0.8));
  float b = swardDab(p + 31.0, mat2(-0.5, 0.866, -0.866, -0.5));
  float c = swardDab(p - 57.0, mat2(0.259, -0.966, 0.966, 0.259));
  float stroke = mix(mix(a, b, smoothstep(0.3, 0.7, noise(p * 0.23))), c, smoothstep(0.35, 0.75, noise(p * 0.19 + 9.0)) * 0.7);
  stroke = 0.5 + (stroke - 0.5) * 1.3;
  // Only close by, looking down into the sward, does its shaded base show.
  vec3 view = world - cameraPosition;
  float under = (1.0 - smoothstep(0.86, 0.975, 1.0 - abs(normalize(view).y))) * (1.0 - smoothstep(12.0, 40.0, length(view)));
  vec3 base = mix(low, high, clamp(0.25 + lift + (stroke - 0.5) * 0.5, 0.0, 1.0)) * 0.84;
  vec3 tops = mix(mix(low, high, clamp(0.55 + lift + (stroke - 0.5) * 0.5, 0.0, 1.0)), tip, smoothstep(0.55, 0.85, stroke) * 0.25);
  return mix(tops * (0.9 + 0.1 * stroke), base, under);
}
`;

// ---------- sky ----------

const SKY_VERT = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  mat4 viewNoTranslation = mat4(mat3(viewMatrix));
  vec4 clip = projectionMatrix * viewNoTranslation * vec4(position, 1.0);
  gl_Position = clip.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
varying vec3 vDirection;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uCloudGlow;
uniform float uScale;
uniform float uStretch;
uniform float uThreshold;
uniform float uSoftness;
uniform float uLow;
uniform float uHigh;
uniform float uOpacity;
uniform float uBillow;
uniform float uCells;
uniform float uHorizon;
uniform float uWind;
uniform vec3 uMoonDisc;
uniform float uMoonSize;
uniform float uMoonPhase;
uniform float uStars;
uniform float uStarRiver;
${NOISE_GLSL}
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
// One layer of stars: a few cells of a grid around the sky hold a star each.
// As the night deepens (\`dark\` from 0 to 1) the brightest come out first.
vec3 starLayer(vec3 dir, float scale, float density, float size, float dark) {
  vec3 p = dir * scale;
  vec3 cell = floor(p);
  float h = hash3(cell);
  if (h > density) return vec3(0.0);
  vec3 c = vec3(hash3(cell + 1.7), hash3(cell + 3.1), hash3(cell + 5.3)) * 0.6 + 0.2;
  float b = smoothstep(size, size * 0.2, length(fract(p) - c));
  float twinkle = 0.8 + 0.2 * sin(uTime * (0.7 + h * 2.3) + h * 61.0);
  vec3 tint = mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.92, 0.8), hash3(cell + 9.1));
  float bright = hash3(cell + 7.7);
  float comesOut = 0.6 * (1.0 - bright);
  return tint * b * twinkle * (0.55 + 0.45 * bright) * smoothstep(comesOut, comesOut + 0.4, dark);
}
void main() {
  vec3 dir = normalize(vDirection);
  float y = dir.y;
  float e = max(y, 0.0);
  // The same sky every distant surface dissolves into.
  vec3 base = skyColor(dir);
  vec3 color = base;

  vec3 sun = normalize(uSunDirection);
  float sunDot = max(dot(dir, sun), 0.0);
  // The sun's own light in the sky goes out once it is below the horizon.
  float sunHigh = smoothstep(-0.08, 0.02, sun.y);
  vec2 flatSun = normalize(sun.xz + vec2(1e-4));

  // Stars come out as the night deepens, the brightest first, and thin toward
  // the hazy horizon. A river of stars crosses the sky as a soft band, denser
  // and faintly milky.
  float nightFall = smoothstep(0.4, 0.9, uNightness);
  float starsOut = smoothstep(0.02, 0.3, e);
  vec3 bandNormal = normalize(vec3(1.0, 0.62, 0.12));
  float across = dot(dir, bandNormal);
  float along = dot(dir, normalize(vec3(-0.12, 0.0, 1.0)));
  // The band: a soft milky glow with a brighter core, clumped along its
  // length, split by a dark lane of dust, and crowded with faint stars.
  float river = exp(-pow(across / 0.24, 2.0)) * uStarRiver;
  float core = exp(-pow(across / 0.09, 2.0)) * uStarRiver;
  float clumps = 0.35 + 0.65 * fbm(vec2(along * 6.0, across * 14.0) + 2.0);
  float lane = smoothstep(0.5, 0.7, fbm(vec2(along * 4.0 + 7.0, across * 22.0))) * smoothstep(0.08, 0.0, abs(across - 0.02));
  float milk = (river * 0.55 + core * 0.7) * clumps * (1.0 - lane * 0.7);
  vec3 stars = starLayer(dir, 90.0, uStars * 0.5 + river * 0.3, 0.17, nightFall);
  stars += starLayer(dir, 170.0, uStars * 0.7 + river * 0.8, 0.16, nightFall) * 0.6;
  stars += starLayer(dir, 300.0, river * 0.9, 0.2, nightFall) * 0.35 * (1.0 - lane);
  // The milky band reaches lower than single stars, so even a low view
  // looking out across the land sees the river rise from the horizon.
  float milkOut = nightFall * smoothstep(0.0, 0.14, e);
  color += stars * starsOut + vec3(0.45, 0.5, 0.74) * milk * 0.6 * milkOut;

  // One parametric cloud layer. Dome clouds use a stereographic projection
  // (stretch draws streaks, cells break the cover into dapples); horizon
  // clouds sample azimuth and elevation, so towers and banks stand on the
  // horizon with ragged tops. An offset sample toward the sun billows the light.
  vec2 wind = vec2(uTime * 0.008, uTime * 0.0025) * (0.4 + uWind);
  vec2 dome = dir.xz / max(e + 0.24, 0.05);
  dome.x /= uStretch;
  float az = atan(dir.x, -dir.z);
  vec2 ring = vec2(az * 6.0, e * 6.5 * uStretch) * uScale;
  vec2 p = mix(dome * uScale, ring, uHorizon) + wind;
  float n = fbm(p);
  // The horizon projection wraps behind the camera; blend the seam there only.
  float wrapW = smoothstep(0.8, 1.0, (az + 3.14159) / 6.28318) * uHorizon;
  n = mix(n, fbm(p - vec2(6.28318 * 6.0 * uScale, 0.0)), wrapW);
  float cells = noise(p * 5.0 + 3.0);
  n = mix(n, n * (0.35 + 1.25 * smoothstep(0.25, 0.75, cells)), uCells);
  // Horizon clouds stand in columns: each bearing has its own height, so
  // towers rise with clear sky between them and banks run long and low.
  // Sampled around a circle, so the columns wrap without a seam.
  vec2 around = vec2(cos(az), sin(az)) * max(1.4, 1.9 * uScale / sqrt(uStretch)) + vec2(wind.x * 0.4, 7.5);
  float column = noise(around) * 0.7 + noise(around * 2.3 + 4.0) * 0.3;
  float top = uHigh * smoothstep(uThreshold - 0.32, uThreshold + 0.08, column);
  float rise = clamp(e / max(top, 1e-3), 0.0, 1.5);
  // Full at the foot, thinning upward, so the top breaks up into billows.
  n += uHorizon * (0.36 - rise * 0.5);
  // Dome clouds thin out toward the horizon instead of stopping at a line:
  // fewer and smaller there, and fading over a wide band of sky.
  n -= (1.0 - smoothstep(0.0, 0.22, e)) * 0.08 * (1.0 - uHorizon);
  float d = smoothstep(uThreshold, uThreshold + uSoftness, n);
  float band = mix(smoothstep(uLow, uLow + 0.14, e) * (1.0 - smoothstep(uHigh - 0.12, uHigh + 0.04, y)), 1.0 - smoothstep(uHigh * 0.8, uHigh * 1.25, e), uHorizon);
  // Clouds standing on the horizon rise out of its haze.
  d *= band * smoothstep(0.0, mix(0.02, 0.06, uHorizon), y);
  vec2 sunStep = mix(vec2(flatSun.x / uStretch, flatSun.y), vec2(0.0, 0.5), uHorizon) * 0.22;
  float n2 = fbm(p + sunStep);
  float lit = clamp(0.62 + (n - n2) * 3.2, 0.0, 1.0);
  float body = smoothstep(uThreshold, uThreshold + uSoftness * 2.5 + 0.12, n);
  float shade = mix(0.82, lit * (0.6 + 0.4 * (1.0 - body * 0.6)), uBillow);
  // Clouds standing on the horizon are lit from above: bright billowed tops,
  // and only their lowest edge cools into shade.
  // Against a glowing low-sun horizon they turn to soft violet silhouettes.
  shade = mix(shade, (0.6 + 0.4 * lit) * (0.8 + 0.22 * smoothstep(0.0, 0.7, rise)) * (1.0 - uSkyGlowAmount * 0.5), uHorizon);
  vec3 cloud = mix(uCloudShade, uCloudLit, clamp(shade, 0.0, 1.0));
  // A low sun lights clouds from beneath and on the edges facing it, in its
  // deepened glow, the clouds toward it most. Once it has set, the earth's
  // shadow climbs the sky: low clouds go grey first, high ones hold the glow.
  float toward = dot(normalize(dir.xz + vec2(1e-4)), flatSun) * 0.5 + 0.5;
  float held = smoothstep(-0.04 - 0.16 * e, 0.0, sun.y);
  float catches = twilight() * (0.45 + 0.55 * toward * toward) * held;
  float rim = smoothstep(0.5, 0.95, lit);
  cloud = mix(cloud, uCloudGlow * (0.75 + 0.4 * lit), catches * clamp(rim * 0.85 + (1.0 - body) * 0.4, 0.0, 1.0) * 0.85);
  // Distant clouds take on the air between, like distant land.
  cloud = mix(cloud, base, (1.0 - smoothstep(0.0, 0.3, e)) * 0.45);
  // Thin cloud edges near the sun light up; at night, near the moon.
  vec3 moon = normalize(uMoonDirection);
  float moonDot = max(dot(dir, moon), 0.0);
  float moonUp = smoothstep(0.15, 0.6, uNightness) * smoothstep(-0.03, 0.03, moon.y);
  cloud += uSunColor * pow(sunDot, 5.0) * (1.0 - d) * 0.22 * sunHigh;
  cloud += uMoonColor * pow(moonDot, 24.0) * (1.0 - d * 0.5) * 0.35 * moonUp;
  color = mix(color, cloud, d * uOpacity);

  // The sun itself: a soft disc with a narrow halo, always brighter than the
  // glow around it.
  float disc = smoothstep(0.99935, 0.99965, sunDot);
  color = mix(color, max(mix(uSunColor, vec3(1.0), 0.6), color + 0.12), disc * (1.0 - d * uOpacity * 0.85) * sunHigh);

  // The moon: a soft disc with faint maria, a crescent's dark part a shade
  // above the sky, and a wide pale halo.
  vec3 right = normalize(cross(moon, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 upward = cross(right, moon);
  vec2 q = vec2(dot(dir, right), dot(dir, upward)) / uMoonSize;
  float r = length(q);
  float face = step(0.0, dot(dir, moon));
  float moonDisc = smoothstep(1.0, 0.9, r) * face;
  float slide = mix(0.45, 2.3, uMoonPhase);
  float dark = smoothstep(1.02, 0.9, length(q - vec2(-slide, slide * 0.35)));
  float maria = smoothstep(0.45, 0.75, noise(q * 1.6 + 4.0));
  vec3 face3 = uMoonDisc * (1.0 - maria * 0.13);
  float clear = 1.0 - d * uOpacity * 0.8;
  color = mix(color, mix(face3, color * 1.15 + uMoonDisc * 0.04, dark), moonDisc * moonUp * clear);
  float halo = exp(-max(r - 1.0, 0.0) * 0.45) * (1.0 - moonDisc) * 0.16 + exp(-r * 0.06) * 0.05;
  color += uMoonColor * halo * moonUp * mix(0.35, 1.0, uMoonPhase) * clear;
  gl_FragColor = vec4(color, 1.0);
}
`;

export interface Sky {
  readonly mesh: THREE.Mesh;
  /** Applies the hour's sky, clouds, moon and stars, and the fog that distant land fades into. */
  apply(look: Pick<WorldLook, "light" | "sky" | "fog">): void;
}

export function createSky(light: SceneLight): Sky {
  const u = {
    uCloudLit: { value: new THREE.Vector3() },
    uCloudShade: { value: new THREE.Vector3() },
    uCloudGlow: { value: new THREE.Vector3() },
    uScale: { value: 3 },
    uStretch: { value: 1 },
    uThreshold: { value: 0.6 },
    uSoftness: { value: 0.15 },
    uLow: { value: 0 },
    uHigh: { value: 1 },
    uOpacity: { value: 1 },
    uBillow: { value: 0.5 },
    uCells: { value: 0 },
    uHorizon: { value: 0 },
    uMoonDisc: { value: new THREE.Vector3(1, 1, 1) },
    uMoonSize: { value: 0.026 },
    uMoonPhase: { value: 1 },
    uStars: { value: 0.5 },
    uStarRiver: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: { ...light, ...u },
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    apply(look) {
      applySky(light, look);
      const s = look.sky;
      const c = s.clouds;
      u.uCloudLit.value.copy(v3(s.cloudLit));
      u.uCloudShade.value.copy(v3(s.cloudShade));
      u.uCloudGlow.value.copy(v3(s.cloudGlow));
      u.uScale.value = c.scale;
      u.uStretch.value = c.stretch;
      u.uThreshold.value = c.threshold;
      u.uSoftness.value = c.softness;
      u.uLow.value = c.low;
      u.uHigh.value = c.high;
      u.uOpacity.value = c.opacity;
      u.uBillow.value = c.billow;
      u.uCells.value = c.cells;
      u.uHorizon.value = c.horizon;
      u.uMoonDisc.value.copy(v3(s.moon.color));
      u.uMoonSize.value = s.moon.size;
      u.uMoonPhase.value = s.moon.phase;
      u.uStars.value = s.stars.density;
      u.uStarRiver.value = s.stars.river;
    },
  };
}

// ---------- ground ----------

const GROUND_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Ground lighting with a gentle wrap, so a low sun still looks like daylight, not dusk. At night the moon and the lantern light it. */
const GROUND_LIGHT_GLSL = /* glsl */ `
vec3 groundLit(vec3 albedo, vec3 world) {
  float nDotL = clamp(uSunDirection.y * 1.1 + 0.22, 0.0, 1.0);
  float shadow = mix(0.42, 1.0, sunShadow(world, vec3(0.0, 1.0, 0.0), 0.0015));
  float light = softCel(nDotL * shadow) * sunUp();
  vec3 toned = nightTone(albedo);
  vec3 lit = toned * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = toned * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.35, 0.0, 1.0));
  return color + nightLight(albedo, vec3(0.0, 1.0, 0.0), world, 0.45, mix(1.0, shadow, uMoonShadow));
}
`;

const GROUND_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
${NOISE_GLSL}
${GROUND_LIGHT_GLSL}
${SWARD_GLSL}
uniform vec3 uSoil;
uniform vec3 uLow;
uniform vec3 uHigh;
uniform vec3 uTip;
uniform vec3 uDry;
uniform float uClump;
uniform float uVitality;
varying vec3 vWorld;
void main() {
  float broad = fbm(vWorld.xz * 0.05);
  float fine = fbm(vWorld.xz * 0.6);
  vec3 grass = sward(vWorld, uLow, uHigh, uTip, (broad - 0.5) * 0.6);
  vec3 albedo = mix(uSoil, grass, mix(1.0, tuftMask(vWorld.xz) * 0.75, uClump));
  albedo = mix(albedo, uSoil, smoothstep(0.66, 0.82, fbm(vWorld.xz * 0.09 + 40.0)) * 0.3);
  albedo = mix(albedo, uDry, (1.0 - uVitality) * 0.55);
  albedo *= 0.95 + 0.08 * fine;
  vec3 color = groundLit(albedo, vWorld);
  gl_FragColor = vec4(aerial(shoulder(color), vWorld), 1.0);
}
`;

export interface Ground {
  readonly mesh: THREE.Mesh;
  apply(look: WorldLook): void;
}

/** The ground's uniforms. `uVitality` is the mean vitality of what grows on it. */
export interface GroundUniforms {
  readonly uVitality: { value: number };
}

export function createGround(light: SceneLight, shared: GroundUniforms): Ground {
  const u = {
    uSoil: { value: new THREE.Vector3() },
    uLow: { value: new THREE.Vector3() },
    uHigh: { value: new THREE.Vector3() },
    uTip: { value: new THREE.Vector3() },
    uDry: { value: new THREE.Vector3() },
    uClump: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    uniforms: { ...light, ...u, uVitality: shared.uVitality },
  });
  // Extends 150 m past `AIR.dissolveEnd`, where land fades into the sky, so no edge can show.
  const geometry = new THREE.CircleGeometry(AIR.dissolveEnd + 150, 96);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    apply(look) {
      const g = look.ground;
      u.uSoil.value.copy(v3(g.soil));
      u.uLow.value.copy(v3(g.low));
      u.uHigh.value.copy(v3(g.high));
      u.uTip.value.copy(v3(g.tip));
      u.uDry.value.copy(v3(look.groundDecline));
      u.uClump.value = g.clump;
    },
  };
}
