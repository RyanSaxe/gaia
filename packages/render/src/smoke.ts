// Chimney smoke: a few soft puffs that rise, drift with the wind, swell and
// fade, looping forever. A primitive writes each puff as a quad around its
// chimney's mouth (`pivot`), with its phase in `shade` and the vitality
// below which it stops in `loss`; this shader does the rest, so smoke costs
// one draw call and never rebuilds.

import * as THREE from "three";
import { CHANNEL_MATH } from "@gaia/realize";
import { LIGHT_GLSL, type SceneLight } from "./light.ts";
import { WIND_GLSL } from "./wind.ts";

const SMOKE_VERT = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uVitality;
attribute vec4 aLook;
attribute vec3 aPivot;
#define aShade aLook.x
#define aLoss aLook.z
varying float vAlpha;
varying vec2 vCorner;
varying vec3 vWorld;
varying float vPhase;
${WIND_GLSL}
void main() {
  vec3 corner = position - aPivot;
  float size0 = max(length(corner.xy) / 1.41421, 1e-4);
  vec2 c = corner.xy / size0;
  float phase = fract(uTime * 0.065 + aShade);
  float keep = aLoss > 0.0 ? smoothstep(aLoss, aLoss + ${CHANNEL_MATH.lossBand.toFixed(4)}, uVitality) : 1.0;
  vec3 base = (modelMatrix * vec4(aPivot, 1.0)).xyz;
  float sway = sin(uTime * 0.7 + aShade * 9.0) * 0.25 * phase;
  // Smoke leans downwind with the world's one wind, farther in a gust.
  vec2 lean = WIND_DIR * (1.0 + 0.4 * gustAt(base.xz, uTime)) + vec2(-WIND_DIR.y, WIND_DIR.x) * sway;
  vec3 drift = vec3(lean.x, 0.0, lean.y) * phase * phase * (1.2 + 1.6 * uWind);
  vec3 center = base + vec3(0.0, phase * 5.0, 0.0) + drift;
  float size = size0 * (0.45 + 1.7 * phase);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = center + (right * c.x + up * c.y) * size;
  vAlpha = smoothstep(0.0, 0.14, phase) * (1.0 - smoothstep(0.4, 1.0, phase)) * keep;
  vCorner = c;
  vWorld = world;
  vPhase = phase;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const SMOKE_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
uniform vec3 uHealthy;
varying float vAlpha;
varying vec2 vCorner;
varying vec3 vWorld;
varying float vPhase;
void main() {
  // A soft, slightly lumpy disc that thins as it rises.
  float lump = 0.12 * sin(vCorner.x * 3.1 + vPhase * 7.0) * sin(vCorner.y * 2.7 - vPhase * 5.0);
  float soft = 1.0 - smoothstep(0.25, 1.0, length(vCorner) + lump);
  float a = soft * vAlpha * 0.3;
  if (a < 0.004) discard;
  vec3 tone = nightTone(uHealthy);
  vec3 light = uAmbientColor * uAmbientIntensity + uSunColor * uSunIntensity * 0.5 * sunUp() + uMoonColor * uMoonIntensity * 0.6;
  // Smoke's top catches the sun; its underside takes the shadow tint.
  vec3 color = mix(tone * uShadowColor * (uAmbientIntensity + 0.6), tone * light, 0.55 + 0.45 * clamp(vCorner.y * 0.5 + 0.5, 0.0, 1.0));
  gl_FragColor = vec4(aerial(color, vWorld), a);
}
`;

export function createSmokeMaterial(light: SceneLight, shared: { uVitality: { value: number } }, healthy: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    uniforms: { ...light, uVitality: shared.uVitality, uHealthy: { value: healthy } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
