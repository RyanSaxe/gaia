// What covers the ground: wind-swayed grass that travels with the viewer and
// stands on the baked lattice, grown from each region's ground cover, and
// water surfaces that sit at their solved levels. Both read the same ground
// texture the mesh was built from.

import * as THREE from "three";
import { LIGHT_GLSL, type SceneLight, hexToVec3 } from "@gaia/render";
import { type Terrain, surfaceHalfWidth } from "@gaia/terrain";
import { GROUND_SAMPLE_GLSL, type GroundTexture } from "./ground.ts";
import { REGIONS_GLSL, type RegionCovers, TUFT_GLSL } from "./regions.ts";
import { CLEARING_GLSL, type Clearings } from "./clearings.ts";

const GRASS_VERT = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform vec3 uCenter;
uniform float uLand;
${GROUND_SAMPLE_GLSL}
${REGIONS_GLSL}
${TUFT_GLSL}
${CLEARING_GLSL}
attribute vec4 aBlade; // x, z as a share of the blade's patch, rotation, height
attribute vec4 aSeed; // tint, flower, keep, cover pick
attribute vec2 aThin; // how far out the blade still grows, as a share of the thinning band; its reach
varying vec3 vWorld;
varying float vT;
varying float vTint;
varying float vFlower;
varying vec3 vLow;
varying vec3 vHigh;
varying vec3 vTip;
varying vec3 vBloom;
float windAt(vec2 p, float t) {
  return sin(t * 1.35 + p.x * 0.21 + p.y * 0.17) + 0.35 * sin(t * 2.9 + p.y * 0.43);
}
void main() {
  // Each blade wraps to stay within its reach of the viewer, so the field
  // travels with them while every blade keeps a fixed spot on the ground.
  // Some blades reach only half as far, so the grass is densest close by.
  float reach = aThin.y;
  vec2 xz = uCenter.xz + mod(aBlade.xy * reach * 2.0 - uCenter.xz + reach, reach * 2.0) - reach;
  vec2 g = groundAt(xz);
  float e = 0.6;
  float sx = groundAt(xz + vec2(e, 0.0)).x - groundAt(xz - vec2(e, 0.0)).x;
  float sz = groundAt(xz + vec2(0.0, e)).x - groundAt(xz - vec2(0.0, e)).x;
  float grade = length(vec2(sx, sz)) / (2.0 * e);
  float dry = 1.0 - smoothstep(-0.35, -0.05, g.y - g.x);
  // A blade never grows or shrinks with distance. Each one has its own
  // threshold and disappears whole once the viewer is farther than that, so
  // the field thins out from 55% of its reach over ground painted the same.
  // It thins the same way toward the hand-over to the wild land.
  float near = step(length(xz - uCenter.xz), reach * mix(0.55, 1.0, aThin.x));
  float inland = step(length(xz), uLand - 2.0 - 26.0 * aThin.x);

  // The blade grows one region's cover: its height, width, density, clumping and flowers.
  int k = coverPick(xz, aSeed.w);
  vec4 shape = uCoverShape[k];
  float keep = step(aSeed.z, shape.z) * near * inland;
  float clump = mix(1.0, tuftMask(xz), shape.w);
  float flowers = uCoverFlowers[k];
  float flower = step(aSeed.y, flowers);
  float h = aBlade.w * shape.x * dry * keep * clump * (1.0 - smoothstep(0.35, 0.65, grade) * 0.7) * (1.0 + flower * 0.25);
  // Nothing grows under a stone.
  h *= step(clearingAt(xz), 0.5);
  float t = position.y;
  float c = cos(aBlade.z);
  float s = sin(aBlade.z);
  // A flower blade opens a small head just below its tip. Seen at eye
  // height, a head any larger reads as confetti.
  float wide = shape.y * keep * (1.0 + flower * 1.6 * step(0.7, t) * step(t, 0.9));
  vec3 local = vec3(position.x * wide * c, t * h, position.x * wide * s);
  float w = windAt(xz, uTime * 0.95) + 0.3 * sin(uTime * 3.7 + xz.x * 0.7 + xz.y * 1.3);
  local.x += w * 0.09 * uWind * t * t * h;
  local.z += w * 0.05 * uWind * t * t * h;
  vec3 world = vec3(xz.x, g.x - 0.02, xz.y) + local;
  vWorld = world;
  vT = t;
  vTint = aSeed.x;
  float pick = aSeed.y / max(flowers, 1e-4);
  vFlower = flower;
  vBloom = pick < 0.4 ? uFlowerA[k] : pick < 0.75 ? uFlowerB[k] : uFlowerC[k];
  vLow = uCoverLow[k];
  vHigh = uCoverHigh[k];
  vTip = uCoverTip[k];
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const GRASS_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
uniform vec3 uDry;
varying vec3 vWorld;
varying float vT;
varying float vTint;
varying float vFlower;
varying vec3 vLow;
varying vec3 vHigh;
varying vec3 vTip;
varying vec3 vBloom;
void main() {
  vec3 albedo = mix(vLow, vHigh, clamp(vT * 0.8 + vTint * 0.4, 0.0, 1.0));
  albedo = mix(albedo, vTip, smoothstep(0.55, 1.0, vT) * 0.75);
  albedo = mix(albedo, uDry, step(0.93, vTint) * 0.45);
  albedo *= 0.82 + 0.25 * vT;
  // Flowers fade into their blades at night, so the dark meadow never reads as confetti.
  if (vFlower > 0.5 && vT > 0.8) albedo = mix(vBloom * (0.9 + 0.1 * vT), albedo, uNightness * 0.75);
  float shadow = mix(0.45, 1.0, sunShadow(vWorld, 0.0015));
  float light = softCel(max(uSunDirection.y, 0.0) * shadow) * sunUp();
  vec3 toned = nightTone(albedo);
  vec3 lit = toned * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = toned * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.35, 0.0, 1.0));
  // Blades scatter light, so the moon and the lantern wrap well around them.
  color += nightLight(albedo, vec3(0.0, 1.0, 0.0), vWorld, 0.6, mix(1.0, shadow, uMoonShadow));
  gl_FragColor = vec4(aerial(shoulder(color), vWorld), 1.0);
}
`;

export interface Grass {
  readonly mesh: THREE.Mesh;
  follow(center: THREE.Vector3): void;
}

/**
 * Wind-swayed blades around the viewer; each region's cover decides what
 * grows where. Blades keep their full height at every distance: the far ones
 * thin out whole, each at its own seeded distance.
 */
export function createGrass(light: SceneLight, ground: GroundTexture, covers: RegionCovers, land: number, clearings: Clearings, count = 150000, radius = 60): Grass {
  // A third of the blades reach only 26 m, so the grass is densest close by.
  const close = Math.round(count * 0.3);
  // One tapered blade, one unit wide: the cover sets its width.
  const blade = new THREE.BufferGeometry();
  blade.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -0.7, 0.4, 0, 0.7, 0.4, 0, -0.35, 0.75, 0, 0.35, 0.75, 0, 0, 1, 0], 3),
  );
  blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6]);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = blade.index;
  geometry.setAttribute("position", blade.getAttribute("position"));
  const data = new Float32Array(count * 4);
  const seeds = new Float32Array(count * 4);
  const thin = new Float32Array(count * 2);
  let seed = 1234567;
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    data[i * 4] = next();
    data[i * 4 + 1] = next();
    data[i * 4 + 2] = next() * Math.PI;
    data[i * 4 + 3] = 0.55 + next() * 0.75;
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = next();
    thin[i * 2] = next();
    thin[i * 2 + 1] = i < close ? 26 : radius;
  }
  geometry.setAttribute("aBlade", new THREE.InstancedBufferAttribute(data, 4));
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.setAttribute("aThin", new THREE.InstancedBufferAttribute(thin, 2));
  geometry.instanceCount = count;
  const center = { value: new THREE.Vector3() };
  const material = new THREE.ShaderMaterial({
    vertexShader: GRASS_VERT,
    fragmentShader: GRASS_FRAG,
    uniforms: {
      ...light,
      ...ground.uniforms,
      ...covers.uniforms,
      uCenter: center,
      uLand: { value: land },
      ...clearings.uniforms,
      uDry: { value: hexToVec3(0xc4b47e) },
    },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, follow: (c) => center.value.copy(c) };
}

const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WATER_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
${GROUND_SAMPLE_GLSL}
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSky;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float depth = vWorld.y - groundAt(vWorld.xz).x;
  if (depth <= 0.0) discard;
  vec2 p = vWorld.xz * 0.9;
  float t = uTime * 0.6;
  float ripple = noise(p + vec2(t, t * 0.7)) + noise(p * 1.9 - vec2(t * 0.8, -t)) * 0.5;
  vec3 n = normalize(vec3((ripple - 0.75) * 0.12, 1.0, (noise(p * 1.3 + 9.0 + t) - 0.5) * 0.12));
  vec3 toEye = normalize(cameraPosition - vWorld);
  float fresnel = pow(1.0 - max(dot(n, toEye), 0.0), 3.0);
  vec3 body = mix(uShallow, uDeep, smoothstep(0.05, 0.9, depth));
  vec3 color = nightTone(body) * (uSunColor * uSunIntensity * 0.55 * max(uSunDirection.y, 0.0) + uAmbientColor * uAmbientIntensity * 0.9);
  color = mix(color, uSky, fresnel * 0.55);
  float glint = pow(max(dot(reflect(-uSunDirection, n), toEye), 0.0), 120.0);
  color += uSunColor * glint * 0.35 * min(uSunIntensity, 1.0);
  // At night the moon lays a soft path across the water, the lantern warms
  // what is near, and living water glows faintly where its ripples gather.
  float moonGlint = pow(max(dot(reflect(-uMoonDirection, n), toEye), 0.0), 40.0);
  color += uMoonColor * moonGlint * uMoonIntensity * 1.4;
  color += lanternLight(body, n, vWorld, 0.5) * 0.8;
  float bloom = smoothstep(0.78, 0.98, noise(p * 2.3 + vec2(t * 0.35, -t * 0.2))) * (0.6 + 0.4 * sin(uTime * 0.9 + p.x * 1.7));
  color += vec3(0.32, 0.78, 0.72) * bloom * smoothstep(0.08, 0.4, depth) * uNightness * 0.16;
  // A thin, soft line of foam where the water meets the shore.
  float foam = (1.0 - smoothstep(0.0, 0.07, depth)) * (0.6 + 0.4 * noise(p * 3.0 + t));
  color = mix(color, vec3(0.93, 0.95, 0.92), foam * 0.45);
  float alpha = mix(0.55, 0.92, smoothstep(0.0, 0.6, depth));
  gl_FragColor = vec4(aerial(shoulder(color), vWorld), alpha);
}
`;

export interface Water {
  readonly group: THREE.Group;
  update(t: Terrain): void;
  /** The sky color the water reflects at grazing angles. */
  reflect(sky: readonly [number, number, number]): void;
}

function ribbon(t: Terrain): THREE.BufferGeometry[] {
  return t.streams.map((stream) => {
    const st = stream.stations;
    const pos: number[] = [];
    const idx: number[] = [];
    st.forEach((s, i) => {
      const a = st[Math.max(0, i - 1)] ?? s;
      const b = st[Math.min(st.length - 1, i + 1)] ?? s;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      const w = surfaceHalfWidth(s);
      pos.push(s.x - nx * w, s.level, s.z - nz * w, s.x + nx * w, s.level, s.z + nz * w);
      if (i > 0) {
        const k = (i - 1) * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  });
}

function disc(x: number, z: number, radius: number, level: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(radius, 72);
  g.rotateX(-Math.PI / 2);
  g.translate(x, level, z);
  return g;
}

export function createWater(t: Terrain, light: SceneLight, ground: GroundTexture): Water {
  const material = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      ...light,
      ...ground.uniforms,
      uShallow: { value: hexToVec3(0x8fcfc0) },
      uDeep: { value: hexToVec3(0x2e6f93) },
      uSky: { value: hexToVec3(0xb9d8f0) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  const update = (next: Terrain): void => {
    for (const child of [...group.children]) {
      (child as THREE.Mesh).geometry.dispose();
      group.remove(child);
    }
    for (const g of ribbon(next)) group.add(new THREE.Mesh(g, material));
    for (const p of next.ponds) group.add(new THREE.Mesh(disc(p.x, p.z, p.reach, p.level), material));
    for (const m of group.children) m.renderOrder = 2;
  };
  update(t);
  const sky = material.uniforms.uSky as { value: THREE.Vector3 };
  return { group, update, reflect: (c) => sky.value.set(c[0], c[1], c[2]) };
}
