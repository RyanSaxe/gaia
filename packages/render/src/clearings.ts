// Up to `MAX_CLEARINGS` capsules on the ground where grass does not grow, such
// as the floors of a few buildings and the walks to their doors. Grass shaders
// multiply each blade's height by `clearing(xz)`.

import * as THREE from "three";

export const MAX_CLEARINGS = 12;

/** A capsule from (ax, az) to (bx, bz) with a radius, in world meters. */
export interface Clearing {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly radius: number;
}

export const CLEARINGS_GLSL = /* glsl */ `
uniform vec4 uClearings[${MAX_CLEARINGS}];
uniform float uClearingRadius[${MAX_CLEARINGS}];
float clearing(vec2 p) {
  float keep = 1.0;
  for (int i = 0; i < ${MAX_CLEARINGS}; i++) {
    float r = uClearingRadius[i];
    if (r <= 0.0) continue;
    vec2 a = uClearings[i].xy;
    vec2 ab = uClearings[i].zw - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-5), 0.0, 1.0);
    keep = min(keep, smoothstep(r * 0.7, r, length(p - a - ab * t)));
  }
  return keep;
}
`;

export interface Clearings {
  readonly uniforms: {
    uClearings: { value: THREE.Vector4[] };
    uClearingRadius: { value: number[] };
  };
  set(list: readonly Clearing[]): void;
}

export function createClearings(): Clearings {
  const uniforms = {
    uClearings: {
      value: Array.from({ length: MAX_CLEARINGS }, () => new THREE.Vector4()),
    },
    uClearingRadius: {
      value: Array.from({ length: MAX_CLEARINGS }, () => 0),
    },
  };
  return {
    uniforms,
    set(list): void {
      for (let i = 0; i < MAX_CLEARINGS; i++) {
        const c = list[i];
        const vec = uniforms.uClearings.value[i];
        if (c === undefined) {
          vec?.set(0, 0, 0, 0);
          uniforms.uClearingRadius.value[i] = 0;
        } else {
          vec?.set(c.ax, c.az, c.bx, c.bz);
          uniforms.uClearingRadius.value[i] = c.radius;
        }
      }
    },
  };
}
