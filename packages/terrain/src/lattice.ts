// The world's one height truth: a square lattice of baked heights. The
// renderer's mesh, the grass, the trees and every measurement read these
// same samples with the same triangle interpolation, so they cannot disagree.

export interface Lattice {
  /** Samples per side. */
  readonly n: number;
  /** Meters between samples. */
  readonly spacing: number;
  /** World x and z of sample 0; the lattice is centered on the world origin. */
  readonly origin: number;
  /** Row-major: index = iz * n + ix. */
  readonly heights: Float32Array;
}

export function createLattice(extent: number, spacing: number): Lattice {
  const n = Math.round(extent / spacing) + 1;
  return { n, spacing, origin: (-(n - 1) * spacing) / 2, heights: new Float32Array(n * n) };
}

export const worldOf = (l: Lattice, i: number): number => l.origin + i * l.spacing;

/**
 * Height at any point, interpolated exactly as the mesh draws it: each cell
 * splits along the diagonal from (ix+1, iz) to (ix, iz+1).
 */
export function heightAt(l: Lattice, x: number, z: number, values: Float32Array = l.heights): number {
  const gx = Math.min(l.n - 1.000001, Math.max(0, (x - l.origin) / l.spacing));
  const gz = Math.min(l.n - 1.000001, Math.max(0, (z - l.origin) / l.spacing));
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
