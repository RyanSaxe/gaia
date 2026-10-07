// Each region's ground cover, as uniforms the ground and grass shaders share.
// The shaders weigh regions by the baked cover shares (`Terrain.coverRegions`
// and `coverShares`: each lattice sample's largest few), interpolated between
// samples as the lattice is, so the cover drifts across the same wide band
// where the land changes, in the same patches the bake measured.

import * as THREE from "three";
import type { GroundSpec } from "@gaia/schema";
import { COVER_TAPS, type Terrain, type WorldSpec, landRadius } from "@gaia/terrain";

export const MAX_REGIONS = 32;

/** Four bytes per lattice sample, read whole: the shader interpolates between samples itself. */
function tapMap(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  return t;
}

const vectors = <T>(make: () => T): { value: T[] } => ({ value: Array.from({ length: MAX_REGIONS }, make) });

export function createRegionCovers() {
  const uniforms = {
    uRegionCount: { value: 0 },
    /** Per lattice sample: the regions with the largest shares of the cover, and their shares. */
    uCoverRegions: { value: tapMap() },
    uCoverShares: { value: tapMap() },
    /** The lattice's origin, spacing and samples per side. */
    uCoverMap: { value: new THREE.Vector3() },
    /** Past this radius (the wild land) covers continue outward from the land's edge. */
    uCoverReach: { value: 0 },
    /** Blade lean, roundness and bend. */
    uCoverForm: vectors(() => new THREE.Vector3()),
    uCoverLow: vectors(() => new THREE.Vector3()),
    uCoverHigh: vectors(() => new THREE.Vector3()),
    uCoverTip: vectors(() => new THREE.Vector3()),
    uCoverSoil: vectors(() => new THREE.Vector3()),
    /** Blade height, blade width, density, clump. */
    uCoverShape: vectors(() => new THREE.Vector4()),
    uCoverFlowers: { value: new Array<number>(MAX_REGIONS).fill(0) },
    uFlowerA: vectors(() => new THREE.Vector3()),
    uFlowerB: vectors(() => new THREE.Vector3()),
    uFlowerC: vectors(() => new THREE.Vector3()),
  };
  let weighed: Terrain | null = null;
  /** Hands the bake's cover shares to the two textures as they are, once per bake. */
  const weigh = (t: Terrain): void => {
    if (t === weighed) return;
    weighed = t;
    const { n, origin, spacing } = t.lattice;
    if (COVER_TAPS !== 4) throw new Error("The cover textures hold four regions per lattice sample.");
    for (const [map, data] of [[uniforms.uCoverRegions.value, t.coverRegions], [uniforms.uCoverShares.value, t.coverShares]] as const) {
      map.image = { data, width: n, height: n };
      map.needsUpdate = true;
    }
    uniforms.uCoverMap.value.set(origin, spacing, n);
    uniforms.uCoverReach.value = landRadius(t) - 1;
  };
  return {
    uniforms,
    update(spec: WorldSpec, covers: readonly GroundSpec[], terrain: Terrain): void {
      weigh(terrain);
      if (spec.regions.length > MAX_REGIONS) throw new Error(`The terrain lab draws at most ${MAX_REGIONS} regions; this world has ${spec.regions.length}.`);
      uniforms.uRegionCount.value = spec.regions.length;
      spec.regions.forEach((r, i) => {
        const c = covers[i];
        if (c === undefined) throw new Error(`Region ${r.id} has no ground cover.`);
        uniforms.uCoverForm.value[i]?.set(c.lean, c.round, c.bend);
        uniforms.uCoverLow.value[i]?.set(...c.low);
        uniforms.uCoverHigh.value[i]?.set(...c.high);
        uniforms.uCoverTip.value[i]?.set(...c.tip);
        uniforms.uCoverSoil.value[i]?.set(...c.soil);
        uniforms.uCoverShape.value[i]?.set(c.height, c.width, c.density, c.clump);
        uniforms.uCoverFlowers.value[i] = c.flowers;
        uniforms.uFlowerA.value[i]?.set(...(c.flowerColors[0] ?? c.tip));
        uniforms.uFlowerB.value[i]?.set(...(c.flowerColors[1] ?? c.tip));
        uniforms.uFlowerC.value[i]?.set(...(c.flowerColors[2] ?? c.tip));
      });
    },
  };
}

export type RegionCovers = ReturnType<typeof createRegionCovers>;

export const REGIONS_GLSL = /* glsl */ `
#define MAX_REGIONS ${MAX_REGIONS}
uniform int uRegionCount;
uniform sampler2D uCoverRegions;
uniform sampler2D uCoverShares;
uniform vec3 uCoverMap;
uniform float uCoverReach;
uniform vec3 uCoverForm[MAX_REGIONS];
uniform vec3 uCoverLow[MAX_REGIONS];
uniform vec3 uCoverHigh[MAX_REGIONS];
uniform vec3 uCoverTip[MAX_REGIONS];
uniform vec3 uCoverSoil[MAX_REGIONS];
uniform vec4 uCoverShape[MAX_REGIONS];
uniform float uCoverFlowers[MAX_REGIONS];
uniform vec3 uFlowerA[MAX_REGIONS];
uniform vec3 uFlowerB[MAX_REGIONS];
uniform vec3 uFlowerC[MAX_REGIONS];

// The bake's cover around a point: the four nearest lattice samples' regions
// and shares, each share already weighed by how near its sample is, exactly
// as the lattice interpolates. Past the lattice, the land's edge carries on
// outward.
struct CoverTaps { ivec4 region[4]; vec4 share[4]; };
CoverTaps coverTaps(vec2 xz) {
  float r = length(xz);
  vec2 p = r > uCoverReach ? xz * (uCoverReach / r) : xz;
  vec2 g = clamp((p - uCoverMap.x) / uCoverMap.y, vec2(0.0), vec2(uCoverMap.z - 1.001));
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  CoverTaps c;
  c.region[0] = ivec4(texelFetch(uCoverRegions, i, 0) * 255.0 + 0.5);
  c.region[1] = ivec4(texelFetch(uCoverRegions, i + ivec2(1, 0), 0) * 255.0 + 0.5);
  c.region[2] = ivec4(texelFetch(uCoverRegions, i + ivec2(0, 1), 0) * 255.0 + 0.5);
  c.region[3] = ivec4(texelFetch(uCoverRegions, i + ivec2(1, 1), 0) * 255.0 + 0.5);
  c.share[0] = texelFetch(uCoverShares, i, 0) * ((1.0 - f.x) * (1.0 - f.y));
  c.share[1] = texelFetch(uCoverShares, i + ivec2(1, 0), 0) * (f.x * (1.0 - f.y));
  c.share[2] = texelFetch(uCoverShares, i + ivec2(0, 1), 0) * ((1.0 - f.x) * f.y);
  c.share[3] = texelFetch(uCoverShares, i + ivec2(1, 1), 0) * (f.x * f.y);
  return c;
}

struct GroundCover { vec3 low; vec3 high; vec3 tip; vec3 soil; float clump; };

// The ground's colors: every region's cover, weighted.
GroundCover groundCoverAt(vec2 xz) {
  CoverTaps t = coverTaps(xz);
  GroundCover c = GroundCover(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), 0.0);
  float total = 0.0;
  for (int k = 0; k < 4; k++) {
    for (int j = 0; j < 4; j++) {
      float w = t.share[k][j];
      if (w <= 0.0) continue;
      int i = t.region[k][j];
      c.low += w * uCoverLow[i];
      c.high += w * uCoverHigh[i];
      c.tip += w * uCoverTip[i];
      c.soil += w * uCoverSoil[i];
      c.clump += w * uCoverShape[i].w;
      total += w;
    }
  }
  float inv = 1.0 / max(total, 1e-4);
  return GroundCover(c.low * inv, c.high * inv, c.tip * inv, c.soil * inv, c.clump * inv);
}

// Each blade grows one region's cover, drawn by weight with its own random
// number, so where covers drift into each other their blades mingle. Blades
// are scattered points, so the nearest lattice sample's shares serve; the
// ground's color interpolates between samples instead.
int coverPick(vec2 xz, float r) {
  float d = length(xz);
  vec2 p = d > uCoverReach ? xz * (uCoverReach / d) : xz;
  ivec2 i = ivec2(clamp(floor((p - uCoverMap.x) / uCoverMap.y + 0.5), vec2(0.0), vec2(uCoverMap.z - 1.0)));
  ivec4 region = ivec4(texelFetch(uCoverRegions, i, 0) * 255.0 + 0.5);
  vec4 share = texelFetch(uCoverShares, i, 0);
  float total = dot(share, vec4(1.0));
  float acc = 0.0;
  for (int j = 0; j < 4; j++) {
    acc += share[j];
    if (share[j] > 0.0 && r * total <= acc) return region[j];
  }
  return region[0];
}

// The selected region's share of the cover, for a soft glow that fades at its organic edge.
float coverShare(vec2 xz, int region) {
  CoverTaps t = coverTaps(xz);
  float total = 0.0;
  float mine = 0.0;
  for (int k = 0; k < 4; k++) {
    for (int j = 0; j < 4; j++) {
      float w = t.share[k][j];
      total += w;
      if (t.region[k][j] == region) mine += w;
    }
  }
  return mine / max(total, 1e-4);
}
`;

/** Where tufts grow when a cover is clumped; the same mask places soil on the ground and blades above it. */
export const TUFT_GLSL = /* glsl */ `
float tuftHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tuftNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tuftHash(i), tuftHash(i + vec2(1.0, 0.0)), u.x), mix(tuftHash(i + vec2(0.0, 1.0)), tuftHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float tuftMask(vec2 xz) {
  vec2 p = xz * 0.32 + 7.0;
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * tuftNoise(p); p = rot * p * 2.07 + 17.0; a *= 0.5; }
  return smoothstep(0.42, 0.6, v);
}
`;
