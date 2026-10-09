// Health on the waiting sheet as it settles. The field map's land is one
// wash of health: at each point the files around it, each weighed by its
// size and how near its ground is, and a little of the health of the area
// the point lies in (`healthField`). While a world opens, each file's health
// arrives once nothing still to be judged can change it, so the wait knows
// at every cell how much of the health it will show is settled, and what
// that settled part says. A cell is painted only as nearly all of its health
// is settled, in what the settled part says, so the wait never paints a color
// it later has to change; once every file is settled, every cell is the
// field map's health.

import { groundVitality } from "@gaia/world";
import { healthPrior, healthWeight } from "../immersive/map-styles.ts";

/** A file on the land: its path, its area's, where it stands, how far its ground reaches and how much code it holds. */
export interface SettlingFile {
  readonly path: string;
  readonly area: string;
  readonly x: number;
  readonly z: number;
  readonly reach: number;
  readonly size: number;
}

/** The land as cells: `n` a side, each `cell` meters, from (-reach, -reach); and each cell's nearest area, by its index in `areas` (their paths). */
export interface SettlingLand {
  readonly n: number;
  readonly cell: number;
  readonly reach: number;
  readonly nearest: Int16Array;
  readonly areas: readonly string[];
}

/** Cells from `i0`, `j0` to `i1`, `j1`, all included. */
export type CellBox = readonly [number, number, number, number];

/**
 * How much of a cell's health must be settled before it is painted at all, and by when it is painted in full: a
 * cell painted in part already has most of its health in what it shows, so what is still to come barely moves it.
 */
export const SHOWN: readonly [number, number] = [0.55, 0.95];

export interface SettlingHealth {
  /** Files' health settled, by path: what changed, the cells and the areas whose own ground's health is now known. */
  settle(vitality: Readonly<Record<string, number>>): { readonly cells: CellBox | null; readonly grounds: readonly string[] };
  /** How much of a cell's health is settled, 0 to 1, and its vitality as far as it is settled. */
  settled(c: number): number;
  vitality(c: number): number;
  /** How much of a cell to paint, 0 to 1: none until most of its health is settled, all once nearly all is (`SHOWN`). */
  paint(c: number): number;
  /** An area's own ground's vitality, once every file it pools is settled. */
  ground(path: string): number | undefined;
}

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Builds the settling health of `land` from its files, a step at a time so a driver can spread the work over idle
 * time: every cell's whole weight is summed first, which is what tells how much of it a settled file is.
 */
export function* settlingHealth(land: SettlingLand, files: readonly SettlingFile[], spread: number): Generator<void, SettlingHealth> {
  const { n, cell, reach, nearest, areas } = land;
  const whole = new Float32Array(n * n);
  const weight = new Float32Array(n * n);
  const sum = new Float32Array(n * n);
  const prior = healthPrior(files);
  whole.fill(prior);
  const center = (i: number): number => -reach + (i + 0.5) * cell;
  /** The cells a file's health reaches, and its weight on each. */
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

  // Each area's own ground pools its own files, or all of its subdirectories' where it holds none (`groundVitality`).
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
  /** An area's ground's health is known: the cells it is nearest take the little weight it has everywhere. */
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
  // An area with no files at all has its ground's health from the start.
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
