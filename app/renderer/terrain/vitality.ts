// The ground's vitality as the grass, the ground and the water read it: a
// small texture over the land whose red channel is the vitality of whatever
// owns the ground there (a file's patch, or on a lot its area's) and whose
// green is the vitality of the area that ground lies in, which water
// follows. The bake says whose ground each sample is (`ownershipOf` in
// @gaia/terrain); `showGroundVitality` weighs each owner's vitality by its
// share (`vitalityOver`), so a change in vitality rewrites the texture's
// bytes and nothing rebakes. Past the land the ground is the wild's and
// always thrives.

import * as THREE from "three";
import { GROUND_DECLINE, type Ownership, vitalityAt, vitalityOver } from "@gaia/terrain";
import { hexToVec3 } from "@gaia/render";

function fieldTexture(data: Uint8Array, n: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, THREE.RGFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  // Rows of two bytes a sample need not fill whole words.
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** The field and the colors decline turns the cover toward, shared by the ground and the grass; the water reads the field. */
export const vitalityUniforms = {
  uVitalityField: { value: fieldTexture(new Uint8Array([255, 255]), 1) },
  /** The field's origin, meters between its samples, and samples per side. */
  uVitalityMap: { value: new THREE.Vector3(0, 1, 1) },
  /** Straw, low to high to tip: what the cover dries toward. */
  uStrawLow: { value: hexToVec3(0xa38a55) },
  uStrawHigh: { value: hexToVec3(0xd3bb7a) },
  uStrawTip: { value: hexToVec3(0xe8d79e) },
  /** Withered straw, which some blades turn rather than gold. */
  uStrawDead: { value: hexToVec3(0x9e8763) },
  /** Bare earth where declined ground opens. */
  uBareEarth: { value: hexToVec3(0xb69670) },
};

let owned: Ownership | null = null;
let bytes = new Uint8Array([255, 255]);

/** Takes on a bake's ownership of the land, or none: then all ground thrives until `showGroundVitality`. */
export function setGroundOwnership(own: Ownership | null): void {
  owned = own;
  const n = own?.n ?? 1;
  bytes = new Uint8Array(n * n * 2).fill(255);
  const old = vitalityUniforms.uVitalityField.value;
  vitalityUniforms.uVitalityField.value = fieldTexture(bytes, n);
  old.dispose();
  vitalityUniforms.uVitalityMap.value.set(own?.origin ?? 0, own?.spacing ?? 1, n);
}

/**
 * Shows each owner's vitality on its ground (`ground[owner]`) and its area's
 * on the area's water (`area[owner]`). Call it again whenever a file's or an
 * area's vitality changes; it rewrites a few hundred kilobytes, never the bake.
 */
export function showGroundVitality(ground: ArrayLike<number>, area: ArrayLike<number>): void {
  if (owned === null) return;
  vitalityOver(owned, ground, bytes, 2, 0);
  vitalityOver(owned, area, bytes, 2, 1);
  vitalityUniforms.uVitalityField.value.needsUpdate = true;
}

/** The ground's own vitality and its area's at (x, z), as the shaders read them. */
export function groundVitalityAt(x: number, z: number): { ground: number; area: number } {
  if (owned === null) return { ground: 1, area: 1 };
  return { ground: vitalityAt(owned, bytes, x, z, 2, 0), area: vitalityAt(owned, bytes, x, z, 2, 1) };
}

const g = GROUND_DECLINE;

/**
 * GLSL: the field (`landVitality`: the ground's own vitality in x, its
 * area's in y), how far ground of a vitality has declined (`declineOf`, the
 * twin of `groundDecline` in @gaia/terrain), and where bare earth opens in
 * declined ground (`bareEarth`): patches a few meters across, ragged at
 * their edges, opening over more of the ground as it declines
 * (`groundLook`'s bare share), softened over `edge`. The ground paints the
 * patches and the grass thins out across a wider edge and leaves them bare,
 * from the same function.
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
  return texture2D(uVitalityField, uv).rg;
}
float declineOf(float v) { return 1.0 - smoothstep(${g.to.toFixed(3)}, ${g.from.toFixed(3)}, v); }
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
