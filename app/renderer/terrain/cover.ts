// What covers the ground: wind-swayed grass that travels with the viewer and
// stands on the baked lattice, grown from each region's ground cover, and
// water surfaces that sit at their solved levels. Both read the same ground
// texture the mesh was built from.

import * as THREE from "three";
import { LIGHT_GLSL, type SceneLight, hexToVec3 } from "@gaia/render";
import { type Terrain, surfaceHalfWidth } from "@gaia/terrain";
import { GROUND_SAMPLE_GLSL, type GroundTexture } from "./ground.ts";
import { REGIONS_GLSL, type RegionCovers, TUFT_GLSL } from "./regions.ts";

const GRASS_VERT = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uRadius;
uniform float uPatch;
uniform vec3 uCenter;
${GROUND_SAMPLE_GLSL}
${REGIONS_GLSL}
${TUFT_GLSL}
attribute vec4 aBlade; // x, z within the patch, rotation, height
attribute vec4 aSeed; // tint, flower, keep, cover pick
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
  // Each blade wraps to stay within half a patch of the viewer, so the field
  // travels with them while every blade keeps a fixed spot on the ground.
  vec2 xz = uCenter.xz + mod(aBlade.xy - uCenter.xz + uPatch * 0.5, uPatch) - uPatch * 0.5;
  vec2 g = groundAt(xz);
  float e = 0.6;
  float sx = groundAt(xz + vec2(e, 0.0)).x - groundAt(xz - vec2(e, 0.0)).x;
  float sz = groundAt(xz + vec2(0.0, e)).x - groundAt(xz - vec2(0.0, e)).x;
  float grade = length(vec2(sx, sz)) / (2.0 * e);
  float dry = 1.0 - smoothstep(-0.35, -0.05, g.y - g.x);
  float fade = smoothstep(uRadius, uRadius * 0.55, length(xz - uCenter.xz));

  // The blade grows one region's cover: its height, width, density, clumping and flowers.
  int k = coverPick(xz, aSeed.w);
  vec4 shape = uCoverShape[k];
  float keep = step(aSeed.z, shape.z);
  float clump = mix(1.0, tuftMask(xz), shape.w);
  float flowers = uCoverFlowers[k];
  float flower = step(aSeed.y, flowers);
  float h = aBlade.w * shape.x * fade * dry * keep * clump * (1.0 - smoothstep(0.35, 0.65, grade) * 0.7) * (1.0 + flower * 0.25);
  float t = position.y;
  float c = cos(aBlade.z);
  float s = sin(aBlade.z);
  // A flower blade opens a small diamond head around its upper vertices.
  float wide = shape.y * (1.0 + flower * 2.4 * step(0.7, t) * step(t, 0.9));
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
  if (vFlower > 0.5 && vT > 0.55) albedo = vBloom;
  float shadow = mix(0.45, 1.0, sunShadow(vWorld, 0.0015));
  float light = softCel(max(uSunDirection.y, 0.0) * shadow);
  vec3 lit = albedo * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = albedo * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.35, 0.0, 1.0));
  gl_FragColor = vec4(aerial(shoulder(color), vWorld), 1.0);
}
`;

export interface Grass {
  readonly mesh: THREE.Mesh;
  follow(center: THREE.Vector3): void;
}

/** Wind-swayed blades around the viewer; each region's cover decides what grows where. */
export function createGrass(light: SceneLight, ground: GroundTexture, covers: RegionCovers, count = 110000, radius = 42): Grass {
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
  const patch = radius * 2;
  const data = new Float32Array(count * 4);
  const seeds = new Float32Array(count * 4);
  let seed = 1234567;
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    data[i * 4] = next() * patch;
    data[i * 4 + 1] = next() * patch;
    data[i * 4 + 2] = next() * Math.PI;
    data[i * 4 + 3] = 0.55 + next() * 0.75;
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = next();
  }
  geometry.setAttribute("aBlade", new THREE.InstancedBufferAttribute(data, 4));
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = count;
  const center = { value: new THREE.Vector3() };
  const material = new THREE.ShaderMaterial({
    vertexShader: GRASS_VERT,
    fragmentShader: GRASS_FRAG,
    uniforms: {
      ...light,
      ...ground.uniforms,
      ...covers.uniforms,
      uRadius: { value: radius },
      uPatch: { value: patch },
      uCenter: center,
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
  vec3 color = body * (uSunColor * uSunIntensity * 0.55 * max(uSunDirection.y, 0.0) + uAmbientColor * uAmbientIntensity * 0.9);
  color = mix(color, uSky, fresnel * 0.55);
  float glint = pow(max(dot(reflect(-uSunDirection, n), toEye), 0.0), 120.0);
  color += uSunColor * glint * 0.35;
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
  return { group, update };
}
