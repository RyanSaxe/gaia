// Keeps the ground's vitality field that the grass, ground and water shaders
// read: a small texture over the land with the vitality of each sample's
// owner, a file's patch or for a lot its area, and of the area the sample lies
// in, which the water follows. Each value has 16 bits in a high byte (red,
// green) and a low byte (blue, alpha), so an easing change moves the grass
// smoothly rather than in 255ths. The bake records each sample's owners
// (`ownershipOf` in @gaia/terrain), so a vitality change only rewrites the
// texture's bytes.

import * as THREE from "three";
import { CHANNEL_MATH } from "@gaia/realize";
import { GROUND_DECLINE, type Ownership, groundDecline, vitalityAt, vitalityOver } from "@gaia/terrain";
import { hexToVec3 } from "@gaia/render";

function fieldTexture(data: Uint8Array, n: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** The field and the colors declining cover turns toward, shared by the ground and the grass. The water reads the field. */
export const vitalityUniforms = {
  uVitalityField: { value: fieldTexture(new Uint8Array([255, 255, 255, 255]), 1) },
  /** The field's origin, meters between its samples, and samples per side. */
  uVitalityMap: { value: new THREE.Vector3(0, 1, 1) },
  /** The straw colors, low, high and tip, that declining cover dries toward. */
  uStrawLow: { value: hexToVec3(0xa38a55) },
  uStrawHigh: { value: hexToVec3(0xd3bb7a) },
  uStrawTip: { value: hexToVec3(0xe8d79e) },
  /** Withered straw, which some blades turn rather than gold. */
  uStrawDead: { value: hexToVec3(0x9e8763) },
  /** Bare earth where declined ground opens. */
  uBareEarth: { value: hexToVec3(0xb69670) },
};

let owned: Ownership | null = null;
/** Each sample's ground and area vitality in exact 255ths, from which the texture's bytes are made. */
let levels = new Float32Array([255, 255]);
let bytes = new Uint8Array([255, 255, 255, 255]);

/** Sets a bake's ownership of the land. With null, all ground has full vitality until `showGroundVitality`. */
export function setGroundOwnership(own: Ownership | null): void {
  owned = own;
  const n = own?.n ?? 1;
  levels = new Float32Array(n * n * 2).fill(255);
  bytes = new Uint8Array(n * n * 4).fill(255);
  const old = vitalityUniforms.uVitalityField.value;
  vitalityUniforms.uVitalityField.value = fieldTexture(bytes, n);
  old.dispose();
  vitalityUniforms.uVitalityMap.value.set(own?.origin ?? 0, own?.spacing ?? 1, n);
}

/**
 * Shows each owner's vitality on its ground (`ground[owner]`) and its area's
 * on the area's water (`area[owner]`). Call it whenever a file's or an area's
 * vitality changes. It rewrites a few hundred kilobytes and never the bake.
 */
export function showGroundVitality(ground: ArrayLike<number>, area: ArrayLike<number>): void {
  if (owned === null) return;
  vitalityOver(owned, ground, levels, 2, 0);
  vitalityOver(owned, area, levels, 2, 1);
  // A texture filters each byte linearly, so the high and low bytes blend into exactly the blend of the 65535ths.
  for (let i = 0; i < levels.length; i++) {
    const v = Math.round((levels[i] as number) * 257);
    bytes[(i >> 1) * 4 + (i & 1)] = v >> 8;
    bytes[(i >> 1) * 4 + 2 + (i & 1)] = v & 255;
  }
  vitalityUniforms.uVitalityField.value.needsUpdate = true;
}

/** The ground's own vitality and its area's at (x, z), as the shaders read them. */
export function groundVitalityAt(x: number, z: number): { ground: number; area: number } {
  if (owned === null) return { ground: 1, area: 1 };
  return { ground: vitalityAt(owned, levels, x, z, 2, 0), area: vitalityAt(owned, levels, x, z, 2, 1) };
}

/** Samples a side of the square `declineAround` reads its disc from. */
const AROUND = 13;

/**
 * How much the ground around (x, z) has declined, from 0 to 1: `groundDecline` of the ground's own vitality, averaged
 * over a disc `radius` meters across with less weight toward the rim, so it changes gradually as the eye moves and at
 * once when vitality does.
 */
export function declineAround(x: number, z: number, radius: number): number {
  if (owned === null) return 0;
  let sum = 0;
  let weight = 0;
  const half = (AROUND - 1) / 2;
  for (let j = 0; j < AROUND; j++) {
    for (let i = 0; i < AROUND; i++) {
      const u = (i - half) / half;
      const w = (j - half) / half;
      const r2 = u * u + w * w;
      if (r2 >= 1) continue;
      const k = (1 - r2) * (1 - r2);
      sum += k * groundDecline(vitalityAt(owned, levels, x + u * radius, z + w * radius, 2, 0));
      weight += k;
    }
  }
  return weight > 0 ? sum / weight : 0;
}

const g = GROUND_DECLINE;

/**
 * GLSL for the vitality field. `landVitality` returns the ground's own
 * vitality in x and its area's in y. `shownVitality` is a copy of
 * @gaia/realize's, and `declineOf` a copy of `groundDecline` in
 * @gaia/terrain. `bareEarth` gives where bare earth shows in declined
 * ground: ragged patches a few meters across that cover more ground as it
 * declines (`groundLook`'s bare share), softened over `edge`. The ground
 * paints these patches, and the grass calls the same function with a wider
 * edge to leave them bare.
 */
export const VITALITY_GLSL = /* glsl */ `
uniform sampler2D uVitalityField;
uniform vec3 uVitalityMap;
uniform vec3 uStrawLow;
uniform vec3 uStrawHigh;
uniform vec3 uStrawTip;
uniform vec3 uStrawDead;
uniform vec3 uBareEarth;
vec2 landVitality(vec2 xz) {
  vec2 uv = ((xz - uVitalityMap.x) / uVitalityMap.y + 0.5) / uVitalityMap.z;
  vec4 t = texture2D(uVitalityField, uv);
  return (t.rg * 65280.0 + t.ba * 255.0) / 65535.0;
}
float shownVitality(float v) { return clamp((v - ${CHANNEL_MATH.shownRuin.toFixed(3)}) / ${(CHANNEL_MATH.shownWhole - CHANNEL_MATH.shownRuin).toFixed(3)}, 0.0, 1.0); }
float declineOf(float v) { return 1.0 - smoothstep(${g.to.toFixed(3)}, ${g.from.toFixed(3)}, shownVitality(v)); }
float vitalHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vitalNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vitalHash(i), vitalHash(i + vec2(1.0, 0.0)), u.x), mix(vitalHash(i + vec2(0.0, 1.0)), vitalHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float bareEarth(vec2 xz, float decline, float edge) {
  float t = clamp((decline - ${g.bareFrom.toFixed(3)}) / ${(1 - g.bareFrom).toFixed(3)}, 0.0, 1.0);
  float share = ${g.bare.toFixed(3)} * t * t * (3.0 - 2.0 * t);
  if (share <= 0.0) return 0.0;
  // Broad patches with ragged edges, stretched toward an even spread so the share opened follows the decline.
  vec2 p = xz * 0.17 + 61.0;
  float n = vitalNoise(p) * 0.62 + vitalNoise(p * 2.3 + 17.0) * 0.28 + vitalNoise(p * 6.1 - 9.0) * 0.1;
  n = smoothstep(0.2, 0.8, n);
  // The first patches open gently rather than all at once where the noise peaks.
  return smoothstep(1.0 - share - edge, 1.0 - share + edge, n) * min(1.0, share * 10.0);
}
`;
