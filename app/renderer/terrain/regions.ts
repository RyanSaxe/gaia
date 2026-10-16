// Each region's ground cover, as uniforms the ground and grass shaders share.
// The shaders weigh regions by the baked cover shares (`Terrain.coverRegions`
// and `coverShares`: each lattice sample's largest few), interpolated between
// samples as the lattice is, so the cover drifts across the same wide band
// where the land changes, in the same patches the bake measured. The shares
// ride in the land's clipmap (`CLIP` in ground.ts), baked with the land's
// chunks (`land-chunks.ts`). The last two slots hold the wild's own two
// covers, which grow past the land.

import * as THREE from "three";
import type { GroundSpec } from "@gaia/schema";
import { type Terrain, type WorldSpec, landRadius } from "@gaia/terrain";

export const MAX_REGIONS = 32;
/** The slots of the wild's two covers, after every region's. */
const WILD_SLOTS = [MAX_REGIONS - 2, MAX_REGIONS - 1] as const;

const vectors = <T>(make: () => T): { value: T[] } => ({ value: Array.from({ length: MAX_REGIONS }, make) });

export function createRegionCovers() {
  const uniforms = {
    uRegionCount: { value: 0 },
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
  const setSlot = (i: number, c: GroundSpec): void => {
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
  };
  return {
    uniforms,
    update(spec: WorldSpec, covers: readonly GroundSpec[], terrain: Terrain): void {
      uniforms.uCoverReach.value = landRadius(terrain) - 1;
      if (spec.regions.length > WILD_SLOTS[0]) throw new Error(`The terrain lab draws at most ${WILD_SLOTS[0]} regions; this world has ${spec.regions.length}.`);
      uniforms.uRegionCount.value = spec.regions.length;
      spec.regions.forEach((r, i) => {
        const c = covers[i];
        if (c === undefined) throw new Error(`Region ${r.id} has no ground cover.`);
        setSlot(i, c);
      });
    },
    /** The wild's two covers: what grows past the land, mingled in patches. */
    wild(covers: readonly [GroundSpec, GroundSpec]): void {
      setSlot(WILD_SLOTS[0], covers[0]);
      setSlot(WILD_SLOTS[1], covers[1]);
    },
  };
}

export type RegionCovers = ReturnType<typeof createRegionCovers>;

/** GLSL: the covers, read from the land's clipmap. Needs the ground texture's uniforms (GROUND_SAMPLE_GLSL) declared first. */
export const REGIONS_GLSL = /* glsl */ `
#define MAX_REGIONS ${MAX_REGIONS}
uniform int uRegionCount;
uniform highp sampler2DArray uCoverRegions;
uniform highp sampler2DArray uCoverShares;
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

struct GroundCover { vec3 low; vec3 high; vec3 tip; vec3 soil; float clump; };
GroundCover mixCover(GroundCover a, GroundCover b, float t) {
  return GroundCover(mix(a.low, b.low, t), mix(a.high, b.high, t), mix(a.tip, b.tip, t), mix(a.soil, b.soil, t), mix(a.clump, b.clump, t));
}

// Where a point's cover is read, on the lattice (clipLattice): past the
// land's radius, the land's edge carries on outward; past the lattice, the
// lattice's edge.
vec2 coverPoint(vec2 xz) {
  float r = length(xz);
  return clipLattice(r > uCoverReach ? xz * (uCoverReach / r) : xz);
}
ivec4 coverRegionsAt(ivec2 i, int level) { return ivec4(texelFetch(uCoverRegions, clipAt(i, level), 0) * 255.0 + 0.5); }
vec4 coverSharesAt(ivec2 i, int level) { return texelFetch(uCoverShares, clipAt(i, level), 0); }

// The bake's cover around a point of clip level k: the four nearest samples'
// regions and shares, each share already weighed by how near its sample is,
// exactly as the lattice interpolates.
struct CoverTaps { ivec4 region[4]; vec4 share[4]; };
CoverTaps coverTaps(vec2 p, int level) {
  vec2 g = clipLatticeGrid(p, level);
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  CoverTaps c;
  c.region[0] = coverRegionsAt(i, level);
  c.region[1] = coverRegionsAt(i + ivec2(1, 0), level);
  c.region[2] = coverRegionsAt(i + ivec2(0, 1), level);
  c.region[3] = coverRegionsAt(i + ivec2(1, 1), level);
  c.share[0] = coverSharesAt(i, level) * ((1.0 - f.x) * (1.0 - f.y));
  c.share[1] = coverSharesAt(i + ivec2(1, 0), level) * (f.x * (1.0 - f.y));
  c.share[2] = coverSharesAt(i + ivec2(0, 1), level) * ((1.0 - f.x) * f.y);
  c.share[3] = coverSharesAt(i + ivec2(1, 1), level) * (f.x * f.y);
  return c;
}

// The ground's colors at a point of level k: every region's cover, weighted.
GroundCover coverAtLevel(vec2 p, int level) {
  CoverTaps t = coverTaps(p, level);
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
GroundCover groundCoverAt(vec2 xz) {
  vec2 p = coverPoint(xz);
  float a;
  int k = clipLevel(clipWorld(p), a);
  GroundCover c = coverAtLevel(p, k);
  if (a > 0.0) c = mixCover(c, coverAtLevel(p, k + 1), a);
  return c;
}

// Each blade grows one region's cover, drawn by weight with its own random
// number, so where covers drift into each other their blades mingle. Blades
// are scattered points, so the nearest lattice sample's shares serve, from
// the finest level that holds it; the ground's color interpolates between
// samples instead.
int coverPick(vec2 xz, float r) {
  vec2 p = coverPoint(xz);
  int k = clipNearest(clipWorld(p));
  ivec2 i = ivec2(floor(clipLatticeGrid(p, k) + 0.5));
  ivec4 region = coverRegionsAt(i, k);
  vec4 share = coverSharesAt(i, k);
  float total = dot(share, vec4(1.0));
  float acc = 0.0;
  for (int j = 0; j < 4; j++) {
    acc += share[j];
    if (share[j] > 0.0 && r * total <= acc) return region[j];
  }
  return region[0];
}

// The wild's two covers, after every region's.
#define WILD_A ${WILD_SLOTS[0]}
#define WILD_B ${WILD_SLOTS[1]}
GroundCover coverOf(int i) { return GroundCover(uCoverLow[i], uCoverHigh[i], uCoverTip[i], uCoverSoil[i], uCoverShape[i].w); }
// The wild's cover at a point, from its patch: 0 is the first cover, 1 the second.
GroundCover wildCover(float share) { return mixCover(coverOf(WILD_A), coverOf(WILD_B), share); }
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
