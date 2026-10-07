// Scene-wide light, shared by reference with every material: one write per
// frame, every shader sees it. Values follow v2's ghibli-default style pack.

import * as THREE from "three";
import type { LightSpec } from "@gaia/schema";
import { AIR, type AirInput } from "@gaia/realize";

export interface SceneLight {
  readonly uSunDirection: { value: THREE.Vector3 };
  readonly uSunColor: { value: THREE.Vector3 };
  readonly uSunIntensity: { value: number };
  readonly uAmbientColor: { value: THREE.Vector3 };
  readonly uAmbientIntensity: { value: number };
  readonly uShadowColor: { value: THREE.Vector3 };
  readonly uCelBands: { value: number };
  readonly uCelSoftness: { value: number };
  readonly uFogColor: { value: THREE.Vector3 };
  readonly uFogDensity: { value: number };
  readonly uTime: { value: number };
  /** Low-lying mist near the ground, 0 to 1. */
  readonly uMist: { value: number };
  /** Multiplies every sway; the world's wind, 1 by default. */
  readonly uWind: { value: number };
  readonly uShadowMatrix: { value: THREE.Matrix4 };
  readonly uShadowMap: { value: THREE.Texture | null };
  readonly uShadowTexel: { value: number };
  readonly uMoonDirection: { value: THREE.Vector3 };
  readonly uMoonColor: { value: THREE.Vector3 };
  readonly uMoonIntensity: { value: number };
  /** 0 by day, 1 in deep night. */
  readonly uNightness: { value: number };
  /** The lantern the person carries: where it hangs, its color, and its strength (0 by day). */
  readonly uLanternPosition: { value: THREE.Vector3 };
  readonly uLanternColor: { value: THREE.Vector3 };
  readonly uLanternIntensity: { value: number };
  /** How strongly the shadow map darkens moonlight: 0 while the map follows the sun. */
  readonly uMoonShadow: { value: number };
  /** The sky's gradient and the hour's horizon glow, read by `skyColor()` in the dome and in `aerial()`. */
  readonly uSkyZenith: { value: THREE.Vector3 };
  readonly uSkyMid: { value: THREE.Vector3 };
  readonly uSkyHorizon: { value: THREE.Vector3 };
  readonly uSkyGlow: { value: THREE.Vector3 };
  readonly uSkyGlowAmount: { value: number };
  /** Where the person's eyes are. Every pass thins distant detail from here, so shadows and the mirror agree with the view. */
  readonly uEye: { value: THREE.Vector3 };
}

/** The lantern's warm pool: about 12 m across, fading smoothly to nothing by `LANTERN.reach`. */
export const LANTERN = {
  /** Candle orange: little green, so on green grass the pool reads warm, not yellow-olive. */
  color: 0xff6a2a,
  /** Strength at full night. */
  intensity: 2.4,
  /** Distance in meters where its light reaches zero. */
  reach: 7.5,
  /** Carried at hand height (eye height less this), a little ahead and to the right, in meters. */
  drop: 0.75,
  ahead: 0.6,
  side: 0.28,
  /** Nightness over which the lantern fades in through dusk. */
  fadeIn: [0.25, 0.75],
  /** Sway while walking: meters side to side and up and down, and strides per meter walked. */
  sway: 0.07,
  bob: 0.025,
  stride: 0.75,
} as const;

const EYE = 1.6;
const smooth = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Writes one hour's light into the shared uniforms; the lantern's strength follows the night. */
export function applyLight(light: SceneLight, l: LightSpec): void {
  light.uSunDirection.value.set(...l.sunDirection).normalize();
  light.uSunColor.value.set(...l.sunColor);
  light.uSunIntensity.value = l.sunIntensity;
  light.uAmbientColor.value.set(...l.ambientColor);
  light.uAmbientIntensity.value = l.ambientIntensity;
  light.uShadowColor.value.set(...l.shadowColor);
  light.uCelBands.value = l.celBands;
  light.uCelSoftness.value = l.celSoftness;
  light.uMoonDirection.value.set(...l.moonDirection).normalize();
  light.uMoonColor.value.set(...l.moonColor);
  light.uMoonIntensity.value = l.moonIntensity;
  light.uNightness.value = l.nightness;
  light.uLanternIntensity.value = LANTERN.intensity * smooth(LANTERN.fadeIn[0], LANTERN.fadeIn[1], l.nightness);
}

/**
 * Writes the hour's sky and the local air into the shared uniforms, so the
 * dome and every distant surface take their color from the same sky.
 */
export function applySky(light: SceneLight, look: AirInput): void {
  light.uSkyZenith.value.set(...look.sky.zenith);
  light.uSkyMid.value.set(...look.sky.mid);
  light.uSkyHorizon.value.set(...look.sky.horizon);
  light.uSkyGlow.value.set(...look.light.horizonGlow);
  light.uSkyGlowAmount.value = look.light.glow;
  light.uFogColor.value.set(...look.fog.color);
  light.uFogDensity.value = look.fog.density;
  light.uMist.value = look.fog.mist;
}

export interface Lantern {
  /**
   * Hangs the lantern from the person at `eye` facing `forward`, over ground
   * at `ground`. `walked` is the distance moved since the last frame; the
   * lantern sways with each stride and settles when the person stops.
   */
  follow(eye: THREE.Vector3, forward: THREE.Vector3, ground: number, walked: number, dt: number): void;
}

export function createLantern(light: SceneLight): Lantern {
  let phase = 0;
  let swing = 0;
  const flat = new THREE.Vector3();
  return {
    follow(eye, forward, ground, walked, dt) {
      phase += (walked / LANTERN.stride) * Math.PI;
      const moving = dt > 0 ? Math.min(1, walked / dt / 4) : 0;
      swing += (moving - swing) * (1 - Math.exp(-dt * 3));
      flat.set(forward.x, 0, forward.z);
      if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
      flat.normalize();
      const side = LANTERN.side + Math.sin(phase) * LANTERN.sway * swing;
      const y = ground + EYE - LANTERN.drop + Math.cos(phase * 2) * LANTERN.bob * swing;
      light.uLanternPosition.value.set(eye.x + flat.x * LANTERN.ahead - flat.z * side, y, eye.z + flat.z * LANTERN.ahead + flat.x * side);
    },
  };
}

export const hexToVec3 = (hex: number): THREE.Vector3 =>
  new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

export function createSceneLight(): SceneLight {
  return {
    uSunDirection: { value: new THREE.Vector3(0.45, 0.62, 0.3).normalize() },
    uSunColor: { value: hexToVec3(0xffe08c) },
    uSunIntensity: { value: 1.24 },
    uAmbientColor: { value: hexToVec3(0xb2cbe2) },
    uAmbientIntensity: { value: 0.52 },
    uShadowColor: { value: hexToVec3(0x7386a5) },
    uCelBands: { value: 4 },
    uCelSoftness: { value: 0.2 },
    uFogColor: { value: hexToVec3(0xa9cde8) },
    uFogDensity: { value: 0.006 },
    uTime: { value: 0 },
    uMist: { value: 0 },
    uWind: { value: 1 },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMap: { value: null },
    uShadowTexel: { value: 1 / 2048 },
    uMoonDirection: { value: new THREE.Vector3(0, 1, 0) },
    uMoonColor: { value: new THREE.Vector3(0.66, 0.74, 0.9) },
    uMoonIntensity: { value: 0 },
    uNightness: { value: 0 },
    uLanternPosition: { value: new THREE.Vector3(0, -1000, 0) },
    uLanternColor: { value: hexToVec3(LANTERN.color) },
    uLanternIntensity: { value: 0 },
    uMoonShadow: { value: 0 },
    uSkyZenith: { value: hexToVec3(0x6aa5e3) },
    uSkyMid: { value: hexToVec3(0x9cc6ea) },
    uSkyHorizon: { value: hexToVec3(0xcfe6f2) },
    uSkyGlow: { value: hexToVec3(0xffffff) },
    uSkyGlowAmount: { value: 0 },
    uEye: { value: new THREE.Vector3() },
  };
}

const f1 = (x: number): string => x.toFixed(1);

export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform vec3 uShadowColor;
uniform float uCelBands;
uniform float uCelSoftness;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uMist;
uniform mat4 uShadowMatrix;
uniform sampler2D uShadowMap;
uniform float uShadowTexel;
uniform vec3 uMoonDirection;
uniform vec3 uMoonColor;
uniform float uMoonIntensity;
uniform float uNightness;
uniform vec3 uLanternPosition;
uniform vec3 uLanternColor;
uniform float uLanternIntensity;
uniform float uMoonShadow;
uniform vec3 uSkyZenith;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
uniform float uSkyGlowAmount;

float softCel(float x) {
  float scaled = clamp(x, 0.0, 1.0) * uCelBands;
  float band = floor(scaled);
  float f = scaled - band;
  float soft = smoothstep(0.5 - uCelSoftness, 0.5 + uCelSoftness, f);
  return clamp((band + soft) / uCelBands, 0.0, 1.0);
}

// Lit fraction from the hand-rolled sun shadow map, 3x3 PCF. Shadows
// suggest, never shout: the floor keeps them soft washes.
float sunShadow(vec3 worldPosition, float bias) {
  vec4 c4 = uShadowMatrix * vec4(worldPosition, 1.0);
  vec3 c = c4.xyz / c4.w * 0.5 + 0.5;
  if (c.x < 0.01 || c.x > 0.99 || c.y < 0.01 || c.y > 0.99 || c.z > 1.0) return 1.0;
  float lit = 0.0;
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      float depth = texture2D(uShadowMap, c.xy + vec2(float(dx), float(dy)) * uShadowTexel * 2.2).r;
      lit += c.z - bias <= depth ? 1.0 : 0.0;
    }
  }
  return lit / 9.0;
}

// Highlights roll off instead of clipping, so pale blossoms keep their form in full sun.
vec3 shoulder(vec3 c) {
  return c / (1.0 + max(c - 0.75, 0.0) * 0.9);
}

// ---------- night ----------
// By day every term below is zero. At night the hour's ambient and shadow
// colors are the floor (cool blue, never black); these add the moon as a dim
// soft-cel key and the lantern's warm pool. \`wrap\` softens the terminator:
// 0 for solid surfaces, up to 1 for leaves and blades that scatter light.

// The eye loses color at night: hues fade halfway toward a cool grey under
// the moon, so warm palettes stay warm instead of going muddy.
vec3 nightTone(vec3 albedo) {
  float luma = dot(albedo, vec3(0.299, 0.587, 0.114));
  return mix(albedo, vec3(luma) * vec3(0.92, 0.98, 1.08), uNightness * 0.5);
}

// How much the sun's own terms count: 1 by day, 0 once it has set, so the
// day's light-and-shadow split never runs off a sun below the horizon.
float sunUp() {
  return smoothstep(0.0, 0.3, uSunIntensity);
}

vec3 moonLight(vec3 albedo, vec3 n, float wrap, float shadow) {
  float d = dot(n, uMoonDirection);
  float lambert = mix(max(d, 0.0), d * 0.5 + 0.5, wrap);
  return nightTone(albedo) * uMoonColor * uMoonIntensity * softCel(lambert * shadow);
}

// The lantern's pool: brightest under it, fading smoothly to nothing at
// LANTERN.reach, with no hard edge anywhere. Colors come back inside it.
float lanternReach(vec3 worldPosition) {
  float d = length(uLanternPosition - worldPosition);
  float k = clamp(1.0 - (d * d) / (${LANTERN.reach.toFixed(2)} * ${LANTERN.reach.toFixed(2)}), 0.0, 1.0);
  return k * k / (1.0 + d * 0.12);
}

vec3 lanternLight(vec3 albedo, vec3 n, vec3 worldPosition, float wrap) {
  if (uLanternIntensity <= 0.0) return vec3(0.0);
  vec3 toL = uLanternPosition - worldPosition;
  float d = max(length(toL), 1e-3);
  float facing = dot(n, toL / d);
  float lambert = mix(max(facing, 0.0), facing * 0.5 + 0.5, wrap);
  return albedo * uLanternColor * uLanternIntensity * lanternReach(worldPosition) * lambert;
}

vec3 nightLight(vec3 albedo, vec3 n, vec3 worldPosition, float wrap, float shadow) {
  return moonLight(albedo, n, wrap, shadow) + lanternLight(albedo, n, worldPosition, wrap);
}

// ---------- sky and distance ----------
// skyColorAt and aerialAt in @gaia/realize are the CPU references.

// The sky's color along a view direction: the gradient from horizon to
// zenith, the hour's glow on the sun's side, the haze around the sun, and
// low mist along the horizon.
// Below the horizon it holds the horizon's color. The dome draws clouds,
// stars and the moon on top; distant land dissolves into exactly this.
vec3 skyColor(vec3 dir) {
  float e = max(dir.y, 0.0);
  vec3 color = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.32, e));
  color = mix(color, uSkyZenith, smoothstep(0.28, 0.9, e));
  vec3 sun = normalize(uSunDirection);
  float up = smoothstep(-0.08, 0.02, sun.y);
  vec2 flatDir = normalize(dir.xz + vec2(1e-4));
  vec2 flatSun = normalize(sun.xz + vec2(1e-4));
  float toward = dot(flatDir, flatSun) * 0.5 + 0.5;
  color = mix(color, uSkyGlow, exp(-e * 5.0) * (0.35 + 0.65 * toward * toward) * uSkyGlowAmount * 0.75);
  float sunDot = max(dot(dir, sun), 0.0);
  color = mix(color, uSunColor, pow(sunDot, 10.0) * 0.28 * up);
  color += uSunColor * pow(sunDot, 180.0) * 0.18 * up;
  // Low mist lies along the horizon: the air's own color rises into the
  // lowest sky and thins upward, veiling even a low sun's haze, so misty
  // land meets the sky in a soft band.
  return mix(color, uFogColor, clamp(uMist * ${AIR.mistGain.toFixed(2)}, 0.0, 1.0) * (1.0 - smoothstep(${AIR.mistRise[0].toFixed(2)}, ${AIR.mistRise[1].toFixed(2)}, e)) * ${AIR.mistSky.toFixed(2)});
}

// Near and middle distance haze toward the local air's tint, lit by the sky
// behind it; farther, toward
// the sky behind along the same ray; by ${AIR.dissolveEnd} m only the sky remains.
vec3 aerial(vec3 color, vec3 worldPosition) {
  vec3 ray = worldPosition - cameraPosition;
  float dist = length(ray);
  vec3 sky = skyColor(ray / max(dist, 1e-4));
  // Rays that skim the land pass through the most air: far ground just below
  // the horizon thickens toward the sky over a band, not at a line.
  float skim = exp(-abs(ray.y) / max(dist, 1e-4) * ${f1(AIR.skim)}) * smoothstep(${f1(AIR.skimFrom[0])}, ${f1(AIR.skimFrom[1])}, dist);
  vec3 air = mix(sky, uFogColor, ${AIR.tint.toFixed(2)} * (1.0 - smoothstep(${f1(AIR.tintFade[0])}, ${f1(AIR.tintFade[1])}, dist)) * (1.0 - skim));
  float haze = (1.0 - exp(-dist * uFogDensity)) * (0.65 + 0.35 * smoothstep(150.0, ${f1(AIR.hazeFull)}, dist));
  haze += (1.0 - haze) * skim;
  // Mist lies low: thickest at the ground, gone a few units up, and only with distance.
  float mist = uMist * exp(-max(worldPosition.y, 0.0) * 0.45) * (1.0 - exp(-dist * 0.035));
  color = mix(color, air, clamp(haze + mist * 0.7, 0.0, 1.0));
  return mix(color, sky, smoothstep(${f1(AIR.dissolveStart)}, ${f1(AIR.dissolveEnd)}, dist));
}
`;
