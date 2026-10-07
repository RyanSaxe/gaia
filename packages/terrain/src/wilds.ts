// Wild land past the rim: one low-detail ring of ground from the edge of the
// baked lattice out to 1.5 km, so the world never shows an edge and distance
// dissolves land into the sky instead of into a sea of mist. It continues the
// rim's height and settles toward a gentle, seeded roll. It is never walkable.

import { fieldAt } from "@gaia/primitives";
import { heightAt } from "./lattice.ts";
import { TERRAIN, type Terrain } from "./world.ts";

export const WILDS = {
  /** Rings and segments around: 7,680 vertices, one draw call. */
  rings: 48,
  segments: 160,
  /** Outer radius in meters, past where far land has fully dissolved. */
  outer: 1500,
  /** Distance over which the rim's height settles into the wild roll. */
  settle: 160,
  /** The wild roll's whole height range in meters. */
  variation: 6,
  /** The inner row tucks this far inside the hand-over circle and this far under the lattice. */
  tuck: 6,
  sink: 0.3,
} as const;

/** Where the baked lattice hands over to the wild land: a circle just inside the lattice's square. */
export const landRadius = (t: Terrain): number => t.spec.size / 2 + TERRAIN.skirt - 8;

export interface WildsRing {
  /** x, y, z per vertex, ring by ring from the inside out. */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

const ROLL = { op: "noise", seed: 91, wavelength: 260, octaves: 3, gain: 0.5, angle: 0, stretch: 1, style: "smooth" } as const;

/** The wild ring around a baked world. Pure and deterministic. */
export function wildsRing(t: Terrain): WildsRing {
  const { rings, segments, outer, settle, variation, tuck, sink } = WILDS;
  const r0 = landRadius(t);
  const edge = Array.from({ length: segments }, (_, s) => {
    const a = (s / segments) * Math.PI * 2;
    return heightAt(t.lattice, Math.cos(a) * r0, Math.sin(a) * r0);
  });
  const base = edge.reduce((sum, h) => sum + h, 0) / segments;
  const positions = new Float32Array(rings * segments * 3);
  for (let k = 0; k < rings; k++) {
    // Row 0 tucks under the lattice so no crack can show; row 1 meets it at
    // the hand-over circle; rows widen outward, where distance hides detail.
    const r = k === 0 ? r0 - tuck : r0 + (outer - r0) * Math.pow((k - 1) / (rings - 2), 1.7);
    const settled = smooth((r - r0) / settle);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const roll = base + Math.max(-1, Math.min(1, fieldAt(ROLL, x, z))) * (variation / 2);
      const inner = k === 0 ? heightAt(t.lattice, x, z) - sink : (edge[s] as number);
      const v = (k * segments + s) * 3;
      positions[v] = x;
      positions[v + 1] = inner + (roll - inner) * settled;
      positions[v + 2] = z;
    }
  }
  const indices = new Uint32Array((rings - 1) * segments * 6);
  let i = 0;
  for (let k = 0; k < rings - 1; k++) {
    for (let s = 0; s < segments; s++) {
      const a = k * segments + s;
      const b = k * segments + ((s + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      indices.set([a, b, c, b, d, c], i);
      i += 6;
    }
  }
  return { positions, indices };
}
