// Where grass does not grow: the ground under rocks and bushes, as a mask the
// grass shader reads, so no blade ever pierces a stone. Each cleared shape
// follows its component's own outline at the ground, not a disc.

import * as THREE from "three";
import type { Terrain } from "@gaia/terrain";

/** Meters per mask texel. */
const RESOLUTION = 0.5;

/** A component's reach at the ground in each of `outline.length` directions around it, at scale 1. */
export interface Clearing {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly outline: Float32Array;
}

export interface Clearings {
  readonly uniforms: {
    readonly uClearing: { value: THREE.DataTexture };
    readonly uClearingOrigin: { value: number };
    readonly uClearingSize: { value: number };
  };
  update(clearings: readonly Clearing[]): void;
}

export function createClearings(t: Terrain): Clearings {
  const l = t.lattice;
  const extent = (l.n - 1) * l.spacing;
  const n = Math.ceil(extent / RESOLUTION);
  const data = new Uint8Array(n * n);
  const texture = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const uniforms = {
    uClearing: { value: texture },
    uClearingOrigin: { value: l.origin },
    uClearingSize: { value: n * RESOLUTION },
  };
  return {
    uniforms,
    update(clearings) {
      data.fill(0);
      for (const c of clearings) {
        const k = c.outline.length;
        let reach = 0;
        for (const r of c.outline) reach = Math.max(reach, r);
        reach *= c.scale;
        const i0 = Math.max(0, Math.floor((c.x - reach - l.origin) / RESOLUTION));
        const i1 = Math.min(n - 1, Math.ceil((c.x + reach - l.origin) / RESOLUTION));
        const j0 = Math.max(0, Math.floor((c.z - reach - l.origin) / RESOLUTION));
        const j1 = Math.min(n - 1, Math.ceil((c.z + reach - l.origin) / RESOLUTION));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const dx = l.origin + (i + 0.5) * RESOLUTION - c.x;
            const dz = l.origin + (j + 0.5) * RESOLUTION - c.z;
            // Back into the component's own frame: three's Y rotation turns local x to (cos, -sin).
            const lx = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw);
            const lz = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw);
            const a = ((Math.atan2(lz, lx) / (Math.PI * 2)) % 1 + 1) % 1;
            const r = (c.outline[Math.floor(a * k) % k] as number) * c.scale;
            if (Math.hypot(lx, lz) < r) data[j * n + i] = 255;
          }
        }
      }
      texture.needsUpdate = true;
    },
  };
}

/** Samples the mask: 1 where nothing grows. */
export const CLEARING_GLSL = /* glsl */ `
uniform sampler2D uClearing;
uniform float uClearingOrigin;
uniform float uClearingSize;
float clearingAt(vec2 xz) {
  return texture2D(uClearing, (xz - uClearingOrigin) / uClearingSize).r;
}
`;
