// A realized plant as Three.js meshes. One ShaderMaterial per part applies
// the vitality channels on the GPU, so vitality is a uniform and changing it
// never rebuilds geometry.

import * as THREE from "three";
import type { Part, Swatch } from "@gaia/schema";
import { CHANNEL_MATH, type Realized } from "@gaia/realize";
import { LIGHT_GLSL, type SceneLight } from "./light.ts";

const f = (x: number): string => x.toFixed(4);

const CHANNELS_GLSL = /* glsl */ `
attribute float aShade;
attribute float aTint;
attribute float aLoss;
attribute float aDroop;
attribute float aWither;
attribute float aGlow;
attribute vec3 aPivot;
attribute float aClose;
uniform float uVitality;
uniform float uNightness;
uniform float uSway;
uniform float uFrequency;
uniform float uHeight;
uniform float uFlutter;
uniform float uWind;

// Loss collapses a piece to its pivot over a short band; droop bends the
// offset from the pivot toward the ground, keeping its length. At night a
// piece that closes (a flower's petals) folds part way toward its pivot.
vec3 applyChannels(vec3 p) {
  vec3 off = (p - aPivot) * (1.0 - aClose * uNightness * 0.7);
  float s = aDroop * (1.0 - uVitality);
  float d = length(off);
  if (s > 0.0 && d > 1e-5) {
    vec3 bent = off;
    bent.y -= s * d * ${f(CHANNEL_MATH.sag)};
    off = normalize(bent) * d;
  }
  float keep = aLoss > 0.0 ? smoothstep(aLoss, aLoss + ${f(CHANNEL_MATH.lossBand)}, uVitality) : 1.0;
  return aPivot + off * keep;
}

// The one wind field (v2's windAt), with the plant's response on top.
float windAt(vec2 p, float t) {
  return sin(t * 1.35 + p.x * 0.21 + p.y * 0.17) + 0.35 * sin(t * 2.9 + p.y * 0.43);
}

vec3 applyWind(vec3 p, vec3 root) {
  float t = uTime * (0.35 + uFrequency);
  float h = clamp(p.y / uHeight, 0.0, 1.4);
  float w = windAt(root.xz + p.xz * 0.08, t);
  vec3 lean = vec3(w, 0.0, w * 0.55) * uSway * uWind * 0.22 * h * h;
  float reach = min(length(p - aPivot), 2.5);
  float flutter = sin(t * 3.1 + dot(aPivot, vec3(1.7, 2.3, 1.3))) * uFlutter * uSway * uWind * 0.05 * reach;
  return p + lean + vec3(flutter, 0.0, flutter * 0.6);
}
`;

export const PLANT_VERT = /* glsl */ `
uniform float uTime;
${CHANNELS_GLSL}
varying vec3 vNormal;
varying vec3 vWorld;
varying float vShade;
varying float vTint;
varying float vWither;
varying float vGlow;
void main() {
  vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 p = applyWind(applyChannels(position), root);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vShade = aShade;
  vTint = aTint;
  vWither = aWither * (1.0 - uVitality);
  vGlow = aGlow * uVitality * ${f(CHANNEL_MATH.glowStrength)} * (0.85 + 0.15 * sin(uTime * 1.3 + aPivot.x * 3.0 + aPivot.z * 2.0));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const PLANT_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
// Same YIQ rotation as hueRotate in @gaia/realize.
vec3 hueRotate(vec3 c, float turns) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float a = turns * 6.28318530718;
  float i2 = i * cos(a) - q * sin(a);
  float q2 = i * sin(a) + q * cos(a);
  return clamp(vec3(y + 0.956 * i2 + 0.621 * q2, y - 0.272 * i2 - 0.647 * q2, y - 1.106 * i2 + 1.703 * q2), 0.0, 1.0);
}
uniform vec3 uHealthy;
uniform vec3 uDecline;
uniform float uFoliage;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vShade;
varying float vTint;
varying float vWither;
varying float vGlow;
void main() {
  float bright = mix(${f(CHANNEL_MATH.shadeLow)}, ${f(CHANNEL_MATH.shadeHigh)}, vShade);
  vec3 albedo = mix(hueRotate(uHealthy, vTint), uDecline, vWither) * bright;
  vec3 n = normalize(vNormal);
  if (uFoliage < 0.5 && !gl_FrontFacing) n = -n;
  // Foliage gets wrapped diffuse: leaves scatter light, so canopies never
  // fall into hard dark sides.
  float nDotL = dot(n, uSunDirection);
  float wrapped = mix(max(nDotL, 0.0), nDotL * 0.5 + 0.5, uFoliage * 0.85);
  float shadow = mix(0.4 + uFoliage * 0.15, 1.0, sunShadow(vWorld, 0.0025 + uFoliage * 0.007));
  float light = softCel(wrapped * shadow) * sunUp();
  vec3 toned = nightTone(albedo);
  vec3 lit = toned * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = toned * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.35 + uFoliage * 0.12, 0.0, 1.0));
  // Backlit leaves glow warm, faintly.
  vec3 toEye = normalize(cameraPosition - vWorld);
  float back = pow(clamp(dot(-toEye, uSunDirection), 0.0, 1.0), 4.0) * uFoliage * 0.22 * shadow * min(uSunIntensity, 1.0);
  color += albedo * uSunColor * back;
  // Leaves between the eye and the moon catch a faint silver rim.
  float moonBack = pow(clamp(dot(-toEye, uMoonDirection), 0.0, 1.0), 3.0) * uFoliage * 0.5 * uMoonIntensity;
  color += nightTone(albedo) * uMoonColor * moonBack;
  color += nightLight(albedo, n, vWorld, uFoliage * 0.85, mix(1.0, shadow, uMoonShadow));
  // The world's own glow shows by contrast: a touch stronger in the dark,
  // and it carries through the night air a little farther than lit color.
  vec3 glow = uHealthy * vGlow * (1.0 + uNightness * 0.6);
  gl_FragColor = vec4(aerial(shoulder(color), vWorld) + glow * (1.0 - uNightness * 0.35), 1.0);
}
`;

export const DEPTH_VERT = /* glsl */ `
uniform float uTime;
${CHANNELS_GLSL}
void main() {
  vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 p = applyWind(applyChannels(position), root);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}
`;

export const DEPTH_FRAG = /* glsl */ `
precision highp float;
void main() { gl_FragColor = vec4(1.0); }
`;

export interface PlantView {
  readonly object: THREE.Group;
  /** Height of the plant's bounds, for wind and camera framing. */
  readonly height: number;
  /** Horizontal radius of the plant's bounds. */
  readonly radius: number;
  readonly triangles: number;
  /** The vitality the shader shows now. */
  readonly vitality: number;
  setVitality(v: number): void;
  /** Swaps every mesh to its depth material for the shadow pass, and back. */
  useDepth(on: boolean): void;
  dispose(): void;
}

const vec3Of = (c: readonly number[]): THREE.Vector3 => new THREE.Vector3(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);

export function geometryOf(part: Part): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(part.normals, 3));
  g.setAttribute("aShade", new THREE.BufferAttribute(part.shade, 1));
  g.setAttribute("aTint", new THREE.BufferAttribute(part.tint, 1));
  g.setAttribute("aLoss", new THREE.BufferAttribute(part.channels.loss, 1));
  g.setAttribute("aDroop", new THREE.BufferAttribute(part.channels.droop, 1));
  g.setAttribute("aWither", new THREE.BufferAttribute(part.channels.wither, 1));
  g.setAttribute("aGlow", new THREE.BufferAttribute(part.channels.glow, 1));
  g.setAttribute("aPivot", new THREE.BufferAttribute(part.channels.pivot, 3));
  g.setAttribute("aClose", new THREE.BufferAttribute(part.channels.close, 1));
  g.setIndex(new THREE.BufferAttribute(part.indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Bark and stone are solid; leaves, moss and blooms are thin and scatter light. */
export const FOLIAGE: Readonly<Record<string, number>> = { bark: 0, leaf: 1, bloom: 0.6, stone: 0, moss: 0.3, stem: 0.8, eye: 0.6 };

export function createPlant(plant: Realized, light: SceneLight): PlantView {
  const object = new THREE.Group();
  const box = new THREE.Box3();
  const geometries = plant.parts.map(geometryOf);
  for (const g of geometries) if (g.boundingBox !== null) box.union(g.boundingBox);
  const height = Math.max(1, box.max.y);
  const radius = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z, 1);

  const shared = {
    uVitality: { value: 1 },
    uSway: { value: plant.motion.sway },
    uFrequency: { value: plant.motion.frequency },
    uHeight: { value: height },
  };
  const materials: THREE.ShaderMaterial[] = [];
  const meshes: { mesh: THREE.Mesh; color: THREE.ShaderMaterial; depth: THREE.ShaderMaterial }[] = [];
  plant.parts.forEach((part, i) => {
    const swatch: Swatch = plant.palette.swatches[part.swatch] ?? { healthy: [1, 0, 1], decline: [1, 0, 1] };
    const foliage = FOLIAGE[part.swatch] ?? 0.5;
    const perPart = { uFlutter: { value: foliage === 0 ? 0 : 1 } };
    const color = new THREE.ShaderMaterial({
      vertexShader: PLANT_VERT,
      fragmentShader: PLANT_FRAG,
      uniforms: {
        ...light,
        ...shared,
        ...perPart,
        uHealthy: { value: vec3Of(swatch.healthy) },
        uDecline: { value: vec3Of(swatch.decline) },
        uFoliage: { value: foliage },
      },
      side: foliage === 0 ? THREE.FrontSide : THREE.DoubleSide,
    });
    const depth = new THREE.ShaderMaterial({
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
      uniforms: { uTime: light.uTime, uWind: light.uWind, uNightness: light.uNightness, ...shared, ...perPart },
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometries[i], color);
    mesh.frustumCulled = false;
    mesh.userData.part = part.swatch;
    object.add(mesh);
    materials.push(color, depth);
    meshes.push({ mesh, color, depth });
  });

  return {
    object,
    height,
    radius,
    triangles: plant.parts.reduce((n, p) => n + p.indices.length / 3, 0),
    get vitality() {
      return shared.uVitality.value;
    },
    setVitality(v) {
      shared.uVitality.value = Math.min(1, Math.max(0, v));
    },
    useDepth(on) {
      for (const m of meshes) m.mesh.material = on ? m.depth : m.color;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      object.removeFromParent();
    },
  };
}
