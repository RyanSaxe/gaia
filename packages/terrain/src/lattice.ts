// The world's one height truth: a square lattice of baked heights. The
// renderer's mesh, the grass, the trees and every measurement read these
// same samples with the same triangle interpolation, so they cannot disagree.

export interface Lattice {
  /** Samples per side. */
  readonly n: number;
  /** Meters between samples. */
  readonly spacing: number;
  /** World x and z of sample 0; the world's lattice is centered on the world origin. */
  readonly origin: number;
  /** World z of sample 0 when it differs from x's, as for a tile of the land; `origin` when absent. */
  readonly originZ?: number;
  /** Row-major: index = iz * n + ix. */
  readonly heights: Float32Array;
  /**
   * For a window of the land: reads `values` (its heights or another of its
   * arrays) past the window's edge, from wherever the land there is held.
   * Absent, a read past the edge takes the edge's samples.
   */
  readonly beyond?: (x: number, z: number, values: Float32Array) => number;
}

export function createLattice(extent: number, spacing: number): Lattice {
  const n = Math.round(extent / spacing) + 1;
  return { n, spacing, origin: (-(n - 1) * spacing) / 2, heights: new Float32Array(n * n) };
}

/** Where a lattice's samples lie, without the samples. */
export type LatticeFrame = Pick<Lattice, "n" | "spacing" | "origin" | "originZ">;

/** World x of column `i`, and world z of row `i` on a lattice whose rows start where its columns do. */
export const worldOf = (l: Pick<Lattice, "origin" | "spacing">, i: number): number => l.origin + i * l.spacing;
/** World z of row `i`. */
export const worldOfZ = (l: Pick<Lattice, "origin" | "originZ" | "spacing">, i: number): number => (l.originZ ?? l.origin) + i * l.spacing;

/**
 * Height at any point, interpolated exactly as the mesh draws it: each cell
 * splits along the diagonal from (ix+1, iz) to (ix, iz+1).
 */
export function heightAt(l: Lattice, x: number, z: number, values: Float32Array = l.heights): number {
  const ux = (x - l.origin) / l.spacing;
  const uz = (z - (l.originZ ?? l.origin)) / l.spacing;
  if (l.beyond !== undefined && (ux < 0 || uz < 0 || ux > l.n - 1 || uz > l.n - 1)) return l.beyond(x, z, values);
  const gx = Math.min(l.n - 1.000001, Math.max(0, ux));
  const gz = Math.min(l.n - 1.000001, Math.max(0, uz));
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const i = iz * l.n + ix;
  const h00 = values[i] as number;
  const h10 = values[i + 1] as number;
  const h01 = values[i + l.n] as number;
  const h11 = values[i + l.n + 1] as number;
  if (fx + fz <= 1) return h00 + fx * (h10 - h00) + fz * (h01 - h00);
  return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
}

/** Slope in degrees at a point, from the cell's gradient. */
export function slopeAt(l: Lattice, x: number, z: number): number {
  const e = l.spacing;
  const gx = (heightAt(l, x + e, z) - heightAt(l, x - e, z)) / (2 * e);
  const gz = (heightAt(l, x, z + e) - heightAt(l, x, z - e)) / (2 * e);
  return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
}
