// The relief budget limits how much the land may rise and fall. Low relief
// keeps sight lines short, so distant ground never needs full detail.

import type { Lattice } from "./lattice.ts";

export const RELIEF_BUDGET = {
  /** Highest ground minus lowest ground anywhere, in meters. */
  range: 24,
  /** Steepest ground anywhere, in degrees. It allows for terrace risers and stream banks. */
  maxSlope: 40,
  /** Steepest ground in degrees that counts as walkable. */
  walkSlope: 30,
  /** The share of ground that must be walkable. */
  walkShare: 0.95,
  /** Tallest unbroken climb steeper than `walkSlope`, in meters. */
  maxStep: 3,
} as const;

export interface ReliefReport {
  readonly min: number;
  readonly max: number;
  readonly range: number;
  /** Degrees. */
  readonly maxSlope: number;
  readonly walkShare: number;
  /** Meters. */
  readonly maxStep: number;
}

const DEG = 180 / Math.PI;

function maxStepAlongLine(
  heights: Float32Array,
  start: number,
  stride: number,
  count: number,
  spacing: number,
  walkGrade: number,
  line: number,
  alongRows: boolean,
  include?: (ix: number, iz: number) => boolean,
): number {
  let maxStep = 0;
  let climb = 0;
  let sign = 0;
  for (let k = 0; k + 1 < count; k++) {
    if (
      include !== undefined &&
      !(alongRows ? include(k, line) : include(line, k))
    ) {
      climb = 0;
      continue;
    }
    const d =
      (heights[start + (k + 1) * stride] as number) -
      (heights[start + k * stride] as number);
    const s = Math.sign(d);
    if (Math.abs(d) / spacing > walkGrade && (s === sign || climb === 0)) {
      climb += Math.abs(d);
      sign = s;
      if (climb > maxStep) maxStep = climb;
    } else {
      climb = 0;
      sign = 0;
    }
  }
  return maxStep;
}

function measureSampleSlopes(
  heights: Float32Array,
  n: number,
  spacing: number,
  walkGrade: number,
  include?: (ix: number, iz: number) => boolean,
): {
  readonly min: number;
  readonly max: number;
  readonly steepest: number;
  readonly walkable: number;
  readonly cells: number;
} {
  let min = Infinity;
  let max = -Infinity;
  let steepest = 0;
  let walkable = 0;
  let cells = 0;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      if (include !== undefined && !include(ix, iz)) continue;
      const h = heights[iz * n + ix] as number;
      min = Math.min(min, h);
      max = Math.max(max, h);
      if (ix === n - 1 || iz === n - 1) continue;
      const i = iz * n + ix;
      const h10 = heights[i + 1] as number;
      const h01 = heights[i + n] as number;
      const h11 = heights[i + n + 1] as number;
      const gx = (h10 - h + (h11 - h01)) / (2 * spacing);
      const gz = (h01 - h + (h11 - h10)) / (2 * spacing);
      const grade = Math.hypot(gx, gz);
      steepest = Math.max(steepest, grade);
      if (grade <= walkGrade) walkable++;
      cells++;
    }
  }
  return { min, max, steepest, walkable, cells };
}

/** Measures relief over the samples where `include` is true (all when omitted). */
export function measureRelief(
  l: Lattice,
  heights: Float32Array = l.heights,
  include?: (ix: number, iz: number) => boolean,
): ReliefReport {
  const { n, spacing } = l;
  const walkGrade = Math.tan(RELIEF_BUDGET.walkSlope / DEG);
  const { min, max, steepest, walkable, cells } = measureSampleSlopes(
    heights,
    n,
    spacing,
    walkGrade,
    include,
  );
  // The tallest run of consecutive same-direction steps steeper than `walkSlope`, along rows and columns.
  let maxStep = 0;
  for (let line = 0; line < n; line++) {
    maxStep = Math.max(
      maxStep,
      maxStepAlongLine(
        heights,
        line * n,
        1,
        n,
        spacing,
        walkGrade,
        line,
        true,
        include,
      ),
      maxStepAlongLine(
        heights,
        line,
        n,
        n,
        spacing,
        walkGrade,
        line,
        false,
        include,
      ),
    );
  }
  return {
    min,
    max,
    range: max - min,
    maxSlope: Math.atan(steepest) * DEG,
    walkShare: cells === 0 ? 1 : walkable / cells,
    maxStep,
  };
}

/** True when the report fits the budget, keeping `rangeMargin` meters spare for water to cut into. */
export function withinBudget(r: ReliefReport, rangeMargin = 0): boolean {
  const b = RELIEF_BUDGET;
  return (
    r.range <= b.range - rangeMargin &&
    r.maxSlope <= b.maxSlope &&
    r.walkShare >= b.walkShare &&
    r.maxStep <= b.maxStep
  );
}
