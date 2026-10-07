// The baked lattice as Three.js: one ground mesh (and an exact-subset coarse
// mesh for the overview), a float texture of the same samples for the grass
// and water shaders, and the painterly ground material, colored by each
// region's ground cover.

import * as THREE from "three";
import { LIGHT_GLSL, type SceneLight, hexToVec3 } from "@gaia/render";
import { DRY, TERRAIN, type Terrain } from "@gaia/terrain";
import { REGIONS_GLSL, type RegionCovers, TUFT_GLSL } from "./regions.ts";

/** Height and water level per lattice sample, for shaders that sample the ground. */
export interface GroundTexture {
  readonly texture: THREE.DataTexture;
  readonly uniforms: {
    readonly uGround: { value: THREE.DataTexture };
    readonly uGroundN: { value: number };
    readonly uGroundOrigin: { value: number };
    readonly uGroundSpacing: { value: number };
  };
  update(t: Terrain): void;
}

export function createGroundTexture(t: Terrain): GroundTexture {
  const { n } = t.lattice;
  const data = new Float32Array(n * n * 2);
  const texture = new THREE.DataTexture(data, n, n, THREE.RGFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  const uniforms = {
    uGround: { value: texture },
    uGroundN: { value: n },
    uGroundOrigin: { value: t.lattice.origin },
    uGroundSpacing: { value: t.lattice.spacing },
  };
  const update = (next: Terrain): void => {
    for (let i = 0; i < n * n; i++) {
      data[i * 2] = next.lattice.heights[i] as number;
      data[i * 2 + 1] = next.waterLevel[i] as number;
    }
    texture.needsUpdate = true;
  };
  update(t);
  return { texture, uniforms, update };
}

/** GLSL that reads the ground texture with the mesh's own triangle interpolation. */
export const GROUND_SAMPLE_GLSL = /* glsl */ `
uniform sampler2D uGround;
uniform float uGroundN;
uniform float uGroundOrigin;
uniform float uGroundSpacing;
vec2 groundAt(vec2 xz) {
  vec2 g = clamp((xz - uGroundOrigin) / uGroundSpacing, vec2(0.0), vec2(uGroundN - 1.001));
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  vec2 h00 = texelFetch(uGround, i, 0).rg;
  vec2 h10 = texelFetch(uGround, i + ivec2(1, 0), 0).rg;
  vec2 h01 = texelFetch(uGround, i + ivec2(0, 1), 0).rg;
  vec2 h11 = texelFetch(uGround, i + ivec2(1, 1), 0).rg;
  if (f.x + f.y <= 1.0) return h00 + f.x * (h10 - h00) + f.y * (h01 - h00);
  return h11 + (1.0 - f.x) * (h01 - h11) + (1.0 - f.y) * (h10 - h11);
}
`;

/** The sea of mist the world floats in: past the rim, land dissolves into it. */
export const MIST_GLSL = /* glsl */ `
float mistHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mistNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mistHash(i), mistHash(i + vec2(1.0, 0.0)), u.x), mix(mistHash(i + vec2(0.0, 1.0)), mistHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 mistAt(vec2 xz, float t) {
  vec2 p = xz * 0.012 + vec2(t * 0.004, t * 0.002);
  float m = mistNoise(p) * 0.6 + mistNoise(p * 2.3 + 5.0) * 0.3 + mistNoise(p * 5.1 + 9.0) * 0.1;
  // By night the mist is lit only by the moon: a shade above the dark air, never white.
  vec3 pale = mix(vec3(0.97, 0.97, 0.95), uFogColor * 1.08 + uMoonColor * uMoonIntensity * 0.06, uNightness);
  return mix(uFogColor, pale, 0.35 + 0.3 * smoothstep(0.35, 0.75, m));
}
`;

const VERT = /* glsl */ `
attribute float aWater;
attribute float aRegion;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vWater;
varying float vRegion;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normal;
  vWater = aWater;
  vRegion = aRegion;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
${MIST_GLSL}
${REGIONS_GLSL}
${TUFT_GLSL}
uniform vec3 uDry;
uniform vec3 uBare;
uniform vec3 uSand;
uniform vec3 uBed;
uniform float uSelected;
uniform float uOutline;
uniform float uHalf;
uniform float uSkirt;
uniform vec2 uHeightRange;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vWater;
varying float vRegion;
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
  vec3 n = normalize(vNormal);
  float broad = fbm(vWorld.xz * 0.045);
  float fine = fbm(vWorld.xz * 0.6);
  // The regions' covers, blended where their heights blend. Low ground is
  // lush and deep; high ground is lighter and drier.
  GroundCover cover = groundCoverAt(vWorld.xz);
  float rel = clamp((vWorld.y - uHeightRange.x) / max(1.0, uHeightRange.y - uHeightRange.x), 0.0, 1.0);
  vec3 albedo = mix(cover.low, cover.high, smoothstep(0.25, 0.75, broad * 0.6 + fine * 0.2 + rel * 0.45));
  // A clumped cover leaves its own soil showing between the tufts.
  albedo = mix(cover.soil, albedo, mix(1.0, tuftMask(vWorld.xz) * 0.75, cover.clump));
  albedo = mix(albedo, uDry, smoothstep(0.6, 0.82, fbm(vWorld.xz * 0.08 + 40.0) + rel * 0.18) * 0.38);
  // Bare earth shows on steep risers and banks.
  float steep = 1.0 - n.y;
  albedo = mix(albedo, uBare, smoothstep(0.075, 0.17, steep + (fine - 0.5) * 0.05) * 0.8);
  // Hollows hold a deeper green; the broad patches carry more contrast.
  albedo *= 0.94 + 0.12 * smoothstep(0.2, 0.8, broad);
  // Wet sand at the waterline, a darker bed beneath the water.
  float shore = smoothstep(-0.55, -0.1, vWater) * (1.0 - smoothstep(0.05, 0.3, vWater));
  albedo = mix(albedo, uSand, shore * 0.8);
  albedo = mix(albedo, uBed, smoothstep(0.1, 0.5, vWater));
  albedo *= 0.94 + 0.1 * fine;

  // Hillshade: slopes turned to the sun brighten and slopes turned away darken
  // more than plain diffuse would, so low relief still reads.
  float level = max(uSunDirection.y, 0.05);
  float nDotL = max(level + (dot(n, uSunDirection) - level) * 1.6, 0.0);
  float shadow = mix(0.45, 1.0, sunShadow(vWorld, 0.0015));
  float direct = nDotL * shadow;
  // Half cel, half smooth: slopes read as painted planes without hard contour bands.
  float light = mix(direct, softCel(direct), 0.5) * sunUp();
  vec3 toned = nightTone(albedo);
  vec3 lit = toned * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = toned * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.3, 0.0, 1.0));
  color += nightLight(albedo, n, vWorld, 0.3, mix(1.0, shadow, uMoonShadow));

  // The selected region glows faintly; region edges draw as soft lines in the overview.
  float selected = 1.0 - step(0.5, abs(vRegion - uSelected));
  color = mix(color, color * vec3(1.1, 1.08, 0.92) + vec3(0.03, 0.03, 0.0), selected * 0.7 * uOutline);
  float edge = clamp(fwidth(vRegion) * 2.0, 0.0, 1.0);
  color = mix(color, color * 1.25 + vec3(0.04), edge * 0.35 * uOutline);

  color = aerial(shoulder(color), vWorld);
  // Past the world's rim the land dissolves into the haze.
  float e = pow(pow(abs(vWorld.x), 4.0) + pow(abs(vWorld.z), 4.0), 0.25);
  float beyond = smoothstep(uHalf + 12.0, uHalf + uSkirt - 20.0, e + (mistNoise(vWorld.xz * 0.05) - 0.5) * 16.0);
  gl_FragColor = vec4(mix(color, aerial(mistAt(vWorld.xz, uTime), vWorld), beyond), 1.0);
}
`;

export interface GroundMesh {
  readonly fine: THREE.Mesh;
  readonly coarse: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  update(t: Terrain): void;
  select(region: number, outline: boolean): void;
}

function geometryFor(t: Terrain, stride: number): THREE.BufferGeometry {
  const { n } = t.lattice;
  const m = Math.floor((n - 1) / stride) + 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(m * m * 3), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(m * m * 3), 3));
  g.setAttribute("aWater", new THREE.BufferAttribute(new Float32Array(m * m), 1));
  g.setAttribute("aRegion", new THREE.BufferAttribute(new Float32Array(m * m), 1));
  const index = new Uint32Array((m - 1) * (m - 1) * 6);
  let k = 0;
  for (let j = 0; j < m - 1; j++) {
    for (let i = 0; i < m - 1; i++) {
      const a = j * m + i;
      const b = a + 1;
      const c = a + m;
      const d = c + 1;
      // Split along b-c, as the lattice's heightAt interpolates.
      index.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.userData.stride = stride;
  return g;
}

function fill(g: THREE.BufferGeometry, t: Terrain): void {
  const { n, heights, origin, spacing } = t.lattice;
  const stride = g.userData.stride as number;
  const m = Math.floor((n - 1) / stride) + 1;
  const pos = g.getAttribute("position").array as Float32Array;
  const nor = g.getAttribute("normal").array as Float32Array;
  const water = g.getAttribute("aWater").array as Float32Array;
  const region = g.getAttribute("aRegion").array as Float32Array;
  const h = (ix: number, iz: number): number =>
    heights[Math.min(n - 1, Math.max(0, iz)) * n + Math.min(n - 1, Math.max(0, ix))] as number;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const ix = i * stride;
      const iz = j * stride;
      const v = j * m + i;
      const y = h(ix, iz);
      pos[v * 3] = origin + ix * spacing;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = origin + iz * spacing;
      const gx = (h(ix + stride, iz) - h(ix - stride, iz)) / (2 * stride * spacing);
      const gz = (h(ix, iz + stride) - h(ix, iz - stride)) / (2 * stride * spacing);
      const len = Math.hypot(gx, 1, gz);
      nor[v * 3] = -gx / len;
      nor[v * 3 + 1] = 1 / len;
      nor[v * 3 + 2] = -gz / len;
      const level = t.waterLevel[iz * n + ix] as number;
      water[v] = level > DRY / 2 ? level - y : -5;
      region[v] = t.region[iz * n + ix] as number;
    }
  }
  for (const name of ["position", "normal", "aWater", "aRegion"]) g.getAttribute(name).needsUpdate = true;
  g.computeBoundingSphere();
}

export function createGround(t: Terrain, light: SceneLight, covers: RegionCovers): GroundMesh {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      ...light,
      ...covers.uniforms,
      uDry: { value: hexToVec3(0xbba878) },
      uBare: { value: hexToVec3(0x9a7d58) },
      uSand: { value: hexToVec3(0xcdbb8a) },
      uBed: { value: hexToVec3(0x6d7a58) },
      uSelected: { value: -1 },
      uOutline: { value: 0 },
      uHalf: { value: t.spec.size / 2 },
      uSkirt: { value: TERRAIN.skirt },
      uHeightRange: { value: new THREE.Vector2(t.report.min, t.report.max) },
    },
  });
  const fine = new THREE.Mesh(geometryFor(t, 1), material);
  const coarse = new THREE.Mesh(geometryFor(t, 4), material);
  const update = (next: Terrain): void => {
    fill(fine.geometry, next);
    fill(coarse.geometry, next);
    (material.uniforms.uHeightRange as { value: THREE.Vector2 }).value.set(next.report.min, next.report.max);
  };
  update(t);
  return {
    fine,
    coarse,
    material,
    update,
    select(region, outline) {
      (material.uniforms.uSelected as { value: number }).value = region;
      (material.uniforms.uOutline as { value: number }).value = outline ? 1 : 0;
    },
  };
}

const MIST_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const MIST_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
${MIST_GLSL}
varying vec3 vWorld;
void main() {
  gl_FragColor = vec4(aerial(mistAt(vWorld.xz, uTime), vWorld), 1.0);
}
`;

/** A wide ring of mist at the skirt's outer height, so the world never shows an edge. */
export function createMist(t: Terrain, light: SceneLight): { mesh: THREE.Mesh; update(t: Terrain): void } {
  const half = t.spec.size / 2;
  // The rim is a rounded square; this inner radius keeps the whole ring past it, even on the diagonals.
  const geometry = new THREE.RingGeometry((half + 20) * Math.SQRT2 ** 0.5, 4000, 128, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, uniforms: { ...light } }));
  mesh.frustumCulled = false;
  const update = (next: Terrain): void => {
    // Just under the lowest ground past the rim, so it never shows through the skirt.
    const { n, heights, origin, spacing } = next.lattice;
    const beyond = next.spec.size / 2 + 12;
    let low = Infinity;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = origin + ix * spacing;
        const z = origin + iz * spacing;
        if (Math.pow(x ** 4 + z ** 4, 0.25) > beyond) low = Math.min(low, heights[iz * n + ix] as number);
      }
    }
    mesh.position.y = low - 0.4;
  };
  update(t);
  return { mesh, update };
}
