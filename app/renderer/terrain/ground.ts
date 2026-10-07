// The baked lattice as Three.js: the ground around the person as nested
// rings that follow them, a coarse whole-world mesh for the overview and the
// water's mirror, the wild land past the rim, a float texture of the lattice
// for every shader that stands on the ground, and the painterly ground
// material, colored by each region's ground cover.
//
// The rings never change shape on the CPU: each is a fixed grid, and its
// vertex shader reads heights from the lattice texture. Every ring's vertices
// are lattice samples, each coarser ring's a strict subset of the finer one's.
// Toward its outer edge a ring morphs, by the person's distance, into exactly
// the next ring's surface (the lattice's own triangle split makes the fine
// triangles lie on the coarse ones), so where rings meet there is no seam,
// and as the person walks and the rings follow, no vertex ever jumps.

import * as THREE from "three";
import { LIGHT_GLSL, type SceneLight, hexToVec3 } from "@gaia/render";
import { SHORE_CAP, TRAILS, type Terrain, type WildsRing, landRadius, wildsRing } from "@gaia/terrain";
import { SWARD_GLSL } from "../world/environment.ts";
import { REGIONS_GLSL, type RegionCovers, TUFT_GLSL } from "./regions.ts";
import { TRAIL_GLSL, trailWear } from "./trails.ts";

/** Height, water level, distance to the water and to the nearest trail's edge per lattice sample, for shaders that sample the ground. */
export interface GroundTexture {
  readonly texture: THREE.DataTexture;
  readonly uniforms: {
    readonly uGround: { value: THREE.DataTexture };
    readonly uGroundN: { value: number };
    readonly uGroundOrigin: { value: number };
    readonly uGroundSpacing: { value: number };
  };
  /** Takes on a new bake; `packed` is the texture's data, trails included, when a bake thread packed it already. */
  update(t: Terrain, packed?: Float32Array): void;
  /** The trail field from `trailField`, or null for no trails. */
  setTrails(field: Float32Array | null): void;
}

export function createGroundTexture(t: Terrain): GroundTexture {
  let { n } = t.lattice;
  let data: Float32Array = new Float32Array(n * n * 4);
  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  const uniforms = {
    uGround: { value: texture },
    uGroundN: { value: n },
    uGroundOrigin: { value: t.lattice.origin },
    uGroundSpacing: { value: t.lattice.spacing },
  };
  const update = (next: Terrain, packed?: Float32Array): void => {
    // A world of another size: a texture of its size.
    if (next.lattice.n !== n || next.lattice.origin !== uniforms.uGroundOrigin.value) {
      n = next.lattice.n;
      data = new Float32Array(n * n * 4).fill(TRAILS.reach);
      texture.dispose();
      texture.image = { data, width: n, height: n };
      uniforms.uGroundN.value = n;
      uniforms.uGroundOrigin.value = next.lattice.origin;
    }
    if (packed !== undefined && packed.length === n * n * 4) {
      data = packed;
      texture.image = { data, width: n, height: n };
      texture.needsUpdate = true;
      return;
    }
    const heights = next.lattice.heights;
    const water = next.waterLevel;
    const shore = next.shore;
    for (let i = 0, j = 0; i < n * n; i++, j += 4) {
      data[j] = heights[i] as number;
      data[j + 1] = water[i] as number;
      data[j + 2] = shore[i] as number;
    }
    texture.needsUpdate = true;
  };
  const setTrails = (field: Float32Array | null): void => {
    for (let i = 0; i < n * n; i++) data[i * 4 + 3] = field?.[i] ?? TRAILS.reach;
    texture.needsUpdate = true;
  };
  update(t);
  setTrails(null);
  return { texture, uniforms, update, setTrails };
}

/** GLSL that reads the ground texture with the mesh's own triangle interpolation. */
export const GROUND_SAMPLE_GLSL = /* glsl */ `
uniform sampler2D uGround;
uniform float uGroundN;
uniform float uGroundOrigin;
uniform float uGroundSpacing;
// Height, water level, distance to the water and signed distance to a trail's edge (x, y, z, w).
vec4 groundSample4(vec2 xz) {
  vec2 g = clamp((xz - uGroundOrigin) / uGroundSpacing, vec2(0.0), vec2(uGroundN - 1.001));
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  vec4 h00 = texelFetch(uGround, i, 0);
  vec4 h10 = texelFetch(uGround, i + ivec2(1, 0), 0);
  vec4 h01 = texelFetch(uGround, i + ivec2(0, 1), 0);
  vec4 h11 = texelFetch(uGround, i + ivec2(1, 1), 0);
  if (f.x + f.y <= 1.0) return h00 + f.x * (h10 - h00) + f.y * (h01 - h00);
  return h11 + (1.0 - f.x) * (h01 - h11) + (1.0 - f.y) * (h10 - h11);
}
vec3 groundSample(vec2 xz) { return groundSample4(xz).xyz; }
vec2 groundAt(vec2 xz) { return groundSample(xz).xy; }
`;

/** The rings around the person: how many, and how many quads on a side each. */
export const RINGS = {
  levels: 5,
  /** Quads per side of every ring; ring k's quads are 2^k lattice spacings wide, so it reaches 2^k * 128 m each way. */
  quads: 256,
  /** Quad size of the whole-world mesh the overview and the water's mirror draw, in lattice spacings. */
  coarse: 4,
} as const;

/** The rings' center moves in steps of the coarsest ring's quad, so every ring's grid stays on its own lattice samples. */
const SNAP = 2 ** (RINGS.levels - 1);

const VERT = /* glsl */ `
varying float vTrail;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vWater;
varying float vShore;
#ifdef WILDS
attribute float aWater;
attribute float aShore;
attribute float aTrail;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normal;
  vWater = aWater;
  vShore = aShore;
  vTrail = aTrail;
  gl_Position = projectionMatrix * viewMatrix * world;
}
#else
// position: a vertex's column and row on its ring's grid, and the ring.
uniform sampler2D uGround;
uniform float uGroundN;
uniform float uGroundOrigin;
uniform float uGroundSpacing;
uniform vec2 uCenter;
uniform vec2 uViewer;
uniform float uBase;
uniform float uMorph;
uniform float uQuads;
uniform float uLevels;
uniform float uSnap;

// Height, water level, distance to water and to a trail's edge at a lattice sample.
vec4 latticeAt(vec2 xz) {
  vec2 g = clamp(floor((xz - uGroundOrigin) / uGroundSpacing + 0.5), vec2(0.0), vec2(uGroundN - 1.0));
  return texelFetch(uGround, ivec2(g), 0);
}

struct GroundVertex { float y; float water; float shore; float trail; vec3 normal; };

// A vertex on a grid of quads s meters wide: its height, water depth, shore
// and trail distances, and the normal from its grid neighbors.
GroundVertex vertexAt(vec2 q, float s) {
  vec4 c = latticeAt(q);
  float gx = (latticeAt(q + vec2(s, 0.0)).x - latticeAt(q - vec2(s, 0.0)).x) / (2.0 * s);
  float gz = (latticeAt(q + vec2(0.0, s)).x - latticeAt(q - vec2(0.0, s)).x) / (2.0 * s);
  return GroundVertex(c.x, c.y > -500.0 ? c.y - c.x : -5.0, c.z, c.w, normalize(vec3(-gx, 1.0, -gz)));
}

void main() {
  float s = uBase * exp2(position.y);
  vec2 p = uCenter + position.xz * s;
  GroundVertex v = vertexAt(p, s);
  float y = v.y;
  float water = v.water;
  float shore = v.shore;
  float trail = v.trail;
  vec3 n = v.normal;
  if (uMorph > 0.5 && position.y < uLevels - 1.5) {
    // Fully the next ring's surface wherever the next ring could take over
    // once the rings move, and not at all where the inner ring could.
    float reach = uQuads * 0.5 * s;
    float d = max(abs(p.x - uViewer.x), abs(p.y - uViewer.y));
    float start = position.y < 0.5 ? reach * 0.5 : reach * 0.5 + uSnap * 0.5;
    float a = smoothstep(start, reach - uSnap * 0.5, d);
    if (a > 0.0) {
      // The next ring's surface here: its vertex, or the middle of its edge or
      // of its cell's diagonal, which runs as the lattice splits its cells.
      vec2 odd = mod(position.xz, 2.0);
      vec2 e = odd.x > 0.5 && odd.y > 0.5 ? vec2(s, -s) : odd.x > 0.5 ? vec2(s, 0.0) : odd.y > 0.5 ? vec2(0.0, s) : vec2(0.0);
      GroundVertex c0 = vertexAt(p + e, 2.0 * s);
      GroundVertex c1 = vertexAt(p - e, 2.0 * s);
      y = mix(y, 0.5 * (c0.y + c1.y), a);
      water = mix(water, 0.5 * (c0.water + c1.water), a);
      shore = mix(shore, 0.5 * (c0.shore + c1.shore), a);
      trail = mix(trail, 0.5 * (c0.trail + c1.trail), a);
      n = mix(n, 0.5 * (c0.normal + c1.normal), a);
    }
  }
  vec4 world = vec4(p.x, y, p.y, 1.0);
  vWorld = world.xyz;
  vNormal = n;
  vWater = water;
  vShore = shore;
  vTrail = trail;
  gl_Position = projectionMatrix * viewMatrix * world;
}
#endif
`;

const FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
${REGIONS_GLSL}
${TUFT_GLSL}
${GROUND_SAMPLE_GLSL}
${TRAIL_GLSL}
uniform vec3 uTrailEarth;
varying float vTrail;
uniform vec3 uDry;
uniform vec3 uBare;
uniform vec3 uSand;
uniform vec3 uBed;
uniform float uSelected;
uniform float uOutline;
uniform float uLand;
uniform vec2 uHeightRange;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vWater;
varying float vShore;
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
${SWARD_GLSL}
void main() {
#ifndef WILDS
  // Past the hand-over circle the wild land takes over.
  if (length(vWorld.xz) > uLand) discard;
#endif
  vec3 n = normalize(vNormal);
  float broad = fbm(vWorld.xz * 0.045);
  float fine = fbm(vWorld.xz * 0.6);
  // The regions' covers, blended where their heights blend. Low ground is
  // lush and deep; high ground is lighter and drier.
  GroundCover cover = groundCoverAt(vWorld.xz);
  float rel = clamp((vWorld.y - uHeightRange.x) / max(1.0, uHeightRange.y - uHeightRange.x), 0.0, 1.0);
  vec3 albedo = sward(vWorld, cover.low, cover.high, cover.tip, (broad - 0.5) * 0.5 + (rel - 0.4) * 0.45);
  // A clumped cover leaves its own soil showing between the tufts.
  albedo = mix(cover.soil, albedo, mix(1.0, tuftMask(vWorld.xz) * 0.75, cover.clump));
  albedo = mix(albedo, uDry, smoothstep(0.6, 0.82, fbm(vWorld.xz * 0.08 + 40.0) + rel * 0.18) * 0.28);
  // Bare earth shows on steep risers and banks.
  float steep = 1.0 - n.y;
  albedo = mix(albedo, uBare, smoothstep(0.075, 0.17, steep + (fine - 0.5) * 0.05) * 0.8);
  // Hollows hold a deeper green; the broad patches carry more contrast.
  albedo *= 0.94 + 0.12 * smoothstep(0.2, 0.8, broad);
  // Sand banks a meter or two wide, darker and wet at the waterline, with a
  // ragged edge where the grass (which reads the same distance) thins out.
  float sand = 1.0 - smoothstep(1.2, 2.6, vShore + (fine - 0.5) * 1.2);
  albedo = mix(albedo, uSand * mix(0.82, 1.0, smoothstep(0.2, 1.0, vShore)), sand * 0.85);
  // Trails: worn earth with a ragged, grassy edge, darker and smoother down
  // the trodden middle, with a dulled, trampled margin just outside.
  // The finest ring's vertices are the lattice's own samples, so its varying
  // is exact; the coarse overview mesh reads the texture at full resolution.
#ifdef TRAIL_TEXTURE
  float edge = trailAt(vWorld.xz);
#else
  float edge = vTrail;
#endif
  if (edge < 2.0 && uTrailWear > 0.0) {
    float ragged = (fine - 0.5) * 0.8 + (noise(vWorld.xz * 2.3) - 0.5) * 0.45;
    float tread = (1.0 - smoothstep(-0.4, 0.35, edge + ragged * (0.6 + 0.5 * (1.0 - uTrailWear)))) * uTrailWear;
    vec3 earth = mix(uTrailEarth, cover.soil, 0.22) * (0.88 + 0.22 * fine);
    earth *= 1.0 - 0.12 * (1.0 - smoothstep(-0.9, -0.25, edge));
    earth = mix(earth, earth * 1.22 + 0.03, step(0.8, noise(vWorld.xz * 7.0)) * 0.6);
    albedo = mix(albedo, earth, tread);
    float margin = (1.0 - smoothstep(0.0, 1.6, edge + ragged)) * (1.0 - tread) * 0.4 * uTrailWear;
    albedo = mix(albedo, mix(albedo, uDry, 0.55), margin);
  }
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

#ifndef WILDS
  // In the overview the selected region's ground glows faintly, by its share
  // of the cover, so the glow fades out at its organic edge. No lines anywhere.
  // At night the glow stays fainter still, so it never reads as a lit field.
  if (uOutline > 0.0 && uSelected >= 0.0) {
    float mine = smoothstep(0.2, 0.9, coverShare(vWorld.xz, int(uSelected + 0.5)));
    color = mix(color, color * vec3(1.08, 1.07, 0.94) + vec3(0.025, 0.025, 0.0), mine * 0.8 * uOutline * (1.0 - uNightness * 0.6));
  }
#endif
  gl_FragColor = vec4(aerial(shoulder(color), vWorld), 1.0);
}
`;

export interface GroundMesh {
  /** The ground around the person, as nested rings that follow them. */
  readonly fine: THREE.Mesh;
  /** The whole lattice, coarsely, for the overview and the water's mirror. */
  readonly coarse: THREE.Mesh;
  /** Wild land past the rim, out to where distance dissolves it into the sky. */
  readonly wilds: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** Takes on a new bake; `wilds` is its wild ring when a bake thread made it already. */
  update(t: Terrain, wilds?: WildsRing): void;
  select(region: number, outline: boolean): void;
  /** Centers the rings on the person; call every frame they walk. */
  follow(x: number, z: number): void;
}

/** A grid of quads, `quads` on a side around its center, as columns and rows; `keep` says which quads to draw. */
function grid(quads: number, level: number, keep: (i: number, j: number) => boolean, into: { pos: number[]; index: number[] }): void {
  const first = into.pos.length / 3;
  const side = quads + 1;
  const h = quads / 2;
  for (let j = 0; j <= quads; j++) for (let i = 0; i <= quads; i++) into.pos.push(i - h, level, j - h);
  for (let j = 0; j < quads; j++) {
    for (let i = 0; i < quads; i++) {
      if (!keep(i - h, j - h)) continue;
      const a = first + j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      // Split along b-c, as the lattice's heightAt interpolates.
      into.index.push(a, c, b, b, c, d);
    }
  }
}

function meshOf(pos: number[], index: number[], material: THREE.ShaderMaterial): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  const mesh = new THREE.Mesh(g, material);
  // The vertex shader places every vertex; the grid's own positions mean nothing to culling.
  mesh.frustumCulled = false;
  return mesh;
}

/** The rings: ring 0 whole, each ring after it with a hole where the ring inside it lies. */
function ringsMesh(material: THREE.ShaderMaterial): THREE.Mesh {
  const into = { pos: [] as number[], index: [] as number[] };
  const q = RINGS.quads;
  for (let level = 0; level < RINGS.levels; level++) {
    grid(q, level, (i, j) => level === 0 || !(i >= -q / 4 && i < q / 4 && j >= -q / 4 && j < q / 4), into);
  }
  return meshOf(into.pos, into.index, material);
}

/** The wild ring as geometry the ground material can draw: no water anywhere near. */
function wildsGeometry(t: Terrain, made?: WildsRing): THREE.BufferGeometry {
  const ring = made ?? wildsRing(t);
  const count = ring.positions.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(ring.positions, 3));
  g.setAttribute("aWater", new THREE.BufferAttribute(new Float32Array(count).fill(-5), 1));
  g.setAttribute("aShore", new THREE.BufferAttribute(new Float32Array(count).fill(SHORE_CAP), 1));
  g.setAttribute("aTrail", new THREE.BufferAttribute(new Float32Array(count).fill(TRAILS.reach), 1));
  g.setIndex(new THREE.BufferAttribute(ring.indices, 1));
  g.computeVertexNormals();
  return g;
}

export function createGround(t: Terrain, light: SceneLight, covers: RegionCovers, tex: GroundTexture): GroundMesh {
  const uniforms = {
    ...light,
    ...covers.uniforms,
    ...tex.uniforms,
    uTrailWear: trailWear,
    uTrailEarth: { value: hexToVec3(0x9c8462) },
    uDry: { value: hexToVec3(0xbba878) },
    uBare: { value: hexToVec3(0x9a7d58) },
    uSand: { value: hexToVec3(0xcdbb8a) },
    uBed: { value: hexToVec3(0x6d7a58) },
    uSelected: { value: -1 },
    uOutline: { value: 0 },
    uLand: { value: landRadius(t) },
    uHeightRange: { value: new THREE.Vector2(t.report.min, t.report.max) },
    uQuads: { value: RINGS.quads },
    uLevels: { value: RINGS.levels },
    uSnap: { value: SNAP * t.lattice.spacing },
  };
  const ringUniforms = { ...uniforms, uCenter: { value: new THREE.Vector2() }, uViewer: { value: new THREE.Vector2() }, uBase: { value: t.lattice.spacing }, uMorph: { value: 1 } };
  const coarseUniforms = { ...uniforms, uCenter: { value: new THREE.Vector2() }, uViewer: { value: new THREE.Vector2() }, uBase: { value: t.lattice.spacing * RINGS.coarse }, uMorph: { value: 0 } };
  const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: ringUniforms });
  const fine = ringsMesh(material);
  // The overview's coarse grid reads the trails from the texture at full resolution.
  const coarseMaterial = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: coarseUniforms, defines: { TRAIL_TEXTURE: "" } });
  // The whole lattice: the same grid, one level, centered on the world.
  const coarseOf = (l: Terrain["lattice"]): THREE.Mesh => {
    const quads = 2 * Math.ceil(((l.n - 1) * l.spacing) / (2 * RINGS.coarse * l.spacing));
    const into = { pos: [] as number[], index: [] as number[] };
    grid(quads, 0, () => true, into);
    return meshOf(into.pos, into.index, coarseMaterial);
  };
  const coarse = coarseOf(t.lattice);
  let coarseN = t.lattice.n;
  const wilds = new THREE.Mesh(
    wildsGeometry(t),
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, defines: { WILDS: "" } }),
  );
  wilds.frustumCulled = false;
  const update = (next: Terrain, made?: WildsRing): void => {
    if (next.lattice.n !== coarseN) {
      coarseN = next.lattice.n;
      coarse.geometry.dispose();
      coarse.geometry = coarseOf(next.lattice).geometry;
    }
    wilds.geometry.dispose();
    wilds.geometry = wildsGeometry(next, made);
    uniforms.uHeightRange.value.set(next.report.min, next.report.max);
    uniforms.uLand.value = landRadius(next);
  };
  update(t);
  const snap = SNAP * t.lattice.spacing;
  return {
    fine,
    coarse,
    wilds,
    material,
    update,
    select(region, outline) {
      uniforms.uSelected.value = region;
      uniforms.uOutline.value = outline ? 1 : 0;
    },
    follow(x, z) {
      ringUniforms.uViewer.value.set(x, z);
      ringUniforms.uCenter.value.set(Math.round(x / snap) * snap, Math.round(z / snap) * snap);
    },
  };
}
