// Scene-wide light, shared by reference with every material: one write per
// frame, every shader sees it. Values follow v2's ghibli-default style pack.

import * as THREE from "three";

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
  };
}

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

vec3 aerial(vec3 color, vec3 worldPosition) {
  float dist = length(worldPosition - cameraPosition);
  float lift = 1.0 - exp(-dist * uFogDensity);
  // Mist lies low: thickest at the ground, gone a few units up, and only with distance.
  float mist = uMist * exp(-max(worldPosition.y, 0.0) * 0.45) * (1.0 - exp(-dist * 0.035));
  return mix(color, uFogColor, clamp(lift * 0.65 + mist * 0.7, 0.0, 1.0));
}
`;
