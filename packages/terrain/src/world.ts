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
import { type LandSite, LAND_WARP, siteAt, warpPoint } from "./land.ts";
import { type Lattice, type LatticeFrame, createLattice, worldOf, worldOfZ } from "./lattice.ts";
import { BANK_REACH, SHORE_CAP, type SolvedPond, type SolvedStream, carvePond, carveStream, shoreField, solvePond, solveStream } from "./water.ts";
import { type LandOutline, pastTheEdge, withinLand } from "./edge.ts";
import { routeRivers, valleySurface } from "./rivers.ts";

export interface RegionSpec {
  /** The directory the region stands for. */
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** The region's ground level, meters, from the world layout. */
  readonly base: number;
  /**
   * How far the region's own ground reaches from its middle, meters: a
   * larger region claims more land before its neighbor's begins. Absent, 0,
   * which divides the land evenly between neighboring middles.
   */
  readonly reach?: number;
  /**
   * The cells the region's land is made of, when it is more than one: its
   * ground is every point whose nearest site (`siteAt`) is one of these, so
   * its border follows theirs. Absent, the region is one cell, at its middle
   * with its reach. A world laid out from code gives each region the sites
   * of its files' patches.
   */
  readonly sites?: readonly LandSite[];
  /** A blueprint of the `biome` kind. Terrain reads its relief slot. */
  readonly biome: Blueprint;
}

export interface WorldSpec {
  /** The land's width, west to east, meters: the side of its square when it has no `aspect`. */
  readonly size: number;
  /** How much wider than deep the land is (`LandOutline`); a world laid out from code takes `LAND_ASPECT`. */
  readonly aspect?: number;
  readonly regions: readonly RegionSpec[];
}

export const TERRAIN = {
  /** Meters between lattice samples. */
  spacing: 1,
  /** Land drawn beyond the walkable square on every side, meters. */
  skirt: 80,
  /** Width of the band over which neighboring regions' landforms and covers blend, meters. */
  blend: 130,
  /** How far region borders wander from straight lines, meters, and over what wavelength (`LAND_WARP`). */
  warp: LAND_WARP.amount,
  warpWavelength: LAND_WARP.wavelength,
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
  /** The relief is fitted on a survey of every this-many samples a side, as land baked in tiles must be. */
  survey: 4,
  /**
   * A survey misses the steepest meter of a slope, so a fit it has to scale
   * down is taken this share flatter, which keeps every sample inside the
   * budget: at 5 km a 4 m survey alone overshoots by 0.12%.
   */
  surveyMargin: 0.002,
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
  /** The vertical scale applied to fit the budget, about `mean`; 1 means the landforms fit as chosen. */
  readonly fit: number;
  readonly mean: number;
  /** Each pond's depth, in the order of `ponds`. */
  readonly pondDepths: readonly number[];
  /** Relief over the walkable square. */
  readonly report: ReliefReport;
  readonly landforms: readonly Landform[];
}

/** The plan a bake of the whole world followed: what a tile of it needs to be baked alone (`bakeTile`). */
export const planOf = (t: Terrain): TerrainPlan => ({
  spec: t.spec,
  landforms: t.landforms,
  mean: t.mean,
  fit: t.fit,
  streams: t.streams,
  ponds: t.ponds.map((pond, i) => ({ pond, depth: t.pondDepths[i] as number })),
});

type ErasedBuild = (params: unknown, ctx: BuildContext, input: unknown) => unknown;

export const regionExtent = (spec: WorldSpec): number => spec.size / Math.sqrt(Math.max(1, spec.regions.length));

/** Builds each region's landform from its stored biome blueprint. */
export function landformsOf(spec: WorldSpec, lib: Library): Landform[] {
  const extent = regionExtent(spec);
  const own = spec.regions.map((r) => {
    const slot = r.biome.slots.relief;
    if (slot === undefined) throw new Error(`Region ${r.id} has no relief.`);
    const p: AnyPrimitive = lib.get(slot.use);
    if (p.role !== "Relief") throw new Error(`${p.id} is not a Relief primitive.`);
    const root = rand(seedOf(r.id));
    const params = resolveParams(p, slot.params, root.fork("params"), `${r.id}.relief`);
    return (p.build as ErasedBuild)(params, { rand: root.fork("relief"), facts: { extent } }, null) as Landform;
  });
  // Rivers follow the land: routed over the ground the regions compose, rim and all, and carved into every region's.
  const weights = new Float64Array(spec.regions.length);
  const ground = (lfs: readonly Landform[]) => (x: number, z: number): number => {
    regionWeights(spec, x, z, weights);
    return blended(spec, lfs, weights, x, z) + rimAt(spec, x, z);
  };
  const regionAt = (x: number, z: number): number => {
    regionWeights(spec, x, z, weights);
    let best = 0;
    weights.forEach((w, i) => {
      if (w > (weights[best] as number)) best = i;
    });
    return best;
  };
  return routeRivers(spec, own, ground, regionAt);
}

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

const DRIFT_SEED = 6007;

/** Which one-cell region's warped cell holds (x, z): the one whose landform weighs most there, as `regionWeights` finds it. */
export const cellAt = (sites: readonly LandSite[], x: number, z: number): number => siteAt(sites, x, z);

/** Side of a region field's lookup cell, meters. */
const FIELD_CELL = 24;

/**
 * What `regionWeights` reads quickly: per lookup cell (over warped points),
 * the regions that can weigh anything in it and, for each, the sites that
 * can be its nearest there, as (region, from, to) triples over `order`.
 */
interface RegionField {
  readonly x0: number;
  readonly n: number;
  readonly sites: readonly (readonly LandSite[])[];
  readonly starts: Int32Array;
  readonly runs: Int32Array;
  /** Site indices grouped per run: a run of region r lists indices into `sites[r]`. */
  readonly order: Int32Array;
}
const fields = new WeakMap<WorldSpec, RegionField>();

function regionField(spec: WorldSpec): RegionField {
  const had = fields.get(spec);
  if (had !== undefined) return had;
  const sites = spec.regions.map((r) => r.sites ?? [{ x: r.x, z: r.z, reach: r.reach ?? 0 }]);
  const half = spec.size / 2 + TERRAIN.skirt + TERRAIN.warp * 2;
  const x0 = -half;
  const n = Math.max(1, Math.ceil((half * 2) / FIELD_CELL));
  const starts = new Int32Array(n * n + 1);
  const runs: number[] = [];
  const order: number[] = [];
  const lo = sites.map((s) => new Float64Array(s.length));
  const regionLo = new Float64Array(sites.length);
  const regionHi = new Float64Array(sites.length);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ax = x0 + i * FIELD_CELL;
      const az = x0 + j * FIELD_CELL;
      let bestHi = Infinity;
      sites.forEach((list, r) => {
        let rLo = Infinity;
        let rHi = Infinity;
        const los = lo[r] as Float64Array;
        list.forEach((s, k) => {
          const dx = Math.max(ax - s.x, 0, s.x - ax - FIELD_CELL);
          const dz = Math.max(az - s.z, 0, s.z - az - FIELD_CELL);
          const fx = Math.max(Math.abs(s.x - ax), Math.abs(s.x - ax - FIELD_CELL));
          const fz = Math.max(Math.abs(s.z - az), Math.abs(s.z - az - FIELD_CELL));
          const reach = s.reach ?? 0;
          const l = Math.hypot(dx, dz) - reach;
          los[k] = l;
          rLo = Math.min(rLo, l);
          rHi = Math.min(rHi, Math.hypot(fx, fz) - reach);
        });
        regionLo[r] = rLo;
        regionHi[r] = rHi;
        bestHi = Math.min(bestHi, rHi);
      });
      starts[j * n + i] = runs.length;
      sites.forEach((list, r) => {
        // A region farther than the blend band beyond the nearest weighs nothing anywhere in this cell.
        if ((regionLo[r] as number) > bestHi + TERRAIN.blend) return;
        const los = lo[r] as Float64Array;
        const from = order.length;
        for (let k = 0; k < list.length; k++) if ((los[k] as number) <= (regionHi[r] as number)) order.push(k);
        runs.push(r, from, order.length);
      });
    }
  }
  starts[n * n] = runs.length;
  const field = { x0, n, sites, starts, runs: Int32Array.from(runs), order: Int32Array.from(order) };
  fields.set(spec, field);
  return field;
}

/**
 * Each region's blend weight at a point: 1 for the nearest, falling smoothly to
 * 0 across the blend band. Distances are measured from a domain-warped point,
 * so the cells' borders curve and wander. Heights blend by these weights.
 */
export function regionWeights(spec: WorldSpec, x: number, z: number, out: Float64Array): void {
  const [wx, wz] = warpPoint(x, z);
  const f = regionField(spec);
  const i = Math.floor((wx - f.x0) / FIELD_CELL);
  const j = Math.floor((wz - f.x0) / FIELD_CELL);
  const count = spec.regions.length;
  out.fill(Infinity, 0, count);
  let nearest = Infinity;
  const within = i >= 0 && j >= 0 && i < f.n && j < f.n;
  if (within) {
    const c = j * f.n + i;
    for (let q = f.starts[c] as number; q < (f.starts[c + 1] as number); q += 3) {
      const r = f.runs[q] as number;
      const list = f.sites[r] as readonly LandSite[];
      let d = Infinity;
      for (let o = f.runs[q + 1] as number; o < (f.runs[q + 2] as number); o++) {
        const s = list[f.order[o] as number] as LandSite;
        d = Math.min(d, Math.hypot(wx - s.x, wz - s.z) - (s.reach ?? 0));
      }
      out[r] = d;
      if (d < nearest) nearest = d;
    }
  } else {
    f.sites.forEach((list, r) => {
      let d = Infinity;
      for (const s of list) d = Math.min(d, Math.hypot(wx - s.x, wz - s.z) - (s.reach ?? 0));
      out[r] = d;
      if (d < nearest) nearest = d;
    });
  }
  for (let r = 0; r < count; r++) out[r] = 1 - smooth(((out[r] as number) - nearest) / TERRAIN.blend);
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

/** The world's edge: a gentle rise around the land's rounded rectangle (`pastTheEdge`), with a little wander. */
export function rimAt(land: LandOutline, x: number, z: number): number {
  const rise = smooth((pastTheEdge(land, x, z) - TERRAIN.rimOvershoot + TERRAIN.rimWidth) / TERRAIN.rimWidth);
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
    return cutToValleys(landforms, x, z, blended(spec, landforms, weights, x, z) + rimAt(spec, x, z));
  };
}

/** The ground at (x, z) cut down to the world's river valleys, where they reach. */
function cutToValleys(landforms: readonly Landform[], x: number, z: number, h: number): number {
  const net = landforms[0]?.valleys;
  return net === undefined ? h : Math.min(h, valleySurface(net, x, z));
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

/** The world lattice's frame alone, as `latticeOf` lays it, without its samples: for reading positions, not heights. */
export function frameOf(spec: WorldSpec): { readonly n: number; readonly spacing: number; readonly origin: number } {
  const n = Math.round((spec.size + TERRAIN.skirt * 2) / TERRAIN.spacing) + 1;
  return { n, spacing: TERRAIN.spacing, origin: (-(n - 1) * TERRAIN.spacing) / 2 };
}

/**
 * Composes lattice rows [z0, z1): each sample's blended height and its cover.
 * Rows are independent, so a bake may compose them in parts, on several
 * threads, and get the same bytes as composing them at once.
 */
export function composeRows(spec: WorldSpec, landforms: readonly Landform[], z0: number, z1: number): ComposedRows {
  const lattice = frameOf(spec);
  return { z0, z1, ...composeRect(spec, landforms, lattice, 0, lattice.n, z0, z1) };
}

/** The composed ground of a rectangle of samples, before fitting and water: columns [x0, x1) of rows [z0, z1), row by row. */
type ComposedRect = Omit<ComposedRows, "z0" | "z1">;

/**
 * Composes columns [x0, x1) of rows [z0, z1) of lattice `l`, which may lie
 * anywhere: the world's own lattice, a coarser survey of it, or a tile. Every
 * sample is composed alone from where it stands, so the same point gives the
 * same bytes in any of them.
 */
function composeRect(spec: WorldSpec, landforms: readonly Landform[], l: LatticeFrame, x0: number, x1: number, z0: number, z1: number): ComposedRect {
  const count = spec.regions.length;
  if (count > 255) throw new Error(`A world holds at most 255 regions; this one has ${count}.`);
  const n = x1 - x0;
  const rows = z1 - z0;
  const raw = new Float32Array(rows * n);
  const region = new Uint8Array(rows * n);
  const coverRegions = new Uint8Array(rows * n * COVER_TAPS);
  const coverShares = new Uint8Array(rows * n * COVER_TAPS);
  const weights = new Float64Array(count);
  const top = new Int32Array(COVER_TAPS);
  for (let iz = z0; iz < z1; iz++) {
    const z = worldOfZ(l, iz);
    for (let ix = x0; ix < x1; ix++) {
      const x = worldOf(l, ix);
      const k = (iz - z0) * n + ix - x0;
      regionWeights(spec, x, z, weights);
      raw[k] = cutToValleys(landforms, x, z, blended(spec, landforms, weights, x, z) + rimAt(spec, x, z));
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
  return { raw, region, coverRegions, coverShares };
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
  // budget. Range, slopes and steps all shrink with the scale. The scale is
  // found on a survey of every `TERRAIN.survey`th sample, checked once at
  // every sample, and searched for at every sample only when the survey's
  // overshoots, so a large world fits in two passes over its samples, not
  // fifteen, and land up to 3 km across comes out exactly as before.
  const s = TERRAIN.survey;
  const sn = Math.floor((n - 1) / s) + 1;
  const surveyed = new Float32Array(sn * sn);
  for (let j = 0; j < sn; j++) for (let i = 0; i < sn; i++) surveyed[j * sn + i] = raw[j * s * n + i * s] as number;
  const survey: Lattice = { ...lattice, n: sn, spacing: lattice.spacing * s, heights: surveyed };
  let { mean, fit } = fitRelief(spec, survey);
  if (fit < 1) fit *= 1 - TERRAIN.surveyMargin;
  if (!fitsBudget(spec, lattice, raw, mean, fit)) ({ mean, fit } = fitRelief(spec, { ...lattice, heights: raw }));
  const heights = raw.map((h) => mean + (h - mean) * fit);
  const final: Lattice = { ...lattice, heights };

  // Water, solved from the fitted ground and cut into it.
  const { streams, ponds } = solveWater(spec, landforms, lattice, (x0, z0, side) => {
    const out = new Float32Array(side * side);
    for (let j = 0; j < side; j++) {
      const row = Math.min(n - 1, z0 + j) * n;
      for (let i = 0; i < side; i++) out[j * side + i] = heights[row + Math.min(n - 1, x0 + i)] as number;
    }
    return out;
  });
  const waterLevel = new Float32Array(n * n).fill(DRY);
  for (const s of streams) carveStream(final, heights, waterLevel, s);
  for (const p of ponds) carvePond(final, heights, waterLevel, p.pond, p.depth);

  return {
    spec,
    lattice: final,
    waterLevel,
    shore: shoreField(final, heights, waterLevel),
    region,
    coverRegions,
    coverShares,
    streams,
    ponds: ponds.map((p) => p.pond),
    fit,
    mean,
    pondDepths: ponds.map((p) => p.depth),
    report: measureRelief(final, heights, (ix, iz) => withinLand(spec, worldOf(final, ix), worldOf(final, iz))),
    landforms,
  };
}

/**
 * Solves the world's water bed by bed, in order: each stream from the fitted
 * ground along its bed, after the ones before it have been cut in, then each
 * pond from the ground around it. Each bed is solved on a window of just the
 * ground it reads, `side` samples square from lattice sample (`x0`, `z0`),
 * which `groundOf` gives fitted, with the beds before it cut in again. So a
 * plan that composes only those windows and a bake of the whole world that
 * copies them out of its ground solve the same water, to the bit.
 */
function solveWater(
  spec: WorldSpec,
  landforms: readonly Landform[],
  world: LatticeFrame,
  groundOf: (x0: number, z0: number, side: number) => Float32Array,
): { streams: SolvedStream[]; ponds: { pond: SolvedPond; depth: number }[] } {
  const streams: SolvedStream[] = [];
  const ponds: { pond: SolvedPond; depth: number }[] = [];
  for (const bed of waterBeds(spec, landforms, world)) {
    const [x0, x1, z0, z1] = bed.rect;
    const side = Math.max(x1 - x0, z1 - z0);
    const heights = groundOf(x0, z0, side);
    const window: Lattice = { n: side, spacing: world.spacing, origin: worldOf(world, x0), originZ: worldOfZ(world, z0), heights };
    const level = new Float32Array(side * side).fill(DRY);
    for (const s of streams) carveStream(window, heights, level, s);
    for (const p of ponds) carvePond(window, heights, level, p.pond, p.depth);
    if (bed.kind === "stream") {
      const solved = solveStream(window, bed.path, bed.width, bed.depth, bed.widths === undefined ? {} : { widths: bed.widths, seep: bed.seep ?? true, ...(bed.floors === undefined ? {} : { floors: bed.floors }) });
      if (solved !== null) streams.push(solved);
    } else {
      const solved = solvePond(window, heights, bed.x, bed.z, bed.radius);
      if (solved !== null) ponds.push({ pond: solved, depth: bed.depth });
    }
  }
  return { streams, ponds };
}

/** A bed of water as `solveWater` solves it, in its order, with the lattice rectangle, [x0, x1) by [z0, z1), within which it reads and cuts the ground. */
type WaterBed = { readonly rect: readonly [number, number, number, number] } & (
  | { readonly kind: "stream"; readonly path: Float32Array; readonly width: number; readonly depth: number; readonly widths?: Float32Array; readonly seep?: boolean; readonly floors?: Float32Array }
  | { readonly kind: "pond"; readonly x: number; readonly z: number; readonly radius: number; readonly depth: number }
);

/** Every bed of the world's water in the order `solveWater` solves them: each region's streams, then each region's ponds. */
function waterBeds(spec: WorldSpec, landforms: readonly Landform[], l: Lattice | LatticeFrame): WaterBed[] {
  const toIndex = (w: number): number => (w - l.origin) / l.spacing;
  const rect = (minX: number, maxX: number, minZ: number, maxZ: number, reach: number): [number, number, number, number] => [
    Math.max(0, Math.floor(toIndex(minX - reach)) - 1),
    Math.min(l.n, Math.ceil(toIndex(maxX + reach)) + 2),
    Math.max(0, Math.floor(toIndex(minZ - reach)) - 1),
    Math.min(l.n, Math.ceil(toIndex(maxZ + reach)) + 2),
  ];
  const beds: WaterBed[] = [];
  spec.regions.forEach((r, ri) => {
    for (const bed of (landforms[ri] as Landform).water) {
      if (bed.kind !== "stream") continue;
      // A river's whole course runs past its region; a stream of a valley's own runs while its region holds it.
      const path = bed.widths !== undefined ? Float32Array.from(bed.path, (v, k) => v + (k % 2 === 0 ? r.x : r.z)) : keptRun(spec, ri, bed.path);
      if (path === null) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let k = 0; k < path.length; k += 2) {
        minX = Math.min(minX, path[k] as number);
        maxX = Math.max(maxX, path[k] as number);
        minZ = Math.min(minZ, path[k + 1] as number);
        maxZ = Math.max(maxZ, path[k + 1] as number);
      }
      beds.push({ kind: "stream", path, width: bed.width, depth: bed.depth, ...(bed.widths === undefined ? {} : { widths: bed.widths, seep: bed.seep ?? true, ...(bed.floors === undefined ? {} : { floors: bed.floors }) }), rect: rect(minX, maxX, minZ, maxZ, Math.max(1.1, bed.width / 2) + BANK_REACH) });
    }
  });
  spec.regions.forEach((r, ri) => {
    for (const bed of (landforms[ri] as Landform).water) {
      if (bed.kind !== "pond") continue;
      const x = r.x + bed.x;
      const z = r.z + bed.z;
      beds.push({ kind: "pond", x, z, radius: bed.radius, depth: bed.depth, rect: rect(x, x, z, z, bed.radius * 1.3) });
    }
  });
  return beds;
}

/** What a world decides once, before any of its land is composed in full: how its relief is fitted, and its water. */
export interface TerrainPlan {
  readonly spec: WorldSpec;
  readonly landforms: readonly Landform[];
  /** Every sample's height is its composed height scaled about `mean` by `fit`. */
  readonly mean: number;
  readonly fit: number;
  readonly streams: readonly SolvedStream[];
  readonly ponds: readonly { readonly pond: SolvedPond; readonly depth: number }[];
}

/**
 * Plans a world's land without composing all of it: fits the relief on a
 * survey, as `finishTerrain` does, and solves the water from the ground
 * composed along its beds alone. Where `finishTerrain`'s check at every
 * sample keeps the survey's fit, which it does for every world up to 3 km and
 * for the 5 km sample world, the plan and the whole-world bake agree exactly.
 */
export function planTerrain(spec: WorldSpec, landforms: readonly Landform[]): TerrainPlan {
  const lattice = latticeOf(spec);
  const { n } = lattice;
  const s = TERRAIN.survey;
  const sn = Math.floor((n - 1) / s) + 1;
  const surveyFrame: Lattice = { ...lattice, n: sn, spacing: lattice.spacing * s };
  const surveyed = fitRelief(spec, { ...surveyFrame, heights: composeRect(spec, landforms, surveyFrame, 0, sn, 0, sn).raw });
  const { mean } = surveyed;
  const fit = surveyed.fit < 1 ? surveyed.fit * (1 - TERRAIN.surveyMargin) : 1;
  const { streams, ponds } = solveWater(spec, landforms, lattice, (x0, z0, side) => {
    const frame: LatticeFrame = { n: side, spacing: lattice.spacing, origin: worldOf(lattice, x0), originZ: worldOfZ(lattice, z0) };
    return composeRect(spec, landforms, frame, 0, side, 0, side).raw.map((h) => mean + (h - mean) * fit);
  });
  return { spec, landforms, mean, fit, streams, ponds };
}

/** Land is baked in square tiles of `size` samples a side, each composed with a margin wide enough for its shore. */
export const TILE = { size: 256, margin: Math.ceil(SHORE_CAP / TERRAIN.spacing) + 1 } as const;

/** One tile of a world's land, as the whole world's bake would hold it. */
export interface TerrainTile {
  /** The world lattice's column and row of the tile's first sample, its samples a side, and how many of the world's samples apart they lie. */
  readonly x0: number;
  readonly z0: number;
  readonly n: number;
  readonly stride: number;
  /** Row-major over the tile, as `Terrain`'s arrays are over the world. */
  readonly heights: Float32Array;
  readonly waterLevel: Float32Array;
  readonly shore: Float32Array;
  readonly region: Uint8Array;
  readonly coverRegions: Uint8Array;
  readonly coverShares: Uint8Array;
}

/**
 * Bakes the tile whose first sample is the world lattice's column `x0`, row
 * `z0`, from `plan` alone: its own ground composed with a margin, fitted, the
 * plan's water cut in and the shore measured, byte for byte as a bake of the
 * whole world holds those samples. With a `stride`, the tile takes every
 * stride-th sample of the world's lattice, as a coarser level of the land
 * does: the same heights, water and cover there, and the shore measured
 * between its own samples.
 */
export function bakeTile(plan: TerrainPlan, x0: number, z0: number, size: number = TILE.size, stride = 1): TerrainTile {
  const world = frameOf(plan.spec);
  const m = stride === 1 ? TILE.margin : Math.ceil(SHORE_CAP / (world.spacing * stride)) + 1;
  const side = size + 2 * m;
  const frame: Lattice = { n: side, spacing: world.spacing * stride, origin: worldOf(world, x0 - m * stride), originZ: worldOf(world, z0 - m * stride), heights: new Float32Array(0) };
  const composed = composeRect(plan.spec, plan.landforms, frame, 0, side, 0, side);
  const heights = composed.raw.map((h) => plan.mean + (h - plan.mean) * plan.fit);
  const window: Lattice = { ...frame, heights };
  const waterLevel = new Float32Array(side * side).fill(DRY);
  for (const stream of plan.streams) carveStream(window, heights, waterLevel, stream);
  for (const { pond, depth } of plan.ponds) carvePond(window, heights, waterLevel, pond, depth);
  const shore = shoreField(window, heights, waterLevel);
  /** The tile's own samples, `per` values each, without the margin. */
  const inner = <T extends Float32Array | Uint8Array>(a: T, per: number): T => {
    const out = a.slice(0, size * size * per) as T;
    for (let j = 0; j < size; j++) out.set(a.subarray(((j + m) * side + m) * per, ((j + m) * side + m + size) * per), j * size * per);
    return out;
  };
  return {
    x0,
    z0,
    n: size,
    stride,
    heights: inner(heights, 1),
    waterLevel: inner(waterLevel, 1),
    shore: inner(shore, 1),
    region: inner(composed.region, 1),
    coverRegions: inner(composed.coverRegions, COVER_TAPS),
    coverShares: inner(composed.coverShares, COVER_TAPS),
  };
}

/** Whether `heights` scaled about `mean` by `fit` keep the walkable square inside the relief budget, with room for water. */
function fitsBudget(spec: WorldSpec, l: Lattice, heights: Float32Array, mean: number, fit: number): boolean {
  const inside = (ix: number, iz: number): boolean => withinLand(spec, worldOf(l, ix), worldOf(l, iz));
  return withinBudget(measureRelief(l, heights.map((h) => mean + (h - mean) * fit), inside), TERRAIN.waterMargin);
}

/** The largest scale about its mean that keeps `l`'s heights inside the budget: 1 when they already fit, else found to 14 halvings. */
function fitRelief(spec: WorldSpec, l: Lattice): { mean: number; fit: number } {
  let mean = 0;
  for (const h of l.heights) mean += h;
  mean /= l.heights.length;
  const fits = (k: number): boolean => fitsBudget(spec, l, l.heights, mean, k);
  if (fits(1)) return { mean, fit: 1 };
  let lo = 0.1;
  let hi = 1;
  for (let step = 0; step < 14; step++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return { mean, fit: lo };
}

/** Bakes the world's one height truth. */
export function bakeTerrain(spec: WorldSpec, lib: Library): Terrain {
  const landforms = landformsOf(spec, lib);
  return finishTerrain(spec, landforms, [composeRows(spec, landforms, 0, frameOf(spec).n)]);
}

/**
 * The part of a region's stream bed that stays inside the region and the
 * walkable square: the longest unbroken run where the region dominates.
 */
function keptRun(spec: WorldSpec, ri: number, local: Float32Array): Float32Array | null {
  const r = spec.regions[ri] as RegionSpec;
  const weights = new Float64Array(spec.regions.length);
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
      ok = withinLand(spec, x, z, 30) && others < 0.75;
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
