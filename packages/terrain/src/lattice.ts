// A square lattice of baked heights. The renderer's mesh, the grass, the
// trees and every measurement read these samples with the same triangle
// interpolation (`heightAt`), so they agree on the ground's height.

export interface Lattice {
  /** Samples per side. */
  readonly n: number;
  /** Meters between samples. */
  readonly spacing: number;
  /** World x and z of sample 0. The world's lattice is centered on the world origin. */
  readonly origin: number;
  /** World z of sample 0 when it differs from `origin`, as for a tile. Defaults to `origin`. */
  readonly originZ?: number;
  /** Row-major: index = iz * n + ix. */
  readonly heights: Float32Array;
  /**
   * For a window of the land, reads `values` past the window's edge from
   * wherever that land is stored. `values` is the window's heights or another
   * of its per-sample arrays. When absent, a read past the edge clamps to the
   * edge samples.
   */
  readonly beyond?: (x: number, z: number, values: Float32Array) => number;
}

export function createLattice(extent: number, spacing: number): Lattice {
  const n = Math.round(extent / spacing) + 1;
  return { n, spacing, origin: (-(n - 1) * spacing) / 2, heights: new Float32Array(n * n) };
}

/** A lattice's position and size, without its samples. */
export type LatticeFrame = Pick<Lattice, "n" | "spacing" | "origin" | "originZ">;

/** World x of column `i`. It is also world z of row `i` on a lattice without `originZ`. */
export const worldOf = (l: Pick<Lattice, "origin" | "spacing">, i: number): number => l.origin + i * l.spacing;
/** World z of row `i`. */
export const worldOfZ = (l: Pick<Lattice, "origin" | "originZ" | "spacing">, i: number): number => (l.originZ ?? l.origin) + i * l.spacing;

/**
 * Height at any point, interpolated as the mesh draws it. Each cell splits
 * into two triangles along the diagonal from (ix+1, iz) to (ix, iz+1).
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

/** Slope in degrees at a point, from central differences one `spacing` either side. */
export function slopeAt(l: Lattice, x: number, z: number): number {
  const e = l.spacing;
  const gx = (heightAt(l, x + e, z) - heightAt(l, x - e, z)) / (2 * e);
  const gz = (heightAt(l, x, z + e) - heightAt(l, x, z - e)) / (2 * e);
  return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
}
