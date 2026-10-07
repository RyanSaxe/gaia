// Each region's ground cover, as uniforms the ground and grass shaders share.
// The shaders weigh regions by the rule that blends their heights, so the
// cover changes across the same band where the land changes.

import * as THREE from "three";
import type { GroundSpec } from "@gaia/schema";
import { TERRAIN, type WorldSpec } from "@gaia/terrain";

export const MAX_REGIONS = 8;

const vectors = <T>(make: () => T): { value: T[] } => ({ value: Array.from({ length: MAX_REGIONS }, make) });

export function createRegionCovers() {
  const uniforms = {
    uRegionCount: { value: 0 },
    uRegionBlend: { value: TERRAIN.blend },
    uRegionCenter: vectors(() => new THREE.Vector2()),
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
  return {
    uniforms,
    update(spec: WorldSpec, covers: readonly GroundSpec[]): void {
      if (spec.regions.length > MAX_REGIONS) throw new Error(`The terrain lab draws at most ${MAX_REGIONS} regions; this world has ${spec.regions.length}.`);
      uniforms.uRegionCount.value = spec.regions.length;
      spec.regions.forEach((r, i) => {
        const c = covers[i];
        if (c === undefined) throw new Error(`Region ${r.id} has no ground cover.`);
        uniforms.uRegionCenter.value[i]?.set(r.x, r.z);
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
uniform float uRegionBlend;
uniform vec2 uRegionCenter[MAX_REGIONS];
uniform vec3 uCoverLow[MAX_REGIONS];
uniform vec3 uCoverHigh[MAX_REGIONS];
uniform vec3 uCoverTip[MAX_REGIONS];
uniform vec3 uCoverSoil[MAX_REGIONS];
uniform vec4 uCoverShape[MAX_REGIONS];
uniform float uCoverFlowers[MAX_REGIONS];
uniform vec3 uFlowerA[MAX_REGIONS];
uniform vec3 uFlowerB[MAX_REGIONS];
uniform vec3 uFlowerC[MAX_REGIONS];

// regionWeights from @gaia/terrain: 1 for the nearest region, falling to 0
// across the blend band. Heights blend by exactly these weights.
void regionWeights(vec2 xz, out float w[MAX_REGIONS]) {
  float nearest = 1e9;
  for (int i = 0; i < MAX_REGIONS; i++) {
    w[i] = i < uRegionCount ? distance(xz, uRegionCenter[i]) : 1e9;
    nearest = min(nearest, w[i]);
  }
  for (int i = 0; i < MAX_REGIONS; i++) {
    float t = clamp((w[i] - nearest) / uRegionBlend, 0.0, 1.0);
    w[i] = i < uRegionCount ? 1.0 - t * t * (3.0 - 2.0 * t) : 0.0;
  }
}

struct GroundCover { vec3 low; vec3 high; vec3 soil; float clump; };

// The ground's colors: every region's cover, weighted.
GroundCover groundCoverAt(vec2 xz) {
  float w[MAX_REGIONS];
  regionWeights(xz, w);
  GroundCover c = GroundCover(vec3(0.0), vec3(0.0), vec3(0.0), 0.0);
  float total = 0.0;
  for (int i = 0; i < MAX_REGIONS; i++) {
    c.low += w[i] * uCoverLow[i];
    c.high += w[i] * uCoverHigh[i];
    c.soil += w[i] * uCoverSoil[i];
    c.clump += w[i] * uCoverShape[i].w;
    total += w[i];
  }
  float k = 1.0 / max(total, 1e-4);
  return GroundCover(c.low * k, c.high * k, c.soil * k, c.clump * k);
}

// Each blade grows one region's cover, drawn by weight with its own random
// number, so across the band the mix of blades shifts from one cover to the next.
int coverPick(vec2 xz, float r) {
  float w[MAX_REGIONS];
  regionWeights(xz, w);
  float total = 0.0;
  for (int i = 0; i < MAX_REGIONS; i++) total += w[i];
  float acc = 0.0;
  int pick = 0;
  for (int i = 0; i < MAX_REGIONS; i++) {
    acc += w[i];
    if (w[i] > 0.0 && r * total <= acc) { pick = i; break; }
  }
  return pick;
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
