// Where the sheets letter areas' names. The field map and the wait letter
// every area's name in the same place because both work the places out here,
// once for the whole sheet, from the same land: every area's outline and the
// lots where its buildings and landmarks will stand, as the world service
// sends them before anything is judged (`world.progress` stage `land`). Where
// the person stands is not an input, so a name never moves or vanishes as
// they walk.
//
// A name sits on its area's widest ground and runs the way the area runs. It
// never covers another name. It keeps off the compass rose's corner, the
// sheet's edge and every mark, keeping clear of all the ground any building's
// or landmark's mark could take round its lot. When its own spot is taken it
// tries spots along its own slant, on every side of the mark in its way, a
// step aside and the rest of its own ground; then the same a little smaller;
// and only as a last resort sits over a mark, edged in paper as names are
// over trees. A name may stand beside its own building or landmark, off its
// ground, and a name whose ground is hemmed in by other names stands as near
// beside it as there is room. The smallest areas are lettered first, since
// they have the least room.

import type { Outline } from "@gaia/terrain";
import { LAYOUT, type LotPlace } from "@gaia/world";
import { MARK_REACH, markScale } from "./marks.ts";

/** The land's cells, meters a side, as both sheets sample them for names. */
export const CELL = 5;
/** The serif every name on the sheets is set in. */
export const SERIF = `"Iowan Old Style", Georgia, "Times New Roman", serif`;
/** The folders lettered above a name that repeats. */
export const PARENT_FONT = `italic 600 10px ${SERIF}`;
/** An area's name in upright capitals at `size` pixels, and the space between its letters, widely spaced as a survey letters its regions. */
export const nameFont = (size: number): string => `600 ${size}px ${SERIF}`;
export const nameSpacing = (size: number): number => +(size * 0.17).toFixed(1);
/**
 * The field map's compass rose: its middle from the sheet's lower right corner, and how far round it a tap finds
 * you, pixels. Names keep clear of its corner on every sheet, the wait's too.
 */
export const ROSE = { right: 46, bottom: 62, reach: 30 } as const;

/** Areas' names' size, pixels, on a sheet at the scale they were placed for. */
const NAME_SIZE = 13.5;
/** How much smaller a name is lettered when no spot fits it at its size. */
const SMALLER = 0.86;
/**
 * The smallest sheet names are placed for, pixels a side: a smaller sheet, a phone's, shows the same lettering
 * smaller rather than crowding every name onto it.
 */
const LEAST_SIDE = 640;
/** How far a name keeps from the sheet's edge, and from a mark beside it, pixels. */
const EDGE = 4;
const GAP = 3;
/** How far along the way its area runs a name may slide from its own spot, pixels, each way. */
const SLANT = [14, 28, 42, 56, 70];
/** Where else a name may step to, pixels, when its spot and its slant are taken. */
const NUDGES: readonly (readonly [number, number])[] = [[0, 26], [0, -26], [34, 10], [-34, 10], [0, 48], [0, -48], [56, 0], [-56, 0], [40, 36], [-40, 36], [40, -36], [-40, -36]];
/** How far from its own ground a name's middle may sit and still touch it, and how far it looks past its ground once none of that is free, pixels. */
const NEAR = 24;
const AFIELD = 260;
/** How far from its lot's middle a building or landmark may stand, meters, whichever it turns out to be. */
const LOT_REACH = Math.max(...Object.values(LAYOUT.lotReach));

/** A box on a sheet, pixels: left, top, right, bottom. */
export type Box = readonly [number, number, number, number];

/** Measures `text` set in `font` with `spacing` pixels between its letters, pixels. */
export type Measure = (text: string, font: string, spacing: number) => number;

/** An area as the sheets letter it: its path, its depth and its folder's name. */
export interface NamedArea {
  readonly path: string;
  readonly depth: number;
  readonly name: string;
}

/** Where an area's name is lettered on the land. */
export interface AreaLabel<A = NamedArea> {
  readonly area: A;
  readonly index: number;
  /** The box its ground spans, meters: a tap on its name brings the map round to it. */
  readonly bounds: readonly [number, number, number, number];
  /** Its heart, where its name is written when nothing is in the way: the area's widest ground. */
  readonly x: number;
  readonly z: number;
  readonly cells: number;
  /** The way the area runs, radians from east toward south: its name is lettered along it. */
  readonly angle: number;
  /** The folders lettered above its name, when another area shares the name (`nameTails`); otherwise empty. */
  readonly above: string;
}

/** The land both sheets letter: what the world service sends before anything is judged, rastered once. */
export interface NameLand {
  /** How far the sheet reaches from the land's middle, and the land's own half side, meters. */
  readonly reach: number;
  readonly half: number;
  /** The area whose own ground holds each cell (`CELL` meters, `n` a side, from (-reach, -reach)) by its index in the outlines, or -1. */
  readonly at: Int16Array;
  readonly n: number;
  /** Where each area with ground of its own is lettered when nothing is in the way. */
  readonly labels: readonly AreaLabel[];
  readonly lots: readonly LotPlace[];
}

/** An area's name, placed. */
export interface NamePlace {
  readonly label: AreaLabel;
  /** Where its lettering's middle sits on the land, meters: a view letters it there at any zoom. */
  readonly x: number;
  readonly z: number;
  /** Its capitals' size, pixels, on a sheet at the scale the names were placed for. */
  readonly size: number;
  /** How far its lettering reaches either side of its middle along the way it runs, and above its middle, pixels. */
  readonly halfW: number;
  readonly top: number;
  /** The box it takes on the sheet, pixels from its middle. */
  readonly box: Box;
  /** Whether no spot was free of the marks, so it sits over one. */
  readonly over: boolean;
}

/** Every area's name placed on a sheet, and the scale it was placed for, pixels a meter: a view of the land at a smaller scale letters it smaller. */
export interface NamePlaces {
  readonly scale: number;
  readonly places: readonly NamePlace[];
}

/**
 * For each path, the folders above its own name that the map letters with it:
 * none for a name no other path shares, and otherwise just enough of the path
 * above it that no other path ends the same way ("world" above a `src` when
 * another `src` sits elsewhere). Folders are joined with " / ".
 */
export function nameTails(paths: readonly string[]): Map<string, string> {
  const parts = paths.map((p) => p.split("/"));
  const ends = (segs: readonly string[], k: number): string => segs.slice(-k).join("/");
  const tails = new Map<string, string>();
  for (const segs of parts) {
    let k = 1;
    while (k < segs.length && parts.some((o) => o !== segs && ends(o, k) === ends(segs, k))) k++;
    tails.set(segs.join("/"), segs.slice(-k, -1).join(" / "));
  }
  return tails;
}

/** Measures with a canvas, as the sheets letter names on one. */
export function canvasMeasure(ctx: CanvasRenderingContext2D): Measure {
  return (text, font, spacing) => {
    ctx.font = font;
    ctx.letterSpacing = `${spacing}px`;
    const width = ctx.measureText(text).width;
    ctx.letterSpacing = "0px";
    return width;
  };
}

/**
 * The land as both sheets letter it: each cell's area from the areas'
 * outlines as traced, each with its subdirectories cut out, and where each
 * area with ground of its own is lettered when nothing is in the way. `size`
 * is the land's side and `reach` how far the sheet reaches from its middle,
 * meters; `lots` are where its buildings and landmarks will stand.
 */
export function* nameLand(areas: readonly Outline[], size: number, reach: number, lots: readonly LotPlace[]): Generator<void, NameLand> {
  const n = Math.ceil((reach * 2) / CELL);
  const at = new Int16Array(n * n).fill(-1);
  const parentOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  for (const [i, o] of areas.entries()) {
    const holes = areas.flatMap((c) => (c.depth === o.depth + 1 && parentOf(c.path) === o.path ? c.rings : []));
    fillCells(at, n, reach, [...o.rings, ...holes], i);
    if (i % 4 === 3) yield;
  }
  // A cell whose middle the tracing put on the far side of a border, its area's alone among its neighbors, goes to
  // most of them, so no sliver reads as an area's own ground.
  for (let c = 0; c < n * n; c++) {
    const i = c % n;
    const around = [i > 0 ? at[c - 1] : undefined, i < n - 1 ? at[c + 1] : undefined, at[c - n], at[c + n]].filter((k): k is number => k !== undefined);
    if (around.includes(at[c] as number)) continue;
    at[c] = around.reduce((best, k) => (around.filter((q) => q === k).length > around.filter((q) => q === best).length ? k : best), around[0] ?? -1);
  }
  yield;
  const labels = labelsOf(at, n, CELL, reach, areas.map((o) => ({ path: o.path, depth: o.depth, name: o.path.slice(o.path.lastIndexOf("/") + 1) })));
  yield;
  return { reach, half: size / 2, at, n, labels, lots };
}

/**
 * Marks with `id` the cells (`n` a side, `CELL` meters, from (-reach, -reach)) whose middles lie inside `rings`,
 * even-odd, so a ring inside another cuts it out: a row at a time, between each pair of the rings' crossings.
 */
function fillCells(cells: Int16Array, n: number, reach: number, rings: readonly (readonly number[])[], id: number): void {
  const rows: number[][] = Array.from({ length: n }, () => []);
  const row = (z: number): number => (z + reach) / CELL - 0.5;
  for (const ring of rings) {
    const count = ring.length / 2;
    for (let k = 0; k < count; k++) {
      const ax = ring[k * 2] as number;
      const az = ring[k * 2 + 1] as number;
      const bx = ring[((k + 1) % count) * 2] as number;
      const bz = ring[((k + 1) % count) * 2 + 1] as number;
      const [ra, rb] = [row(az), row(bz)];
      // The rows whose middles this edge crosses, each counted once where two edges meet.
      for (let j = Math.max(0, Math.ceil(Math.min(ra, rb))); j <= Math.min(n - 1, Math.ceil(Math.max(ra, rb)) - 1); j++) {
        const t = (j - ra) / (rb - ra);
        (rows[j] as number[]).push(ax + (bx - ax) * t);
      }
    }
  }
  for (const [j, xs] of rows.entries()) {
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil(((xs[q] as number) + reach) / CELL - 0.5));
      const i1 = Math.min(n - 1, Math.ceil(((xs[q + 1] as number) + reach) / CELL - 0.5) - 1);
      for (let i = i0; i <= i1; i++) cells[j * n + i] = id;
    }
  }
}

/**
 * The way a patch of ground runs, from the sums of its cells' positions: its
 * long axis kept within a gentle slant so a name along it reads upright
 * (radians from east toward south, none for a round patch).
 */
function slantOf(s: { readonly x: number; readonly z: number; readonly xx: number; readonly zz: number; readonly xz: number; readonly cells: number }): number {
  const mx = s.x / s.cells;
  const mz = s.z / s.cells;
  const vx = s.xx / s.cells - mx * mx;
  const vz = s.zz / s.cells - mz * mz;
  const vxz = s.xz / s.cells - mx * mz;
  const spread = Math.sqrt(((vx - vz) / 2) ** 2 + vxz * vxz);
  const long = (vx + vz) / 2 + spread;
  const short = Math.max(1e-6, (vx + vz) / 2 - spread);
  let angle = 0.5 * Math.atan2(2 * vxz, vx - vz);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  const elongated = Math.max(0, Math.min(1, (Math.sqrt(long / short) - 1.3) / 1.2));
  return Math.max(-0.42, Math.min(0.42, angle)) * elongated;
}

/**
 * Where each area's name is lettered when nothing is in the way, from a raster of the land: `at` names the area
 * whose own ground holds each of its cells (`n` a side, `cell` meters, from the sheet's corner `reach` meters out) by
 * its index in `areas`, or -1. A name sits on the cell of its area's own ground farthest from its edges, nearest its
 * middle among equals, so it never sits on its rim or past the land's edge, and runs the way its area runs.
 */
export function labelsOf<A extends { readonly path: string; readonly depth: number }>(at: Int16Array, n: number, cell: number, reach: number, areas: readonly A[]): AreaLabel<A>[] {
  const sums = areas.map(() => ({ x: 0, z: 0, xx: 0, zz: 0, xz: 0, cells: 0, i0: n, i1: -1, j0: n, j1: -1 }));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const s = sums[at[j * n + i] as number];
      if (s === undefined) continue;
      const x = -reach + (i + 0.5) * cell;
      const z = -reach + (j + 0.5) * cell;
      s.x += x;
      s.z += z;
      s.xx += x * x;
      s.zz += z * z;
      s.xz += x * z;
      s.cells += 1;
      s.i0 = Math.min(s.i0, i);
      s.i1 = Math.max(s.i1, i);
      s.j0 = Math.min(s.j0, j);
      s.j1 = Math.max(s.j1, j);
    }
  }
  // How far each cell lies from its area's edge, in cells, uncapped: a name goes where its area is widest.
  const deep = new Float32Array(n * n).fill(n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = j * n + i;
      const k = at[c];
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1 || at[c - 1] !== k || at[c + 1] !== k || at[c - n] !== k || at[c + n] !== k) deep[c] = 0;
    }
  }
  for (let c = 0; c < n * n; c++) {
    if (c % n > 0) deep[c] = Math.min(deep[c] as number, (deep[c - 1] as number) + 1);
    if (c >= n) deep[c] = Math.min(deep[c] as number, (deep[c - n] as number) + 1);
  }
  for (let c = n * n - 1; c >= 0; c--) {
    if (c % n < n - 1) deep[c] = Math.min(deep[c] as number, (deep[c + 1] as number) + 1);
    if (c < n * n - n) deep[c] = Math.min(deep[c] as number, (deep[c + n] as number) + 1);
  }
  const tails = nameTails(areas.filter((a) => a.depth > 0).map((a) => a.path));
  return areas.flatMap((area, k): AreaLabel<A>[] => {
    const s = sums[k] as (typeof sums)[number];
    if (s.cells === 0) return [];
    const mx = s.x / s.cells;
    const mz = s.z / s.cells;
    let x = mx;
    let z = mz;
    let best = -Infinity;
    for (let j = s.j0; j <= s.j1; j++) {
      for (let i = s.i0; i <= s.i1; i++) {
        if (at[j * n + i] !== k) continue;
        const cx = -reach + (i + 0.5) * cell;
        const cz = -reach + (j + 0.5) * cell;
        const score = (deep[j * n + i] as number) - Math.hypot(cx - mx, cz - mz) / (cell * 40);
        if (score > best) {
          best = score;
          x = cx;
          z = cz;
        }
      }
    }
    const edge = (i: number): number => -reach + i * cell;
    return [{ area, index: k, bounds: [edge(s.i0), edge(s.j0), edge(s.i1 + 1), edge(s.j1 + 1)], x, z, cells: s.cells, angle: slantOf(s), above: tails.get(area.path) ?? "" }];
  });
}

/** How a name's lettering lies around its middle at a size: how far it reaches along the way it runs and above, and the box it takes, pixels. */
interface Shape {
  readonly size: number;
  readonly halfW: number;
  readonly top: number;
  readonly box: Box;
}

function shapeOf(measure: Measure, l: AreaLabel, size: number): Shape {
  const nameW = measure(l.area.name.toUpperCase(), nameFont(size), nameSpacing(size));
  const parentW = l.above === "" ? 0 : measure(l.above, PARENT_FONT, 0);
  const halfW = Math.max(nameW, parentW) / 2 + 4;
  const top = l.above === "" ? 11 : 21;
  // The lettering, turned the way its area runs, in a box square to the sheet.
  const cos = Math.abs(Math.cos(l.angle));
  const sin = Math.abs(Math.sin(l.angle));
  const hw = halfW * cos + ((top + 12) / 2) * sin;
  const hh = halfW * sin + ((top + 12) / 2) * cos;
  const lift = (top - 12) / 2;
  return { size, halfW, top, box: [-hw, -hh - lift, hw, hh - lift] };
}

const hits = (a: Box, b: Box): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** A spot a name may take: its middle, pixels, and whether it is beside the mark of a lot on its own ground. */
interface Spot {
  readonly x: number;
  readonly y: number;
  readonly beside: boolean;
}

/** A name's place: its shape, its middle, pixels, and whether it sits over a mark. */
interface Chosen {
  readonly shape: Shape;
  readonly x: number;
  readonly y: number;
  readonly over: boolean;
}

const boxOf = (shape: Shape, x: number, y: number): Box => [x + shape.box[0], y + shape.box[1], x + shape.box[2], y + shape.box[3]];

/**
 * Places every area's name on a sheet `side` pixels a side showing `land`, each nearest its own spot where nothing is
 * in the way, as this module's opening says, the marks drawn `grow` times their size on the whole sheet. A sheet
 * smaller than the least that names are placed for gets the least's places, lettered smaller.
 */
export function* placeNames(land: NameLand, side: number, measure: Measure, grow = 1): Generator<void, NamePlaces> {
  const sheet = Math.max(side, LEAST_SIDE);
  const scale = sheet / (land.reach * 2);
  const px = (v: number): number => (v + land.reach) * scale;
  const meters = (p: number): number => p / scale - land.reach;
  const areaAt = (x: number, y: number): number => {
    const i = Math.floor(x / scale / CELL);
    const j = Math.floor(y / scale / CELL);
    return i < 0 || j < 0 || i >= land.n || j >= land.n ? -1 : (land.at[j * land.n + i] as number);
  };
  // Each lot's mark, wherever on its lot its building or landmark stands and whichever it turns out to be.
  const s = markScale(scale, grow);
  const lot = LOT_REACH * scale;
  const marks: Box[] = land.lots.map(({ x, z }) => [px(x) - MARK_REACH.left * s - lot, px(z) - MARK_REACH.up * s - lot, px(x) + MARK_REACH.right * s + lot, px(z) + MARK_REACH.down * s + lot]);
  const lotArea = land.lots.map(({ x, z }) => areaAt(px(x), px(z)));
  const rose: Box = [sheet - ROSE.right - 34, sheet - ROSE.bottom - 46, sheet, sheet];
  const edge = land.half ** 4;
  const inside = (b: Box): boolean =>
    b[0] > EDGE && b[1] > EDGE && b[2] < sheet - EDGE && b[3] < sheet - EDGE && !hits(b, rose) && [b[0], b[2]].every((x) => [b[1], b[3]].every((y) => meters(x) ** 4 + meters(y) ** 4 < edge));
  const named: Box[] = [];
  const clear = (b: Box): boolean => named.every((o) => !hits(b, o));
  const covers = (b: Box): number => marks.reduce((sum, m) => sum + overlap(b, m), 0);
  const free = (b: Box): boolean => covers(b) === 0;

  // The smallest areas are lettered first: they have the least room, and a larger area's name has room to spare on
  // its own ground.
  const places: NamePlace[] = [];
  for (const l of [...land.labels].sort((a, b) => a.cells - b.cells)) {
    // The repository's root is the whole sheet, and it is not lettered.
    if (l.area.depth === 0) continue;
    const ax = px(l.x);
    const ay = px(l.z);
    // Every cell of its own ground, nearest its own spot first, pixels: found only for a name that needs it.
    let cells: [number, number][] | null = null;
    const ground = (): [number, number][] => {
      if (cells !== null) return cells;
      const [i0, j0, i1, j1] = l.bounds.map((v) => Math.floor((v + land.reach) / CELL)) as [number, number, number, number];
      cells = [];
      for (let j = Math.max(0, j0); j < Math.min(land.n, j1); j++) {
        for (let i = Math.max(0, i0); i < Math.min(land.n, i1); i++) if (land.at[j * land.n + i] === l.index) cells.push([(i + 0.5) * CELL * scale, (j + 0.5) * CELL * scale]);
      }
      return cells.sort((a, b) => Math.hypot(a[0] - ax, a[1] - ay) - Math.hypot(b[0] - ax, b[1] - ay));
    };
    /** Whether a name in `b` sits on its own ground: its middle there, or beside the mark of a lot there, which stands for it. */
    const on = (b: Box, beside: boolean): boolean => beside || areaAt((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) === l.index;
    /** Whether a name in `b` touches its own ground, its middle no more than `NEAR` from it. */
    const near = (b: Box, beside: boolean): boolean => on(b, beside) || ground().some(([gx, gy]) => Math.hypot(gx - (b[0] + b[2]) / 2, gy - (b[1] + b[3]) / 2) <= NEAR);

    // Where the name may go at a size, in the order it tries them: its own spot, along its own slant, on every side
    // of each mark in its way, a step aside, and the rest of its own ground.
    function* spots(shape: Shape): Generator<readonly [Shape, Spot]> {
      const spot = (x: number, y: number, beside = false): readonly [Shape, Spot] => [shape, { x, y, beside }];
      yield spot(ax, ay);
      const [cos, sin] = [Math.cos(l.angle), Math.sin(l.angle)];
      for (const t of SLANT) yield* [spot(ax + t * cos, ay + t * sin), spot(ax - t * cos, ay - t * sin)];
      const [x0, y0, x1, y1] = shape.box;
      const here = boxOf(shape, ax, ay);
      const around: (readonly [Shape, Spot])[] = [];
      for (const [k, m] of marks.entries()) {
        if (!hits(m, [here[0] - 60, here[1] - 60, here[2] + 60, here[3] + 60])) continue;
        const [left, right, above, below] = [m[0] - GAP - x1, m[2] + GAP - x0, m[1] - GAP - y1, m[3] + GAP - y0];
        const [mx, my] = [(m[0] + m[2]) / 2, (m[1] + m[3]) / 2];
        for (const [x, y] of [[left, ay], [right, ay], [ax, above], [ax, below], [left, my], [right, my], [mx, above], [mx, below], [left, above], [right, above], [left, below], [right, below]] as const) {
          around.push(spot(x, y, lotArea[k] === l.index));
        }
      }
      yield* around.sort(([, a], [, b]) => Math.hypot(a.x - ax, a.y - ay) - Math.hypot(b.x - ax, b.y - ay));
      for (const [dx, dy] of NUDGES) yield spot(ax + dx, ay + dy);
      for (const [x, y] of ground()) yield spot(x, y);
    }
    // Round its own spot, nearest first, at either size: where a name hemmed in by others looks for room.
    function* afield(): Generator<readonly [Shape, Spot]> {
      for (let r = 8; r <= AFIELD; r += 8) {
        const count = Math.ceil((Math.PI * 2 * r) / 10);
        for (let k = 0; k < count; k++) {
          const spot = { x: ax + Math.cos((k / count) * Math.PI * 2) * r, y: ay + Math.sin((k / count) * Math.PI * 2) * r, beside: false };
          yield* [[full, spot], [small, spot]] as const;
        }
      }
    }
    /**
     * Of the spots tried, the first whose box lies on the sheet, clear of every name and of the rose, that `ok` takes;
     * or, with `least`, the one of them covering the marks least.
     */
    const pick = (tries: Iterable<readonly [Shape, Spot]>, ok: (b: Box, beside: boolean) => boolean, least = false): Chosen | null => {
      let best: Chosen | null = null;
      let fewest = Infinity;
      for (const [shape, { x, y, beside }] of tries) {
        const b = boxOf(shape, x, y);
        if (!inside(b) || !clear(b) || !ok(b, beside)) continue;
        const c = covers(b);
        if (!least) return { shape, x, y, over: c > 0 };
        if (c < fewest) [fewest, best] = [c, { shape, x, y, over: c > 0 }];
      }
      return best;
    };

    const full = shapeOf(measure, l, NAME_SIZE);
    const small = shapeOf(measure, l, NAME_SIZE * SMALLER);
    const { shape, x, y, over } =
      // Clear of every mark, on its own ground and then touching it, at its size and then a little smaller.
      pick(spots(full), (b, beside) => free(b) && on(b, beside)) ??
      pick(spots(full), (b, beside) => free(b) && near(b, beside)) ??
      pick(spots(small), (b, beside) => free(b) && on(b, beside)) ??
      pick(spots(small), (b, beside) => free(b) && near(b, beside)) ??
      // As a last resort over a mark, touching its own ground, where it covers least.
      pick([...spots(full), ...spots(small)], near, true) ??
      // Its ground hemmed in by other names, the nearest room beside it, clear of the marks if any is. A name is never
      // left out: on a sheet too full for it, it sits at its own spot.
      pick(afield(), free) ??
      pick(afield(), () => true) ?? { shape: full, x: ax, y: ay, over: !free(boxOf(full, ax, ay)) };
    named.push(boxOf(shape, x, y));
    places.push({ label: l, x: meters(x), z: meters(y), size: shape.size, halfW: shape.halfW, top: shape.top, box: shape.box, over });
    yield;
  }
  return { scale, places };
}
