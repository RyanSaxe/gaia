// The world around the plants, driven entirely by a WorldLook: a sky dome
// (gradient, hour glow, sun, moon, stars, one parametric cloud shader), painted ground,
// wind-swayed ground cover with wildflowers, and drifting accents.

import * as THREE from "three";
import type { Rgb } from "@gaia/schema";
import { AIR, type WorldLook } from "@gaia/realize";
import { CLEARINGS_GLSL, type Clearing, LIGHT_GLSL, type SceneLight, applySky, createClearings } from "@gaia/render";

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
 * brushed strokes, so where far blades thin out the ground still reads as the
 * same cover. Close by, looking down, the paint is the shaded base of the
 * sward between the blades; farther, where only blade tops show, it takes
 * their colors. `lift` moves the paint from the low color toward the high one.
 * Uses the includer's \`noise(vec2)\` and \`cameraPosition\`.
 */
export const SWARD_GLSL = /* glsl */ `
vec3 sward(vec3 world, vec3 low, vec3 high, vec3 tip, float lift) {
  vec2 q = mat2(0.8, 0.6, -0.6, 0.8) * world.xz;
  float stroke = noise(vec2(q.x * 1.6, q.y * 7.0)) * 0.6 + noise(vec2(q.x * 3.7, q.y * 15.0) + 3.7) * 0.4;
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
uniform float uScale;
uniform float uStretch;
uniform float uThreshold;
uniform float uSoftness;
uniform float uLow;
uniform float uHigh;
uniform float uOpacity;
uniform float uBillow;
uniform float uCells;
uniform float uStand;
uniform float uWind;
uniform vec3 uMoonDisc;
uniform float uMoonSize;
uniform float uMoonPhase;
uniform float uStars;
uniform float uStarRiver;
${NOISE_GLSL}
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
// One layer of stars: a few cells of a grid around the sky hold a star each.
vec3 starLayer(vec3 dir, float scale, float density, float size) {
  vec3 p = dir * scale;
  vec3 cell = floor(p);
  float h = hash3(cell);
  if (h > density) return vec3(0.0);
  vec3 c = vec3(hash3(cell + 1.7), hash3(cell + 3.1), hash3(cell + 5.3)) * 0.6 + 0.2;
  float b = smoothstep(size, size * 0.2, length(fract(p) - c));
  float twinkle = 0.8 + 0.2 * sin(uTime * (0.7 + h * 2.3) + h * 61.0);
  vec3 tint = mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.92, 0.8), hash3(cell + 9.1));
  return tint * b * twinkle * (0.55 + 0.45 * hash3(cell + 7.7));
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

  // Stars come out as the night deepens and thin toward the hazy horizon. A
  // river of stars crosses the sky as a soft band, denser and faintly milky.
  float starsOut = smoothstep(0.4, 0.9, uNightness) * smoothstep(0.02, 0.3, e);
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
  vec3 stars = starLayer(dir, 90.0, uStars * 0.5 + river * 0.3, 0.17);
  stars += starLayer(dir, 170.0, uStars * 0.7 + river * 0.8, 0.16) * 0.6;
  stars += starLayer(dir, 300.0, river * 0.9, 0.2) * 0.35 * (1.0 - lane);
  color += (stars + vec3(0.45, 0.5, 0.74) * milk * 0.45) * starsOut;

  // One parametric cloud layer. Dome clouds use a stereographic projection
  // (stretch draws streaks, cells break the cover into dapples); horizon
  // clouds sample azimuth and elevation, so towers and banks stand on the
  // horizon with ragged tops. An offset sample toward the sun billows the light.
  vec2 wind = vec2(uTime * 0.008, uTime * 0.0025) * (0.4 + uWind);
  vec2 dome = dir.xz / max(e + 0.24, 0.05);
  dome.x /= uStretch;
  float az = atan(dir.x, -dir.z);
  vec2 ring = vec2(az * 6.0, e * 6.5 * uStretch) * uScale;
  vec2 p = mix(dome * uScale, ring, uStand) + wind;
  float n = fbm(p);
  // The horizon projection wraps behind the camera; blend the seam there only.
  float wrapW = smoothstep(0.8, 1.0, (az + 3.14159) / 6.28318) * uStand;
  n = mix(n, fbm(p - vec2(6.28318 * 6.0 * uScale, 0.0)), wrapW);
  float cells = noise(p * 5.0 + 3.0);
  n = mix(n, n * (0.35 + 1.25 * smoothstep(0.25, 0.75, cells)), uCells);
  // Horizon clouds thin with height, so their tops break up into billows.
  n += uStand * (0.06 - smoothstep(uHigh * 0.3, uHigh, e) * 0.28);
  // Dome clouds thin out toward the horizon instead of stopping at a line:
  // fewer and smaller there, and fading over a wide band of sky.
  n -= (1.0 - smoothstep(0.0, 0.22, e)) * 0.08 * (1.0 - uStand);
  float d = smoothstep(uThreshold, uThreshold + uSoftness, n);
  float band = mix(smoothstep(uLow, uLow + 0.14, e) * (1.0 - smoothstep(uHigh - 0.12, uHigh + 0.04, y)), 1.0 - smoothstep(uHigh * 0.8, uHigh * 1.25, e), uStand);
  // Clouds standing on the horizon rise out of its haze.
  d *= band * smoothstep(0.0, mix(0.02, 0.06, uStand), y);
  vec2 sunStep = mix(vec2(flatSun.x / uStretch, flatSun.y), vec2(0.0, 0.5), uStand) * 0.22;
  float n2 = fbm(p + sunStep);
  float lit = clamp(0.62 + (n - n2) * 3.2, 0.0, 1.0);
  float body = smoothstep(uThreshold, uThreshold + uSoftness * 2.5 + 0.12, n);
  float shade = mix(0.82, lit * (0.6 + 0.4 * (1.0 - body * 0.6)), uBillow);
  // Clouds standing on the horizon are lit from above: bright billowed tops,
  // and only their lowest edge cools into shade.
  // Against a glowing low-sun horizon they turn to soft violet silhouettes.
  shade = mix(shade, (0.6 + 0.4 * lit) * (0.82 + 0.18 * smoothstep(0.0, uHigh * 0.3, e)) * (1.0 - uSkyGlowAmount * 0.5), uStand);
  vec3 cloud = mix(uCloudShade, uCloudLit, clamp(shade, 0.0, 1.0));
  // Distant clouds take on the air between, like distant land.
  cloud = mix(cloud, base, (1.0 - smoothstep(0.0, 0.3, e)) * 0.45);
  // Thin cloud edges near the sun light up; at night, near the moon.
  vec3 moon = normalize(uMoonDirection);
  float moonDot = max(dot(dir, moon), 0.0);
  float moonUp = smoothstep(0.15, 0.6, uNightness) * smoothstep(-0.03, 0.03, moon.y);
  cloud += uSunColor * pow(sunDot, 5.0) * (1.0 - d) * 0.22 * sunHigh;
  cloud += uMoonColor * pow(moonDot, 24.0) * (1.0 - d * 0.5) * 0.35 * moonUp;
  color = mix(color, cloud, d * uOpacity);

  // The sun itself: a soft disc with a narrow halo.
  float disc = smoothstep(0.99935, 0.99965, sunDot);
  color = mix(color, mix(uSunColor, vec3(1.0), 0.6), disc * (1.0 - d * uOpacity * 0.85) * sunHigh);

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
  /** The hour's sky, clouds, moon and stars, and the air every distance dissolves into. */
  apply(look: Pick<WorldLook, "light" | "sky" | "fog">): void;
}

export function createSky(light: SceneLight): Sky {
  const u = {
    uCloudLit: { value: new THREE.Vector3() },
    uCloudShade: { value: new THREE.Vector3() },
    uScale: { value: 3 },
    uStretch: { value: 1 },
    uThreshold: { value: 0.6 },
    uSoftness: { value: 0.15 },
    uLow: { value: 0 },
    uHigh: { value: 1 },
    uOpacity: { value: 1 },
    uBillow: { value: 0.5 },
    uCells: { value: 0 },
    uStand: { value: 0 },
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
      u.uScale.value = c.scale;
      u.uStretch.value = c.stretch;
      u.uThreshold.value = c.threshold;
      u.uSoftness.value = c.softness;
      u.uLow.value = c.low;
      u.uHigh.value = c.high;
      u.uOpacity.value = c.opacity;
      u.uBillow.value = c.billow;
      u.uCells.value = c.cells;
      u.uStand.value = c.horizon;
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

/** Ground light: a gentle wrap so a low sun still reads as light, not dusk; at night, the moon and the lantern. */
const GROUND_LIGHT_GLSL = /* glsl */ `
vec3 groundLit(vec3 albedo, vec3 world) {
  float nDotL = clamp(uSunDirection.y * 1.1 + 0.22, 0.0, 1.0);
  float shadow = mix(0.42, 1.0, sunShadow(world, 0.0015));
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
uniform vec4 uSelect;
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
  float d = length(vWorld.xz - uSelect.xy);
  float ring = smoothstep(uSelect.z * 1.04, uSelect.z, d) * smoothstep(uSelect.z * 0.9, uSelect.z, d);
  color = mix(color, vec3(1.0, 0.98, 0.9), ring * 0.4 * uSelect.w);
  gl_FragColor = vec4(aerial(shoulder(color), vWorld), 1.0);
}
`;

export interface Ground {
  readonly mesh: THREE.Mesh;
  select(x: number, z: number, radius: number, on: boolean): void;
  apply(look: WorldLook): void;
}

/** Ground and grass read the mean vitality of what grows on them. */
export interface GroundUniforms {
  readonly uVitality: { value: number };
}

export function createGround(light: SceneLight, shared: GroundUniforms): Ground {
  const select = { value: new THREE.Vector4(0, 0, 1, 0) };
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
    uniforms: { ...light, ...u, uVitality: shared.uVitality, uSelect: select },
  });
  // Out past the distance where land dissolves into the sky, so no edge can show.
  const geometry = new THREE.CircleGeometry(AIR.dissolveEnd + 150, 96);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    select(x, z, radius, on) {
      select.value.set(x, z, radius, on ? 1 : 0);
    },
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

// ---------- ground cover ----------

const GRASS_VERT = /* glsl */ `
${CLEARINGS_GLSL}
uniform float uTime;
uniform float uWind;
uniform float uRadius;
uniform float uHeight;
uniform float uWidth;
uniform float uClump;
uniform float uFlowers;
uniform float uVitality;
attribute vec4 aBlade; // x, z, rotation, height
attribute vec3 aTint; // tint, flower pick, how far out the blade still grows
varying vec3 vWorld;
varying float vT;
varying float vTint;
varying float vFlower;
${NOISE_GLSL}
float windAt(vec2 p, float t) {
  return sin(t * 1.35 + p.x * 0.21 + p.y * 0.17) + 0.35 * sin(t * 2.9 + p.y * 0.43);
}
void main() {
  float t = position.y;
  // Blades keep their full height everywhere: toward the rim of the field
  // each one disappears whole past its own seeded radius, over ground
  // painted in the same colors.
  float keep = step(length(aBlade.xy), uRadius * mix(0.55, 1.0, aTint.z));
  float clump = mix(1.0, tuftMask(aBlade.xy), uClump);
  float flower = step(aTint.y, uFlowers) * smoothstep(0.35, 0.7, uVitality);
  float h = aBlade.w * uHeight * keep * clump * (0.62 + 0.38 * uVitality) * (1.0 + flower * 0.25) * clearing(aBlade.xy);
  float c = cos(aBlade.z);
  float s = sin(aBlade.z);
  // A flower blade opens a small diamond head around its upper vertices.
  float wide = uWidth * keep * (1.0 + flower * 3.2 * step(0.7, t) * step(t, 0.9));
  vec3 local = vec3(position.x * wide * c, t * h, position.x * wide * s);
  float w = windAt(aBlade.xy, uTime * 0.95) + 0.3 * sin(uTime * 3.7 + aBlade.x * 0.7 + aBlade.y * 1.3);
  float bend = uWind * t * t * max(h, 0.15);
  local.x += w * 0.22 * bend;
  local.z += w * 0.12 * bend;
  vec3 world = vec3(aBlade.x, 0.0, aBlade.y) + local;
  vWorld = world;
  vT = t;
  vTint = aTint.x;
  vFlower = flower * (aTint.y / max(uFlowers, 1e-4));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const GRASS_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
${GROUND_LIGHT_GLSL}
uniform vec3 uLow;
uniform vec3 uHigh;
uniform vec3 uTip;
uniform vec3 uDry;
uniform vec3 uFlower0;
uniform vec3 uFlower1;
uniform vec3 uFlower2;
uniform float uFlowers;
uniform float uVitality;
varying vec3 vWorld;
varying float vT;
varying float vTint;
varying float vFlower;
void main() {
  vec3 albedo = mix(uLow, uHigh, clamp(vT * 0.8 + vTint * 0.4, 0.0, 1.0));
  albedo = mix(albedo, uTip, smoothstep(0.55, 1.0, vT) * 0.75);
  albedo = mix(albedo, uDry, max(step(0.94, vTint) * 0.4, (1.0 - uVitality) * 0.7));
  albedo *= 0.82 + 0.25 * vT;
  // Flowers fade into their blades at night, so the dark meadow never reads as confetti.
  if (vFlower > 0.0 && vT > 0.55) {
    albedo = mix(vFlower < 0.4 ? uFlower0 : vFlower < 0.75 ? uFlower1 : uFlower2, albedo, uNightness * 0.75);
  }
  vec3 color = groundLit(albedo, vWorld);
  // Looking toward a low sun, blade tips glow with the light shining through them.
  float toward = clamp(dot(normalize(vWorld - cameraPosition), uSunDirection), 0.0, 1.0);
  color += albedo * uSunColor * pow(toward, 3.0) * vT * 0.45 * (1.0 - smoothstep(0.15, 0.6, uSunDirection.y)) * min(uSunIntensity, 1.0);
  gl_FragColor = vec4(aerial(shoulder(color), vWorld), 1.0);
}
`;

export interface GroundCover {
  readonly mesh: THREE.Mesh;
  apply(look: WorldLook): void;
  /** Where no grass grows, such as under a house and along its walk. */
  clear(list: readonly Clearing[]): void;
}

const MAX_BLADES = 180000;

/** A field of wind-swayed blades that thins out whole toward its rim; a few carry flowers. */
export function createGroundCover(light: SceneLight, shared: GroundUniforms, radius = 60): GroundCover {
  const blade = new THREE.BufferGeometry();
  blade.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -0.7, 0.4, 0, 0.7, 0.4, 0, -0.35, 0.75, 0, 0.35, 0.75, 0, 0, 1, 0], 3),
  );
  blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6]);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = blade.index;
  geometry.setAttribute("position", blade.getAttribute("position"));
  const data = new Float32Array(MAX_BLADES * 4);
  const tint = new Float32Array(MAX_BLADES * 3);
  let seed = 1234567;
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < MAX_BLADES; i++) {
    const r = radius * Math.sqrt(next());
    const a = next() * Math.PI * 2;
    data[i * 4] = Math.cos(a) * r;
    data[i * 4 + 1] = Math.sin(a) * r;
    data[i * 4 + 2] = next() * Math.PI;
    data[i * 4 + 3] = 0.55 + next() * 0.75;
    tint[i * 3] = next();
    tint[i * 3 + 1] = next();
    tint[i * 3 + 2] = next();
  }
  geometry.setAttribute("aBlade", new THREE.InstancedBufferAttribute(data, 4));
  geometry.setAttribute("aTint", new THREE.InstancedBufferAttribute(tint, 3));
  geometry.instanceCount = MAX_BLADES;
  const u = {
    uRadius: { value: radius },
    uHeight: { value: 0.4 },
    uWidth: { value: 0.045 },
    uClump: { value: 0 },
    uFlowers: { value: 0 },
    uLow: { value: new THREE.Vector3() },
    uHigh: { value: new THREE.Vector3() },
    uTip: { value: new THREE.Vector3() },
    uDry: { value: new THREE.Vector3() },
    uFlower0: { value: new THREE.Vector3() },
    uFlower1: { value: new THREE.Vector3() },
    uFlower2: { value: new THREE.Vector3() },
  };
  const clearings = createClearings();
  const material = new THREE.ShaderMaterial({
    vertexShader: GRASS_VERT,
    fragmentShader: GRASS_FRAG,
    uniforms: { ...light, ...u, ...clearings.uniforms, uVitality: shared.uVitality },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    clear: (list) => clearings.set(list),
    apply(look) {
      const g = look.ground;
      geometry.instanceCount = Math.round(MAX_BLADES * g.density);
      u.uHeight.value = g.height;
      u.uWidth.value = g.width;
      u.uClump.value = g.clump;
      u.uFlowers.value = g.flowers;
      u.uLow.value.copy(v3(g.low));
      u.uHigh.value.copy(v3(g.high));
      u.uTip.value.copy(v3(g.tip));
      u.uDry.value.copy(v3(look.groundDecline));
      const f = g.flowerColors;
      u.uFlower0.value.copy(v3(f[0] ?? g.tip));
      u.uFlower1.value.copy(v3(f[1] ?? g.tip));
      u.uFlower2.value.copy(v3(f[2] ?? g.tip));
    },
  };
}

// ---------- drifting accents ----------

const DRIFT_VERT = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uSize;
uniform float uPixels;
uniform float uFall;
uniform float uRise;
uniform float uLow;
uniform float uHigh;
uniform float uWander;
uniform float uHover;
uniform vec3 uBox;
uniform float uCenterZ;
uniform float uHalo;
attribute vec4 aSeed;
varying float vPhase;
varying float vFade;
void main() {
  float phase = aSeed.z;
  float t = uTime;
  float span = uHigh - uLow;
  float y = uLow + mod(aSeed.w * span + t * (uRise - uFall), span);
  y = mix(y, uLow + (0.5 + 0.5 * sin(t * 0.5 + phase * 31.0)) * span, uHover);
  vec2 xz = aSeed.xy + vec2(t * 0.55, t * 0.2) * uWind * (1.0 - uHover * 0.85);
  xz += vec2(sin(t * 1.3 + phase * 17.0), cos(t * 1.1 + phase * 23.0)) * uWander;
  xz = mod(xz + uBox.xz, uBox.xz * 2.0) - uBox.xz;
  vec4 mv = viewMatrix * vec4(xz.x, y, xz.y + uCenterZ, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPixels / max(-mv.z, 0.5) * (1.0 + uHalo * 3.0);
  vPhase = phase;
  float edge = min(uBox.x - abs(xz.x), uBox.z - abs(xz.y));
  vFade = smoothstep(0.0, 2.5, edge) * smoothstep(0.0, 0.6, y - uLow) * smoothstep(0.0, 0.6, uHigh - y);
}
`;

const DRIFT_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform vec3 uMoonColor;
uniform float uMoonIntensity;
uniform float uGlow;
uniform float uShape;
uniform float uBlink;
uniform float uOpacity;
uniform float uHalo;
varying float vPhase;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  // In the dark a glowing mote keeps its small core and gains a soft halo.
  float grow = 1.0 + uHalo * 3.0;
  float a = vPhase * 6.283 + uTime * (0.6 + vPhase);
  float ca = cos(a);
  float sa = sin(a);
  vec2 r = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
  // 0: soft dot, 1: petal, 2: leaf. Petals and leaves tumble, so their width breathes.
  float tumble = 0.35 + 0.65 * abs(sin(uTime * 2.1 + vPhase * 13.0));
  float disc = exp(-dot(c, c) * 28.0 * grow * grow) + exp(-dot(c, c) * 18.0) * uHalo * 0.4;
  float petal = smoothstep(0.5, 0.42, length(vec2(r.x / (0.42 * tumble), r.y / 0.95)) );
  float leaf = smoothstep(0.5, 0.44, length(vec2(r.x / (0.36 * tumble), r.y)) + abs(r.x) * 0.6);
  float shape = uShape < 0.5 ? disc : uShape < 1.5 ? petal : leaf;
  float blink = mix(1.0, smoothstep(0.2, 1.0, sin(uTime * 1.6 + vPhase * 41.0)), uBlink);
  // Lit like everything else, so petals darken at night while glowing things shine.
  vec3 sky = uAmbientColor * uAmbientIntensity * 1.35 + uSunColor * uSunIntensity * 0.46 + uMoonColor * uMoonIntensity * 0.6;
  vec3 lit = uColor * mix(sky, vec3(1.0), uGlow);
  float alpha = shape * vFade * blink * uOpacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(lit * (1.0 + uGlow * 0.6), alpha);
}
`;

interface DriftBehavior {
  shape: number;
  fall: number;
  rise: number;
  low: number;
  high: number;
  wander: number;
  hover: number;
  blink: number;
  opacity: number;
}

const BEHAVIOR: Record<string, DriftBehavior> = {
  petals: { shape: 1, fall: 0.35, rise: 0, low: 0, high: 9, wander: 0.6, hover: 0, blink: 0, opacity: 0.95 },
  fireflies: { shape: 0, fall: 0, rise: 0, low: 0.3, high: 2.6, wander: 0.9, hover: 1, blink: 1, opacity: 1 },
  motes: { shape: 0, fall: 0, rise: 0.05, low: 0.6, high: 8, wander: 0.35, hover: 0.6, blink: 0.3, opacity: 0.7 },
  leaves: { shape: 2, fall: 0.6, rise: 0, low: 0, high: 10, wander: 0.8, hover: 0, blink: 0, opacity: 1 },
  seeds: { shape: 0, fall: 0.05, rise: 0.12, low: 0.4, high: 7, wander: 0.5, hover: 0, blink: 0, opacity: 0.85 },
  pollen: { shape: 0, fall: 0.02, rise: 0.04, low: 0.2, high: 6, wander: 0.25, hover: 0.3, blink: 0, opacity: 0.6 },
};

export interface Drift {
  readonly points: THREE.Points;
  /** Spec of what drifts; null hides it. `daylight` is 0 at dusk and 1 at noon. */
  apply(spec: { form: string; color: Rgb; count: number; size: number; glow: number } | null, daylight: number): void;
  /** How many are visible: vitality gates ambient life. */
  setVitality(v: number): void;
  setPixels(pixels: number): void;
}

const MAX_DRIFT = 900;

export function createDrift(light: SceneLight, seedBase: number): Drift {
  const seeds = new Float32Array(MAX_DRIFT * 4);
  let seed = seedBase >>> 0 || 1;
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // The box spans the trees and the ground up to the camera, so some drift passes close by.
  const box = new THREE.Vector3(26, 0, 30);
  for (let i = 0; i < MAX_DRIFT; i++) {
    seeds[i * 4] = (next() * 2 - 1) * box.x;
    seeds[i * 4 + 1] = (next() * 2 - 1) * box.z;
    seeds[i * 4 + 2] = next();
    seeds[i * 4 + 3] = next();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_DRIFT * 3), 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
  const u = {
    uSize: { value: 0.06 },
    uPixels: { value: 600 },
    uFall: { value: 0 },
    uRise: { value: 0 },
    uLow: { value: 0 },
    uHigh: { value: 5 },
    uWander: { value: 0.5 },
    uHover: { value: 0 },
    uBox: { value: box },
    uCenterZ: { value: 16 },
    uColor: { value: new THREE.Vector3(1, 1, 1) },
    uGlow: { value: 0 },
    uShape: { value: 0 },
    uBlink: { value: 0 },
    uOpacity: { value: 1 },
    uHalo: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: DRIFT_VERT,
    fragmentShader: DRIFT_FRAG,
    uniforms: {
      ...u,
      uTime: light.uTime,
      uWind: light.uWind,
      uSunColor: light.uSunColor,
      uSunIntensity: light.uSunIntensity,
      uAmbientColor: light.uAmbientColor,
      uAmbientIntensity: light.uAmbientIntensity,
      uMoonColor: light.uMoonColor,
      uMoonIntensity: light.uMoonIntensity,
    },
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  let count = 0;
  let vitality = 1;
  const draw = (): void => geometry.setDrawRange(0, Math.round(count * Math.min(1, Math.max(0, (vitality - 0.15) / 0.6))));
  return {
    points,
    apply(spec, daylight) {
      points.visible = spec !== null;
      if (spec === null) return;
      const b = BEHAVIOR[spec.form] ?? BEHAVIOR.motes;
      if (b === undefined) return;
      count = Math.min(MAX_DRIFT, spec.count);
      u.uSize.value = spec.size;
      u.uFall.value = b.fall;
      u.uRise.value = b.rise;
      u.uLow.value = b.low;
      u.uHigh.value = b.high;
      u.uWander.value = b.wander;
      u.uHover.value = b.hover;
      u.uShape.value = b.shape;
      u.uBlink.value = b.blink;
      // Glowing things show by contrast: faint at noon, bright at dusk.
      u.uGlow.value = spec.glow * (0.35 + 0.65 * (1 - daylight));
      u.uOpacity.value = b.opacity * (spec.glow > 0.5 ? 0.45 + 0.55 * (1 - daylight) : 1);
      u.uHalo.value = b.shape === 0 ? spec.glow * (1 - daylight) : 0;
      u.uColor.value.set(spec.color[0], spec.color[1], spec.color[2]);
      draw();
    },
    setVitality(v) {
      vitality = v;
      draw();
    },
    setPixels(pixels) {
      u.uPixels.value = pixels;
    },
  };
}
