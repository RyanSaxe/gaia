// Places area names for the field map and the loading screen (`wait`). Both
// compute the places here, once per sheet, from the area outlines and lots the
// world service sends before Jev judges anything (`world.progress` stage
// `land`). The person's position is not an input, so a name never moves or
// disappears as they walk.

import type { Outline } from "@gaia/terrain";
import { LAYOUT, type LotPlace } from "@gaia/world";
import { MARK_REACH, markScale } from "./marks.ts";
import { pastTheEdge } from "@gaia/terrain";

/** Side in meters of the land cells both sheets sample for names. */
export const CELL = 5;
/** The serif font for every name on the sheets. */
export const SERIF = `"Iowan Old Style", Georgia, "Times New Roman", serif`;
/** The font for the parent folders lettered above a repeated name. */
export const PARENT_FONT = `italic 600 10px ${SERIF}`;
/** The font for an area's name in capitals at `size` pixels, and its letter spacing, wide as on a survey map. */
export const nameFont = (size: number): string => `600 ${size}px ${SERIF}`;
export const nameSpacing = (size: number): number => +(size * 0.17).toFixed(1);
/**
 * The field map's compass rose: its center's offset from the sheet's lower right corner and the radius a tap on it
 * reaches, in pixels. Names keep clear of its corner on every sheet, including the loading screen's.
 */
export const ROSE = { right: 46, bottom: 62, reach: 30 } as const;

/** Area name size in pixels, at the scale the names were placed for. */
const NAME_SIZE = 13.5;
/** The scale of a name's smaller size, used when no spot fits it at full size. */
const SMALLER = 0.86;
/**
 * The smallest sheet side in pixels that names are placed for. A smaller sheet, such as a phone's, shows the same
 * places lettered smaller instead of crowding the names.
 */
const LEAST_SIDE = 640;
/** A name's margin in pixels from the sheet's edge (`EDGE`) and from a mark beside it (`GAP`). */
const EDGE = 4;
const GAP = 3;
/**
 * Two names whose centers lie within `across` pixels of one line read as one name unless `gap` pixels of paper
 * separate their capitals. `gap` is about twice the space between two words of a name.
 */
const ROW = { across: 18, gap: 26 } as const;
/** Offsets in pixels, each way along its area's slant, that a name tries from its own spot. */
const SLANT = [14, 28, 42, 56, 70];
/** Offsets in pixels a name tries after its own spot, its slant and the spots around marks. */
const NUDGES: readonly (readonly [number, number])[] = [[0, 26], [0, -26], [34, 10], [-34, 10], [0, 48], [0, -48], [56, 0], [-56, 0], [40, 36], [-40, 36], [40, -36], [-40, -36]];
/** In pixels, how far a name's center may sit from its own ground and still count as near it (`NEAR`), and the largest radius `afield` searches (`AFIELD`). */
const NEAR = 24;
const AFIELD = 260;
/** The farthest in meters a building or landmark may sit from its lot's center, the larger of the two reaches. */
const LOT_REACH = Math.max(...Object.values(LAYOUT.lotReach));

/** A box on a sheet, pixels: left, top, right, bottom. */
export type Box = readonly [number, number, number, number];

/**
 * Splits a name into pieces that may wrap onto another line, as the minimap and the title page letter a long name. It
 * breaks after each hyphen and underscore, and before each capital that follows a lowercase letter or digit.
 */
export function nameBreaks(name: string): string[] {
  return name.split(/(?<=[-_])|(?<=[a-z0-9])(?=[A-Z])/);
}

/** Returns the width in pixels of `text` set in `font` with `spacing` pixels between letters. */
export type Measure = (text: string, font: string, spacing: number) => number;

/** An area to letter. `name` is its folder's name. */
export interface NamedArea {
  readonly path: string;
  readonly depth: number;
  readonly name: string;
}

/** An area's name position before `placeNames` moves it out of the way. */
export interface AreaLabel<A = NamedArea> {
  readonly area: A;
  readonly index: number;
  /** The bounding box of its ground in meters. A tap on its name moves the map to it. */
  readonly bounds: readonly [number, number, number, number];
  /** The name's spot when nothing is in the way: the cell of the area's own ground farthest from its edges. */
  readonly x: number;
  readonly z: number;
  readonly cells: number;
  /** The area's long axis in radians from east toward south. Its name is lettered along it. */
  readonly angle: number;
  /** The parent folders lettered above its name when another area shares the name (`nameTails`), or empty. */
  readonly above: string;
}

/** The land both sheets letter, rasterized once from what the world service sends before Jev judges anything. */
export interface NameLand {
  /** In meters, the distance from the land's center to the sheet's edge (`reach`) and half the land's side (`half`). */
  readonly reach: number;
  readonly half: number;
  /** The land's width over its depth (`LandOutline`). */
  readonly aspect?: number;
  /** For each cell, the outline index of the area whose own ground holds it, or -1. The grid is `n` cells of `CELL` meters a side from (-reach, -reach). */
  readonly at: Int16Array;
  readonly n: number;
  /** The default name position of each area with ground of its own. */
  readonly labels: readonly AreaLabel[];
  readonly lots: readonly LotPlace[];
}

/** An area's name as `placeNames` placed it. */
export interface NamePlace {
  readonly label: AreaLabel;
  /** The lettering's center on the land in meters. A view letters it there at any zoom. */
  readonly x: number;
  readonly z: number;
  /** The capitals' size in pixels, at the scale the names were placed for. */
  readonly size: number;
  /** In pixels, how far the lettering extends either side of its center along its slant (`halfW`) and above its center (`top`). */
  readonly halfW: number;
  readonly top: number;
  /** Its box on the sheet in pixels from its center. */
  readonly box: Box;
  /** Whether it sits over a mark because no spot clear of the marks fit. */
  readonly over: boolean;
}

/** Every area's placed name and the scale they were placed for, in pixels per meter. A view at a smaller scale letters the names smaller. */
export interface NamePlaces {
  readonly scale: number;
  readonly places: readonly NamePlace[];
}

/**
 * Returns, for each path, the parent folders the map letters above its name.
 * A name no other path shares gets none. Otherwise it gets just enough of the
 * path above it that no other path ends the same way, such as "world" above a
 * `src` when another `src` exists. Folders are joined with " / ".
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

/** A `Measure` that uses a canvas, since the sheets letter names on canvases. */
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
 * Rasterizes the land for both sheets. Each cell gets the area whose outline
 * holds it, with subdirectories cut out, and each area with ground of its own
 * gets a default name position. `size` is the land's side and `reach` the
 * distance from its center to the sheet's edge, in meters. `lots` are where
 * its buildings and landmarks will stand.
 */
export function* nameLand(areas: readonly Outline[], size: number, reach: number, lots: readonly LotPlace[], aspect?: number): Generator<void, NameLand> {
  const n = Math.ceil((reach * 2) / CELL);
  const at = new Int16Array(n * n).fill(-1);
  const parentOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  for (const [i, o] of areas.entries()) {
    const holes = areas.flatMap((c) => (c.depth === o.depth + 1 && parentOf(c.path) === o.path ? c.rings : []));
    fillCells(at, n, reach, [...o.rings, ...holes], i);
    if (i % 4 === 3) yield;
  }
  // A cell whose area matches none of its four neighbors takes the most common neighbor's area, so no stray cell reads
  // as an area's own ground.
  for (let c = 0; c < n * n; c++) {
    const i = c % n;
    const around = [i > 0 ? at[c - 1] : undefined, i < n - 1 ? at[c + 1] : undefined, at[c - n], at[c + n]].filter((k): k is number => k !== undefined);
    if (around.includes(at[c] as number)) continue;
    at[c] = around.reduce((best, k) => (around.filter((q) => q === k).length > around.filter((q) => q === best).length ? k : best), around[0] ?? -1);
  }
  yield;
  const labels = labelsOf(at, n, CELL, reach, areas.map((o) => ({ path: o.path, depth: o.depth, name: o.path.slice(o.path.lastIndexOf("/") + 1) })));
  yield;
  return { reach, half: size / 2, ...(aspect === undefined ? {} : { aspect }), at, n, labels, lots };
}

/**
 * Sets to `id` each cell whose center lies inside `rings` by the even-odd rule, so a ring inside another cuts a hole.
 * It scans each row of the `n` by `n` grid of `CELL` meter cells from (-reach, -reach) and fills between pairs of edge
 * crossings.
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
      // The rows whose centers this edge crosses. The half-open range counts a row once where two edges meet.
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
 * Returns a patch's long axis in radians from east toward south, from the
 * moments of its cells' positions. It clamps the angle to 0.42 either way so a
 * name along it stays readable, and scales it toward 0 as the patch gets rounder.
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
 * Returns each area's default name position from a raster of the land. `at` gives, for each of the `n` by `n` cells
 * of `cell` meters from (-reach, -reach), the index in `areas` of the area whose own ground holds it, or -1. A name
 * sits on the cell of its area's ground farthest from the area's edges, nearest the area's centroid among equals, so
 * it never sits on the area's rim. It runs along the area's long axis.
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
  // Each cell's distance in cells from its area's edge, uncapped, by a two-pass chamfer. A name goes where its area is widest.
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

/** A name's lettering at one size, in pixels: its extent along its slant and above its center, and its box. */
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
  // The axis-aligned box around the lettering rotated to its area's slant.
  const cos = Math.abs(Math.cos(l.angle));
  const sin = Math.abs(Math.sin(l.angle));
  const hw = halfW * cos + ((top + 12) / 2) * sin;
  const hh = halfW * sin + ((top + 12) / 2) * cos;
  const lift = (top - 12) / 2;
  return { size, halfW, top, box: [-hw, -hh - lift, hw, hh - lift] };
}

const hits = (a: Box, b: Box): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** A name's capitals as a line on the sheet: center in pixels, angle in radians, and half the length in pixels with a little paper at each end. */
interface NameLine {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly halfW: number;
}

/** Whether two names lie end to end on one line, so close that they read as one name (`ROW`). */
function inRow(a: NameLine, b: NameLine): boolean {
  const along = (b.x - a.x) * Math.cos(a.angle) + (b.y - a.y) * Math.sin(a.angle);
  const across = (b.y - a.y) * Math.cos(a.angle) - (b.x - a.x) * Math.sin(a.angle);
  // Each name's half length includes 4 px of paper at its end (`shapeOf`), which is not space between the capitals.
  return Math.abs(across) < ROW.across && Math.abs(along) - (a.halfW - 4) - (b.halfW - 4) < ROW.gap;
}
const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** A candidate name position: its center in pixels, and whether it is beside the mark of a lot on the area's own ground. */
interface Spot {
  readonly x: number;
  readonly y: number;
  readonly beside: boolean;
}

/** A chosen name position: its shape, its center in pixels, and whether it sits over a mark. */
interface Chosen {
  readonly shape: Shape;
  readonly x: number;
  readonly y: number;
  readonly over: boolean;
}

const boxOf = (shape: Shape, x: number, y: number): Box => [x + shape.box[0], y + shape.box[1], x + shape.box[2], y + shape.box[3]];

/**
 * Places every area's name on a sheet `side` pixels square showing `land`, with lot marks drawn `grow` times their
 * size. Each name takes the first spot near its own that is on the sheet, clear of other names and the rose, and in no
 * row with another name (`ROW`). It prefers spots clear of every mark that could stand on a lot, and sits over a mark
 * only as a last resort. A sheet smaller than `LEAST_SIDE` uses the places for `LEAST_SIDE`, lettered smaller.
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
  // Each lot's mark box, grown by `LOT_REACH` to cover the mark wherever the building or landmark sits on its lot.
  const s = markScale(scale, grow);
  const lot = LOT_REACH * scale;
  const marks: Box[] = land.lots.map(({ x, z }) => [px(x) - MARK_REACH.left * s - lot, px(z) - MARK_REACH.up * s - lot, px(x) + MARK_REACH.right * s + lot, px(z) + MARK_REACH.down * s + lot]);
  const lotArea = land.lots.map(({ x, z }) => areaAt(px(x), px(z)));
  // The rose sits in the lower right corner of the land's sheet, which is as deep as the land. On land wider than
  // deep, that corner is above the square's bottom edge.
  const foot = px(Math.min(land.reach, land.half / (land.aspect ?? 1) + land.reach - land.half));
  const rose: Box = [sheet - ROSE.right - 34, foot - ROSE.bottom - 46, sheet, foot];
  const inside = (b: Box): boolean =>
    b[0] > EDGE && b[1] > EDGE && b[2] < sheet - EDGE && b[3] < sheet - EDGE && !hits(b, rose) && [b[0], b[2]].every((x) => [b[1], b[3]].every((y) => pastTheEdge({ size: land.half * 2, ...(land.aspect === undefined ? {} : { aspect: land.aspect }) }, meters(x), meters(y)) < 0));
  const named: Box[] = [];
  const lines: NameLine[] = [];
  const clear = (b: Box, line: NameLine): boolean => named.every((o) => !hits(b, o)) && lines.every((o) => !inRow(line, o) && !inRow(o, line));
  const covers = (b: Box): number => marks.reduce((sum, m) => sum + overlap(b, m), 0);
  const free = (b: Box): boolean => covers(b) === 0;

  // Places the smallest areas first. They have the least room, and a larger area has room to spare on its own
  // ground.
  const places: NamePlace[] = [];
  for (const l of [...land.labels].sort((a, b) => a.cells - b.cells)) {
    // The repository's root covers the whole sheet and gets no name.
    if (l.area.depth === 0) continue;
    const ax = px(l.x);
    const ay = px(l.z);
    // Every cell of the area's own ground in pixels, nearest its spot first. Computed only when a name needs it.
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
    /** Whether a name in `b` is on its own ground: its center is there, or it is beside the mark of a lot there. */
    const on = (b: Box, beside: boolean): boolean => beside || areaAt((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) === l.index;
    /** Whether a name in `b` is on its own ground or its center is within `NEAR` pixels of it. */
    const near = (b: Box, beside: boolean): boolean => on(b, beside) || ground().some(([gx, gy]) => Math.hypot(gx - (b[0] + b[2]) / 2, gy - (b[1] + b[3]) / 2) <= NEAR);

    // The spots a name tries at one size, in order: its own spot, along its slant, on every side of each nearby mark,
    // each of `NUDGES`, and the rest of its own ground.
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
    // Rings around its own spot out to `AFIELD`, nearest first, at both sizes. A name boxed in by other names looks here for room.
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
     * Returns the first spot whose box is on the sheet, clear of every name and the rose, in no row with another name,
     * and accepted by `ok`. With `least`, it returns the qualifying spot that covers the marks least.
     */
    const pick = (tries: Iterable<readonly [Shape, Spot]>, ok: (b: Box, beside: boolean) => boolean, least = false): Chosen | null => {
      let best: Chosen | null = null;
      let fewest = Infinity;
      for (const [shape, { x, y, beside }] of tries) {
        const b = boxOf(shape, x, y);
        if (!inside(b) || !clear(b, { x, y, angle: l.angle, halfW: shape.halfW }) || !ok(b, beside)) continue;
        const c = covers(b);
        if (!least) return { shape, x, y, over: c > 0 };
        if (c < fewest) [fewest, best] = [c, { shape, x, y, over: c > 0 }];
      }
      return best;
    };

    const full = shapeOf(measure, l, NAME_SIZE);
    const small = shapeOf(measure, l, NAME_SIZE * SMALLER);
    const { shape, x, y, over } =
      // Clear of every mark: on its own ground, then near it, at full size and then at the smaller size.
      pick(spots(full), (b, beside) => free(b) && on(b, beside)) ??
      pick(spots(full), (b, beside) => free(b) && near(b, beside)) ??
      pick(spots(small), (b, beside) => free(b) && on(b, beside)) ??
      pick(spots(small), (b, beside) => free(b) && near(b, beside)) ??
      // Over a mark, near its own ground, where it covers the marks least.
      pick([...spots(full), ...spots(small)], near, true) ??
      // When other names fill its ground, it takes the nearest room around it, clear of the marks if possible. A name
      // is never left out. On a sheet too full for it, it sits at its own spot.
      pick(afield(), free) ??
      pick(afield(), () => true) ?? { shape: full, x: ax, y: ay, over: !free(boxOf(full, ax, ay)) };
    named.push(boxOf(shape, x, y));
    lines.push({ x, y, angle: l.angle, halfW: shape.halfW });
    places.push({ label: l, x: meters(x), z: meters(y), size: shape.size, halfW: shape.halfW, top: shape.top, box: shape.box, over });
    yield;
  }
  return { scale, places };
}
