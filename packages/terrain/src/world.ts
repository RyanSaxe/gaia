// Composes one heightfield from per-region landforms. Each region's landform
// is blended with its neighbors' by weights that fall smoothly to zero across
// a band at every region edge, so heights are continuous by construction. The
// world's edge closes in with a gentle rim, which ends every sight line on
// the world's own ground. The result is fitted into the relief budget, then
// water is solved and cut into it. Everything here is pure and deterministic.

import { type AnyPrimitive, type BuildContext, type Blueprint, type Landform, type Library, rand, seedOf } from "@gaia/schema";
import { fieldAt } from "@gaia/primitives";
import { resolveParams } from "@gaia/realize";
import { RELIEF_BUDGET, type ReliefReport, measureRelief, withinBudget } from "./budget.ts";
import { type Lattice, createLattice, worldOf } from "./lattice.ts";
import { type SolvedPond, type SolvedStream, carvePond, carveStream, solvePond, solveStream } from "./water.ts";

export interface RegionSpec {
  /** The directory the region stands for. */
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** The region's ground level, meters, from the world layout. */
  readonly base: number;
  /** A blueprint of the `biome` kind. Terrain reads its relief slot. */
  readonly biome: Blueprint;
}

export interface WorldSpec {
  /** Side of the walkable square, meters. */
  readonly size: number;
  readonly regions: readonly RegionSpec[];
}

export const TERRAIN = {
  /** Meters between lattice samples. */
  spacing: 1,
  /** Land drawn beyond the walkable square on every side, meters. */
  skirt: 80,
  /** Width of the band over which neighboring regions' landforms blend, meters. */
  blend: 40,
  /** How high the world's edge rises, meters. */
  rim: 7,
  /** Width of the rim's climb, meters, ending this far past the walkable edge. */
  rimWidth: 60,
  rimOvershoot: 15,
  /** Water may cut this far below the lowest fitted ground, so fitting leaves room for it. */
  waterMargin: 1.6,
} as const;

/** Marks a lattice sample with no water over it. */
export const DRY = -1000;

export interface Terrain {
  readonly spec: WorldSpec;
  readonly lattice: Lattice;
  /** Water surface height per lattice sample, DRY where there is none. */
  readonly waterLevel: Float32Array;
  /** Index of the region with the strongest weight per lattice sample. */
  readonly region: Uint8Array;
  readonly streams: readonly SolvedStream[];
  readonly ponds: readonly SolvedPond[];
  /** The vertical scale applied to fit the budget; 1 means the landforms fit as chosen. */
  readonly fit: number;
  /** Relief over the walkable square. */
  readonly report: ReliefReport;
  readonly landforms: readonly Landform[];
}

type ErasedBuild = (params: unknown, ctx: BuildContext, input: unknown) => unknown;

export const regionExtent = (spec: WorldSpec): number => spec.size / Math.sqrt(Math.max(1, spec.regions.length));

/** Builds each region's landform from its stored biome blueprint. */
export function landformsOf(spec: WorldSpec, lib: Library): Landform[] {
  const extent = regionExtent(spec);
  return spec.regions.map((r) => {
    const slot = r.biome.slots.relief;
    if (slot === undefined) throw new Error(`Region ${r.id} has no relief.`);
    const p: AnyPrimitive = lib.get(slot.use);
    if (p.role !== "Relief") throw new Error(`${p.id} is not a Relief primitive.`);
    const root = rand(seedOf(r.id));
    const params = resolveParams(p, slot.params, root.fork("params"), `${r.id}.relief`);
    return (p.build as ErasedBuild)(params, { rand: root.fork("relief"), facts: { extent } }, null) as Landform;
  });
}

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** Each region's blend weight at a point: 1 for the nearest, falling to 0 across the blend band. */
export function regionWeights(spec: WorldSpec, x: number, z: number, out: Float64Array): void {
  let nearest = Infinity;
  for (let i = 0; i < spec.regions.length; i++) {
    const r = spec.regions[i] as RegionSpec;
    const d = Math.hypot(x - r.x, z - r.z);
    out[i] = d;
    if (d < nearest) nearest = d;
  }
  for (let i = 0; i < spec.regions.length; i++) out[i] = 1 - smooth(((out[i] as number) - nearest) / TERRAIN.blend);
}

/** The world's edge: a gentle rise around a rounded square, with a little wander. */
export function rimAt(size: number, x: number, z: number): number {
  const half = size / 2;
  const e = Math.pow(Math.abs(x) ** 4 + Math.abs(z) ** 4, 0.25);
  const start = half + TERRAIN.rimOvershoot - TERRAIN.rimWidth;
  const rise = smooth((e - start) / TERRAIN.rimWidth);
  if (rise === 0) return 0;
  const wander = fieldAt({ op: "noise", seed: 77, wavelength: 70, octaves: 2, gain: 0.5, angle: 0, stretch: 1, style: "smooth" }, x, z);
  return TERRAIN.rim * rise * (0.8 + 0.3 * wander);
}

/** The composed ground before fitting and water: continuous everywhere. */
export function composer(spec: WorldSpec, landforms: readonly Landform[]): (x: number, z: number) => number {
  const weights = new Float64Array(spec.regions.length);
  return (x, z) => {
    regionWeights(spec, x, z, weights);
    let total = 0;
    let sum = 0;
    for (let i = 0; i < spec.regions.length; i++) {
      const w = weights[i] as number;
      if (w <= 0) continue;
      const r = spec.regions[i] as RegionSpec;
      const lf = landforms[i] as Landform;
      sum += w * (r.base + fieldAt(lf.height, x - r.x, z - r.z));
      total += w;
    }
    return sum / total + rimAt(spec.size, x, z);
  };
}

/** Bakes the world's one height truth. */
export function bakeTerrain(spec: WorldSpec, lib: Library): Terrain {
  const landforms = landformsOf(spec, lib);
  const compose = composer(spec, landforms);
  const lattice = createLattice(spec.size + TERRAIN.skirt * 2, TERRAIN.spacing);
  const { n } = lattice;
  const raw = new Float32Array(n * n);
  const region = new Uint8Array(n * n);
  const weights = new Float64Array(spec.regions.length);
  for (let iz = 0; iz < n; iz++) {
    const z = worldOf(lattice, iz);
    for (let ix = 0; ix < n; ix++) {
      const x = worldOf(lattice, ix);
      raw[iz * n + ix] = compose(x, z);
      regionWeights(spec, x, z, weights);
      let best = 0;
      for (let i = 1; i < weights.length; i++) if ((weights[i] as number) > (weights[best] as number)) best = i;
      region[iz * n + ix] = best;
    }
  }

  // Fit: scale the relief about its mean until the walkable square fits the
  // budget. Range, slopes and steps all shrink with the scale.
  const half = spec.size / 2;
  const inside = (ix: number, iz: number): boolean => Math.abs(worldOf(lattice, ix)) <= half && Math.abs(worldOf(lattice, iz)) <= half;
  let mean = 0;
  for (const h of raw) mean += h;
  mean /= raw.length;
  const scaled = (k: number): Float32Array => raw.map((h) => mean + (h - mean) * k);
  const fits = (k: number): boolean => withinBudget(measureRelief(lattice, scaled(k), inside), TERRAIN.waterMargin);
  let fit = 1;
  if (!fits(1)) {
    let lo = 0.1;
    let hi = 1;
    for (let step = 0; step < 14; step++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    fit = lo;
  }
  const heights = scaled(fit);
  const final: Lattice = { ...lattice, heights };

  // Water, solved from the fitted ground and cut into it.
  const waterLevel = new Float32Array(n * n).fill(DRY);
  const streams: SolvedStream[] = [];
  const ponds: SolvedPond[] = [];
  spec.regions.forEach((r, ri) => {
    for (const bed of (landforms[ri] as Landform).water) {
      if (bed.kind !== "stream") continue;
      const path = keptRun(spec, ri, bed.path);
      const solved = path === null ? null : solveStream(final, path, bed.width, bed.depth);
      if (solved === null) continue;
      carveStream(final, heights, waterLevel, solved);
      streams.push(solved);
    }
  });
  spec.regions.forEach((r, ri) => {
    for (const bed of (landforms[ri] as Landform).water) {
      if (bed.kind !== "pond") continue;
      const solved = solvePond(final, heights, r.x + bed.x, r.z + bed.z, bed.radius);
      if (solved === null) continue;
      carvePond(final, heights, waterLevel, solved, bed.depth);
      ponds.push(solved);
    }
  });

  return {
    spec,
    lattice: final,
    waterLevel,
    region,
    streams,
    ponds,
    fit,
    report: measureRelief(final, heights, inside),
    landforms,
  };
}

/**
 * The part of a region's stream bed that stays inside the region and the
 * walkable square: the longest unbroken run where the region dominates.
 */
function keptRun(spec: WorldSpec, ri: number, local: Float32Array): Float32Array | null {
  const r = spec.regions[ri] as RegionSpec;
  const weights = new Float64Array(spec.regions.length);
  const limit = spec.size / 2 - 30;
  let best: [number, number] = [0, 0];
  let start = -1;
  const count = local.length / 2;
  for (let k = 0; k <= count; k++) {
    let ok = false;
    if (k < count) {
      const x = r.x + (local[k * 2] as number);
      const z = r.z + (local[k * 2 + 1] as number);
      regionWeights(spec, x, z, weights);
      let others = 0;
      weights.forEach((w, i) => {
        if (i !== ri) others = Math.max(others, w);
      });
      ok = Math.abs(x) < limit && Math.abs(z) < limit && others < 0.3;
    }
    if (ok && start < 0) start = k;
    if (!ok && start >= 0) {
      if (k - start > best[1] - best[0]) best = [start, k];
      start = -1;
    }
  }
  if (best[1] - best[0] < 12) return null;
  const out = new Float32Array((best[1] - best[0]) * 2);
  for (let k = best[0]; k < best[1]; k++) {
    out[(k - best[0]) * 2] = r.x + (local[k * 2] as number);
    out[(k - best[0]) * 2 + 1] = r.z + (local[k * 2 + 1] as number);
  }
  return out;
}

export { RELIEF_BUDGET };
