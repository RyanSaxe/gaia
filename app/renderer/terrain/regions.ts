// Each region's ground cover, as uniforms the ground and grass shaders share.
// The shaders weigh regions by the baked cover weights (`Terrain.cover`),
// packed four regions to a texture, so the cover drifts across the same wide
// band where the land changes, in the same patches the bake measured.

import * as THREE from "three";
import type { GroundSpec } from "@gaia/schema";
import { type Terrain, type WorldSpec, landRadius } from "@gaia/terrain";

export const MAX_REGIONS = 8;

function weightMap(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

const vectors = <T>(make: () => T): { value: T[] } => ({ value: Array.from({ length: MAX_REGIONS }, make) });

export function createRegionCovers() {
  const uniforms = {
    uRegionCount: { value: 0 },
    /** Regions 0 to 3 and 4 to 7: each one's cover weight per lattice sample. */
    uCoverMapA: { value: weightMap() },
    uCoverMapB: { value: weightMap() },
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
  /** Packs the bake's cover weights into the two textures, once per bake. */
  const weigh = (t: Terrain): void => {
    if (t === weighed) return;
    weighed = t;
    const { n, origin, spacing } = t.lattice;
    const count = t.spec.regions.length;
    const maps = [uniforms.uCoverMapA.value, uniforms.uCoverMapB.value];
    maps.forEach((map, m) => {
      const data = new Uint8Array(n * n * 4);
      for (let i = 0; i < n * n; i++) {
        for (let c = 0; c < 4; c++) {
          const r = m * 4 + c;
          data[i * 4 + c] = r < count ? Math.round((t.cover[i * count + r] as number) * 255) : 0;
        }
      }
      map.image = { data, width: n, height: n };
      map.needsUpdate = true;
    });
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
uniform sampler2D uCoverMapA;
uniform sampler2D uCoverMapB;
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

// coverWeights from @gaia/terrain, as baked per lattice sample: each region's
// share of the cover, drifting in patches across the wide blend band. Past
// the lattice, the land's edge carries on outward.
void coverWeights(vec2 xz, out float w[MAX_REGIONS]) {
  float r = length(xz);
  vec2 p = r > uCoverReach ? xz * (uCoverReach / r) : xz;
  vec2 uv = ((p - uCoverMap.x) / uCoverMap.y + 0.5) / uCoverMap.z;
  vec4 a = texture2D(uCoverMapA, uv);
  vec4 b = texture2D(uCoverMapB, uv);
  w[0] = a.r; w[1] = a.g; w[2] = a.b; w[3] = a.a;
  w[4] = b.r; w[5] = b.g; w[6] = b.b; w[7] = b.a;
}

struct GroundCover { vec3 low; vec3 high; vec3 tip; vec3 soil; float clump; };

// The ground's colors: every region's cover, weighted.
GroundCover groundCoverAt(vec2 xz) {
  float w[MAX_REGIONS];
  coverWeights(xz, w);
  GroundCover c = GroundCover(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), 0.0);
  float total = 0.0;
  for (int i = 0; i < MAX_REGIONS; i++) {
    c.low += w[i] * uCoverLow[i];
    c.high += w[i] * uCoverHigh[i];
    c.tip += w[i] * uCoverTip[i];
    c.soil += w[i] * uCoverSoil[i];
    c.clump += w[i] * uCoverShape[i].w;
    total += w[i];
  }
  float k = 1.0 / max(total, 1e-4);
  return GroundCover(c.low * k, c.high * k, c.tip * k, c.soil * k, c.clump * k);
}

// Each blade grows one region's cover, drawn by weight with its own random
// number, so where covers drift into each other their blades mingle.
int coverPick(vec2 xz, float r) {
  float w[MAX_REGIONS];
  coverWeights(xz, w);
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

// The selected region's share of the cover, for a soft glow that fades at its organic edge.
float coverShare(vec2 xz, int region) {
  float w[MAX_REGIONS];
  coverWeights(xz, w);
  float total = 0.0;
  float mine = 0.0;
  for (int i = 0; i < MAX_REGIONS; i++) {
    total += w[i];
    if (i == region) mine = w[i];
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
