// Tracks how much of each cell's vitality on the wait's sheet is settled. The
// field map colors each point by the vitality of nearby files, weighted by size
// and distance, plus a little of its area's own (`healthField`). A cell is
// painted only once most of its weight is settled, so the wait never paints a
// color it later changes, and once every file is settled every cell matches
// the field map.

import { groundVitality } from "@gaia/world";
import { healthPrior, healthWeight } from "../immersive/map-styles.ts";

/** A file on the land: its path, its area's path, its position, the radius of its ground and its size. */
export interface SettlingFile {
  readonly path: string;
  readonly area: string;
  readonly x: number;
  readonly z: number;
  readonly reach: number;
  readonly size: number;
}

/** The land as an `n` by `n` grid of `cell`-meter cells from (-reach, -reach), with each cell's nearest area as an index into `areas`. */
export interface SettlingLand {
  readonly n: number;
  readonly cell: number;
  readonly reach: number;
  readonly nearest: Int16Array;
  readonly areas: readonly string[];
}

/** An inclusive cell box from `i0`, `j0` to `i1`, `j1`. */
export type CellBox = readonly [number, number, number, number];

/**
 * The settled share of a cell's weight at which painting starts, and the share at which the cell is fully painted. A
 * partly painted cell already shows most of its final vitality, so the rest barely changes it.
 */
export const SHOWN: readonly [number, number] = [0.55, 0.95];

export interface SettlingHealth {
  /** Settles files' vitality by path. Returns the changed cell box and the areas whose own ground's vitality is now known. */
  settle(vitality: Readonly<Record<string, number>>): { readonly cells: CellBox | null; readonly grounds: readonly string[] };
  /** The settled share of a cell's weight, 0 to 1, and the cell's vitality from its settled part. */
  settled(c: number): number;
  vitality(c: number): number;
  /** How much of a cell to paint, 0 to 1, rising smoothly between the two `SHOWN` shares. */
  paint(c: number): number;
  /** An area's own ground's vitality, once every file it pools is settled. */
  ground(path: string): number | undefined;
}

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Builds the settling vitality of `land` from its files, yielding between steps so a caller can spread the work over
 * idle time. It sums every cell's total weight first, which gives the share each settled file contributes.
 */
export function* settlingHealth(land: SettlingLand, files: readonly SettlingFile[], spread: number): Generator<void, SettlingHealth> {
  const { n, cell, reach, nearest, areas } = land;
  const whole = new Float32Array(n * n);
  const weight = new Float32Array(n * n);
  const sum = new Float32Array(n * n);
  const prior = healthPrior(files);
  whole.fill(prior);
  const center = (i: number): number => -reach + (i + 0.5) * cell;
  /** Calls `each` with every cell a file's vitality reaches and its weight there, and returns their box. */
  const reachOf = (f: SettlingFile, each: (c: number, w: number) => void): CellBox | null => {
    const r = f.reach + spread * 4;
    const i0 = Math.max(0, Math.floor((f.x - r + reach) / cell));
    const i1 = Math.min(n - 1, Math.floor((f.x + r + reach) / cell));
    const j0 = Math.max(0, Math.floor((f.z - r + reach) / cell));
    const j1 = Math.min(n - 1, Math.floor((f.z + r + reach) / cell));
    if (i0 > i1 || j0 > j1) return null;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w = healthWeight(f, center(i), center(j), spread);
        if (w > 0) each(j * n + i, w);
      }
    }
    return [i0, j0, i1, j1];
  };
  for (const [k, f] of files.entries()) {
    reachOf(f, (c, w) => (whole[c] = (whole[c] as number) + w));
    if (k % 24 === 23) yield;
  }

  // Each area's own ground pools its own files, or its subdirectories' files when it has none (`groundVitality`).
  const byPath = new Map(files.map((f) => [f.path, f]));
  const pools = new Map<string, SettlingFile[]>();
  for (const path of areas) {
    const own = files.filter((f) => f.area === path);
    pools.set(path, own.length > 0 ? own : files.filter((f) => path === "" || f.area.startsWith(`${path}/`)));
  }
  const waiting = new Map([...pools].map(([path, pool]) => [path, new Set(pool.map((f) => f.path))]));
  const health = new Map<string, number>();
  const grounds = new Map<string, number>();
  const cellsOf = new Map<number, number[]>();
  for (let c = 0; c < n * n; c++) {
    const k = nearest[c] as number;
    if (k < 0) continue;
    const list = cellsOf.get(k);
    if (list === undefined) cellsOf.set(k, [c]);
    else list.push(c);
  }
  yield;

  const grow = (box: CellBox | null, more: CellBox | null): CellBox | null =>
    box === null ? more : more === null ? box : [Math.min(box[0], more[0]), Math.min(box[1], more[1]), Math.max(box[2], more[2]), Math.max(box[3], more[3])];
  /** Settles an area's ground vitality and adds it, at the prior weight, to every cell nearest the area. */
  const settleGround = (k: number, path: string): CellBox | null => {
    const pool = pools.get(path) ?? [];
    const v = pool.length === 0 ? 1 : (groundVitality(pool.map((f) => ({ area: f.area, vitality: health.get(f.path) ?? 1, size: f.size }))).get(path) ?? 1);
    grounds.set(path, v);
    let box: CellBox | null = null;
    for (const c of cellsOf.get(k) ?? []) {
      weight[c] = (weight[c] as number) + prior;
      sum[c] = (sum[c] as number) + prior * v;
      const i = c % n;
      const j = Math.floor(c / n);
      box = grow(box, [i, j, i, j]);
    }
    return box;
  };
  // An area with no files has its ground vitality from the start.
  let first: CellBox | null = null;
  for (const [k, path] of areas.entries()) if ((waiting.get(path)?.size ?? 0) === 0) first = grow(first, settleGround(k, path));
  void first;

  return {
    settle(vitality) {
      let cells: CellBox | null = null;
      const done: string[] = [];
      for (const [path, v] of Object.entries(vitality)) {
        const f = byPath.get(path);
        if (f === undefined || health.has(path)) continue;
        health.set(path, v);
        cells = grow(cells, reachOf(f, (c, w) => {
          weight[c] = (weight[c] as number) + w;
          sum[c] = (sum[c] as number) + w * v;
        }));
        for (const [area, left] of waiting) {
          if (!left.delete(path) || left.size > 0) continue;
          waiting.delete(area);
          done.push(area);
        }
      }
      for (const area of done) cells = grow(cells, settleGround(areas.indexOf(area), area));
      return { cells, grounds: done };
    },
    settled: (c) => Math.min(1, (weight[c] as number) / (whole[c] as number)),
    vitality: (c) => ((weight[c] as number) > 0 ? (sum[c] as number) / (weight[c] as number) : 1),
    paint: (c) => smooth(SHOWN[0], SHOWN[1], (weight[c] as number) / (whole[c] as number)),
    ground: (path) => grounds.get(path),
  };
}
