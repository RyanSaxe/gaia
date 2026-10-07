// The meadow around the plants: v2's sky dome (gradient, golden sun, fbm
// clouds, ACES and gamma in-shader) and a soft painted ground that takes
// the plants' sun shadows.

import * as THREE from "three";
import { LIGHT_GLSL, type SceneLight, hexToVec3 } from "@gaia/render";

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
varying vec3 vDirection;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform float uTime;

float cloudHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x),
             mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbmCloud(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += amp * cloudNoise(p); p = rot * p * 2.1; amp *= 0.5; }
  return v;
}
void main() {
  vec3 dir = normalize(vDirection);
  float y = dir.y * 0.5 + 0.5;
  vec3 color = mix(uHorizon, uMid, smoothstep(0.35, 0.65, y));
  color = mix(color, uZenith, smoothstep(0.60, 0.85, y));
  color = mix(color, uGround, smoothstep(0.5, 0.34, y));
  float sunDot = max(dot(dir, normalize(uSun)), 0.0);
  color = mix(color, uSunColor * 0.55, pow(sunDot, 8.0) * 0.35);
  color = mix(color, vec3(0.9, 0.6, 0.12), pow(sunDot, 16.0) * 0.7);
  float denom = max(abs(dir.y) + 0.3, 0.01);
  vec2 uv = dir.xz / denom;
  float c1 = smoothstep(0.5, 0.68, fbmCloud((uv * 1.5 + vec2(uTime * 0.012, uTime * 0.004)) * 3.0));
  float c2 = smoothstep(0.55, 0.72, fbmCloud((uv * 2.8 + vec2(-uTime * 0.008, uTime * 0.006)) * 2.5)) * 0.5;
  float density = min(1.0, c1 + c2) * smoothstep(0.92, 0.65, abs(dir.y)) * smoothstep(0.0, 0.03, abs(dir.y));
  color = mix(color, vec3(0.953, 0.961, 0.969) * (sunDot * 0.3 + 0.7), density * 0.85);
  color = min(color, vec3(0.8));
  color = clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
  color = pow(color, vec3(1.0 / 2.2));
  gl_FragColor = vec4(color, 1.0);
}
`;

export function createSky(light: SceneLight): THREE.Mesh {
  const zenith = hexToVec3(0x1f52fa);
  const horizon = hexToVec3(0x4d85ee);
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uZenith: { value: zenith },
      uMid: { value: zenith.clone().lerp(horizon, 0.55) },
      uHorizon: { value: horizon },
      uGround: { value: hexToVec3(0x5a6b58) },
      uSun: light.uSunDirection,
      uSunColor: light.uSunColor,
      uTime: light.uTime,
    },
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

const GROUND_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const GROUND_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
uniform vec3 uGrassHigh;
uniform vec3 uGrassLow;
uniform vec3 uDry;
uniform vec4 uSelect;
varying vec3 vWorld;
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
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}
void main() {
  float broad = fbm(vWorld.xz * 0.05);
  float fine = fbm(vWorld.xz * 0.6);
  vec3 albedo = mix(uGrassLow, uGrassHigh, smoothstep(0.3, 0.72, broad * 0.75 + fine * 0.25));
  albedo = mix(albedo, uDry, smoothstep(0.62, 0.8, fbm(vWorld.xz * 0.09 + 40.0)) * 0.35);
  albedo *= 0.95 + 0.08 * fine;
  float nDotL = max(uSunDirection.y, 0.0);
  float shadow = mix(0.42, 1.0, sunShadow(vWorld, 0.0015));
  float light = softCel(nDotL * shadow);
  vec3 lit = albedo * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = albedo * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.35, 0.0, 1.0));
  float d = length(vWorld.xz - uSelect.xy);
  float ring = smoothstep(uSelect.z * 1.04, uSelect.z, d) * smoothstep(uSelect.z * 0.9, uSelect.z, d);
  color = mix(color, vec3(1.0, 0.98, 0.9), ring * 0.4 * uSelect.w);
  color = aerial(shoulder(color), vWorld);
  float far = smoothstep(70.0, 170.0, length(vWorld.xz - cameraPosition.xz));
  gl_FragColor = vec4(mix(color, uFogColor, far), 1.0);
}
`;

export interface Ground {
  readonly mesh: THREE.Mesh;
  select(x: number, z: number, radius: number, on: boolean): void;
}

export function createGround(light: SceneLight): Ground {
  const select = { value: new THREE.Vector4(0, 0, 1, 0) };
  const material = new THREE.ShaderMaterial({
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    uniforms: {
      ...light,
      uGrassHigh: { value: hexToVec3(0x8cc05e) },
      uGrassLow: { value: hexToVec3(0x639a4b) },
      uDry: { value: hexToVec3(0xb3a078) },
      uSelect: select,
    },
  });
  const geometry = new THREE.CircleGeometry(400, 96);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    select(x, z, radius, on) {
      select.value.set(x, z, radius, on ? 1 : 0);
    },
  };
}

const GRASS_VERT = /* glsl */ `
uniform float uTime;
uniform float uRadius;
attribute vec4 aBlade; // x, z, rotation, height
attribute float aTint;
varying vec3 vWorld;
varying float vT;
varying float vTint;
float windAt(vec2 p, float t) {
  return sin(t * 1.35 + p.x * 0.21 + p.y * 0.17) + 0.35 * sin(t * 2.9 + p.y * 0.43);
}
void main() {
  float t = position.y;
  float fade = smoothstep(uRadius, uRadius * 0.6, length(aBlade.xy));
  float h = aBlade.w * fade;
  float c = cos(aBlade.z);
  float s = sin(aBlade.z);
  vec3 local = vec3(position.x * c, t * h, position.x * s);
  float w = windAt(aBlade.xy, uTime * 0.95) + 0.3 * sin(uTime * 3.7 + aBlade.x * 0.7 + aBlade.y * 1.3);
  local.x += w * 0.09 * t * t * h;
  local.z += w * 0.05 * t * t * h;
  vec3 world = vec3(aBlade.x, 0.0, aBlade.y) + local;
  vWorld = world;
  vT = t;
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const GRASS_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
uniform vec3 uGrassHigh;
uniform vec3 uGrassLow;
uniform vec3 uDry;
varying vec3 vWorld;
varying float vT;
varying float vTint;
void main() {
  vec3 albedo = mix(uGrassLow, uGrassHigh, clamp(vT * 0.8 + vTint * 0.4, 0.0, 1.0));
  albedo = mix(albedo, uDry, step(0.93, vTint) * 0.45);
  albedo *= 0.82 + 0.25 * vT;
  // Grass shades like the ground it grows from, so the meadow reads as one surface.
  float shadow = mix(0.42, 1.0, sunShadow(vWorld, 0.0015));
  float light = softCel(max(uSunDirection.y, 0.0) * shadow);
  vec3 lit = albedo * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = albedo * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.35, 0.0, 1.0));
  gl_FragColor = vec4(aerial(shoulder(color), vWorld), 1.0);
}
`;

/** A field of wind-swayed blades that thins out softly at its rim. */
export function createGrass(light: SceneLight, count = 80000, radius = 46): THREE.Mesh {
  // One tapered blade: three rows, narrowing to a point.
  const blade = new THREE.BufferGeometry();
  const w = 0.045;
  blade.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, -w * 0.7, 0.4, 0, w * 0.7, 0.4, 0, -w * 0.35, 0.75, 0, w * 0.35, 0.75, 0, 0, 1, 0], 3),
  );
  blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6]);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = blade.index;
  geometry.setAttribute("position", blade.getAttribute("position"));
  const data = new Float32Array(count * 4);
  const tint = new Float32Array(count);
  let seed = 1234567;
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt(next());
    const a = next() * Math.PI * 2;
    data[i * 4] = Math.cos(a) * r;
    data[i * 4 + 1] = Math.sin(a) * r;
    data[i * 4 + 2] = next() * Math.PI;
    data[i * 4 + 3] = 0.22 + next() * 0.3;
    tint[i] = next();
  }
  geometry.setAttribute("aBlade", new THREE.InstancedBufferAttribute(data, 4));
  geometry.setAttribute("aTint", new THREE.InstancedBufferAttribute(tint, 1));
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    vertexShader: GRASS_VERT,
    fragmentShader: GRASS_FRAG,
    uniforms: {
      ...light,
      uRadius: { value: radius },
      uGrassHigh: { value: hexToVec3(0x9ccc68) },
      uGrassLow: { value: hexToVec3(0x5a9146) },
      uDry: { value: hexToVec3(0xc4b47e) },
    },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
