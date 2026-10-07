// Composes one heightfield from per-region landforms. Each region's landform
// is blended with its neighbors' by weights that fall smoothly to zero across
// a wide band at every region edge, so heights are continuous by construction.
// Region cells are domain-warped, so their borders curve and wander instead of
// running straight; ground covers blend by the same weights broken into seeded
// patches, so one cover drifts into the next. The world's edge closes in with
// a gentle rim, which ends every sight line on the world's own ground. The
// result is fitted into the relief budget, then water is solved and cut into
// it. Everything here is pure and deterministic.

import { type AnyPrimitive, type BuildContext, type Blueprint, type Landform, type Library, rand, seedOf } from "@gaia/schema";
import { fbm, fieldAt } from "@gaia/primitives";
import { resolveParams } from "@gaia/realize";
import { RELIEF_BUDGET, type ReliefReport, measureRelief, withinBudget } from "./budget.ts";
import { type Lattice, createLattice, worldOf } from "./lattice.ts";
import { type SolvedPond, type SolvedStream, carvePond, carveStream, shoreField, solvePond, solveStream } from "./water.ts";

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
  /** Width of the band over which neighboring regions' landforms and covers blend, meters. */
  blend: 130,
  /** How far region borders wander from straight lines, meters, and over what wavelength. */
  warp: 34,
  warpWavelength: 150,
  /** How strongly covers break into patches across a blend; 0 is a plain gradient. */
  drift: 1.2,
  /** How abruptly one cover's patch gives way to the next's. */
  driftEdge: 3,
  /** Wavelength of the cover patches, meters. */
  driftWavelength: 30,
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
  /** Meters from each lattice sample to the nearest water, up to SHORE_CAP. */
  readonly shore: Float32Array;
  /** Index of the region whose cover dominates each lattice sample. */
  readonly region: Uint8Array;
  /**
   * The ground cover per lattice sample, as the regions with the largest
   * shares: COVER_TAPS region indices per sample, largest share first, and
   * their shares in 255ths, summing to 255. Covers blend by these shares.
   */
  readonly coverRegions: Uint8Array;
  readonly coverShares: Uint8Array;
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

const WARP_SEEDS = [5101, 5203] as const;
const DRIFT_SEED = 6007;

/**
 * Each region's blend weight at a point: 1 for the nearest, falling smoothly to
 * 0 across the blend band. Distances are measured from a domain-warped point,
 * so the cells' borders curve and wander. Heights blend by these weights.
 */
export function regionWeights(spec: WorldSpec, x: number, z: number, out: Float64Array): void {
  const u = x / TERRAIN.warpWavelength;
  const v = z / TERRAIN.warpWavelength;
  const wx = x + TERRAIN.warp * fbm(WARP_SEEDS[0], u, v, 2, 0.4);
  const wz = z + TERRAIN.warp * fbm(WARP_SEEDS[1], u, v, 2, 0.4);
  let nearest = Infinity;
  for (let i = 0; i < spec.regions.length; i++) {
    const r = spec.regions[i] as RegionSpec;
    const d = Math.hypot(wx - r.x, wz - r.z);
    out[i] = d;
    if (d < nearest) nearest = d;
  }
  for (let i = 0; i < spec.regions.length; i++) out[i] = 1 - smooth(((out[i] as number) - nearest) / TERRAIN.blend);
}

/**
 * Each region's share of the ground cover at a point, summing to 1. The blend
 * weights are broken into seeded patches, so across a band one cover drifts
 * into the next in islands rather than along a gradient. A region whose blend
 * weight is 0 has no share, so every region's core is its own cover.
 */
export function coverWeights(spec: WorldSpec, x: number, z: number, out: Float64Array): void {
  regionWeights(spec, x, z, out);
  coverFromBlend(spec, x, z, out);
}

function coverFromBlend(spec: WorldSpec, x: number, z: number, out: Float64Array): void {
  const u = x / TERRAIN.driftWavelength;
  const v = z / TERRAIN.driftWavelength;
  let total = 0;
  for (let i = 0; i < spec.regions.length; i++) {
    const w = out[i] as number;
    if (w <= 0) continue;
    const patch = Math.exp(TERRAIN.drift * fbm(DRIFT_SEED + i * 131, u, v, 2, 0.5));
    const c = (w * patch) ** TERRAIN.driftEdge;
    out[i] = c;
    total += c;
  }
  for (let i = 0; i < spec.regions.length; i++) out[i] = (out[i] as number) / total;
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

/** The ground blended from every region's landform by its weight, before the rim. */
function blended(spec: WorldSpec, landforms: readonly Landform[], weights: Float64Array, x: number, z: number): number {
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
  return sum / total;
}

/** The composed ground before fitting and water: continuous everywhere. */
export function composer(spec: WorldSpec, landforms: readonly Landform[]): (x: number, z: number) => number {
  const weights = new Float64Array(spec.regions.length);
  return (x, z) => {
    regionWeights(spec, x, z, weights);
    return blended(spec, landforms, weights, x, z) + rimAt(spec.size, x, z);
  };
}

/** How many regions' shares of the cover each lattice sample keeps: more than ever meet at one point. */
export const COVER_TAPS = 4;

/** The composed ground of some lattice rows, before fitting and water. */
export interface ComposedRows {
  /** The first row and one past the last. */
  readonly z0: number;
  readonly z1: number;
  /** Per sample of these rows: the blended height with the rim, and the cover. */
  readonly raw: Float32Array;
  readonly region: Uint8Array;
  readonly coverRegions: Uint8Array;
  readonly coverShares: Uint8Array;
}

/** The baked lattice's shape for a world: samples every TERRAIN.spacing meters over the walkable square and its skirt. */
export const latticeOf = (spec: WorldSpec): Lattice => createLattice(spec.size + TERRAIN.skirt * 2, TERRAIN.spacing);

/**
 * Composes lattice rows [z0, z1): each sample's blended height and its cover.
 * Rows are independent, so a bake may compose them in parts, on several
 * threads, and get the same bytes as composing them at once.
 */
export function composeRows(spec: WorldSpec, landforms: readonly Landform[], z0: number, z1: number): ComposedRows {
  const lattice = latticeOf(spec);
  const { n } = lattice;
  const count = spec.regions.length;
  if (count > 255) throw new Error(`A world holds at most 255 regions; this one has ${count}.`);
  const rows = z1 - z0;
  const raw = new Float32Array(rows * n);
  const region = new Uint8Array(rows * n);
  const coverRegions = new Uint8Array(rows * n * COVER_TAPS);
  const coverShares = new Uint8Array(rows * n * COVER_TAPS);
  const weights = new Float64Array(count);
  const top = new Int32Array(COVER_TAPS);
  for (let iz = z0; iz < z1; iz++) {
    const z = worldOf(lattice, iz);
    for (let ix = 0; ix < n; ix++) {
      const x = worldOf(lattice, ix);
      const k = (iz - z0) * n + ix;
      regionWeights(spec, x, z, weights);
      raw[k] = blended(spec, landforms, weights, x, z) + rimAt(spec.size, x, z);
      coverFromBlend(spec, x, z, weights);
      // The largest shares, largest first; ties keep the lower index.
      top.fill(-1);
      for (let i = 0; i < count; i++) {
        const w = weights[i] as number;
        if (w <= 0) continue;
        for (let t = 0; t < COVER_TAPS; t++) {
          const at = top[t] as number;
          if (at < 0 || w > (weights[at] as number)) {
            top.copyWithin(t + 1, t, COVER_TAPS - 1);
            top[t] = i;
            break;
          }
        }
      }
      let kept = 0;
      for (let t = 0; t < COVER_TAPS; t++) if ((top[t] as number) >= 0) kept += weights[top[t] as number] as number;
      let given = 0;
      for (let t = 0; t < COVER_TAPS; t++) {
        const i = top[t] as number;
        const share = i < 0 ? 0 : Math.round(((weights[i] as number) / kept) * 255);
        coverRegions[k * COVER_TAPS + t] = Math.max(0, i);
        coverShares[k * COVER_TAPS + t] = share;
        given += share;
      }
      // Rounding leftovers go to the largest share, so every sample's shares sum to 255.
      coverShares[k * COVER_TAPS] = (coverShares[k * COVER_TAPS] as number) + 255 - given;
      region[k] = Math.max(0, top[0] as number);
    }
  }
  return { z0, z1, raw, region, coverRegions, coverShares };
}

/** Fits composed rows (covering every lattice row, in order) into the budget, then solves and cuts the water. */
export function finishTerrain(spec: WorldSpec, landforms: readonly Landform[], parts: readonly ComposedRows[]): Terrain {
  const lattice = latticeOf(spec);
  const { n } = lattice;
  const raw = new Float32Array(n * n);
  const region = new Uint8Array(n * n);
  const coverRegions = new Uint8Array(n * n * COVER_TAPS);
  const coverShares = new Uint8Array(n * n * COVER_TAPS);
  let filled = 0;
  for (const p of [...parts].sort((a, b) => a.z0 - b.z0)) {
    if (p.z0 !== filled) throw new Error(`Composed rows ${p.z0} to ${p.z1} leave a gap or overlap at row ${filled}.`);
    raw.set(p.raw, p.z0 * n);
    region.set(p.region, p.z0 * n);
    coverRegions.set(p.coverRegions, p.z0 * n * COVER_TAPS);
    coverShares.set(p.coverShares, p.z0 * n * COVER_TAPS);
    filled = p.z1;
  }
  if (filled !== n) throw new Error(`Composed rows end at ${filled} of ${n}.`);

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
    shore: shoreField(final, heights, waterLevel),
    region,
    coverRegions,
    coverShares,
    streams,
    ponds,
    fit,
    report: measureRelief(final, heights, inside),
    landforms,
  };
}

/** Bakes the world's one height truth. */
export function bakeTerrain(spec: WorldSpec, lib: Library): Terrain {
  const landforms = landformsOf(spec, lib);
  return finishTerrain(spec, landforms, [composeRows(spec, landforms, 0, latticeOf(spec).n)]);
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
      ok = Math.abs(x) < limit && Math.abs(z) < limit && others < 0.75;
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
