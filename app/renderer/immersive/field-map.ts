// The field map: a hand-drawn map of the world on a torn sheet of handmade
// paper, unfolded from a small map button, painted as `map-styles.ts`
// says. The land runs to the sheet's edges and the wild fills
// its corners. Each area (a directory) and each file's patch is drawn from
// the outline the layout traces (`outlinesOf`): the land is one watercolor
// wash in health's colors, spread from each file's own vitality, its pigment
// pooling toward each area's rim and bleeding into its neighbors (`wash.ts`,
// which the wait paints with too). Hills are shaded, water is washed,
// trails are dotted, trees brown with their files' vitality, buildings and
// landmarks are little drawn vignettes, and names are lettered on the land
// itself, never in a box. A small traveller stands where the person is.
//
// Tapping a spot or an area's name on the open map sends the person there:
// the map marks the spot with a vermilion cross and hands it on (`onPick`), and the
// immersive layer folds the map and dissolves the world in at the new place.
//
// The land (washes, hills, water, borders) is painted onto a paper canvas a
// few milliseconds at a time while the page is idle after each bake, so it
// never holds up a frame. Opening, panning and zooming redraw only the view of
// the paper and the marks and names over it, which stay one size at any zoom.
// Past the land's paint the wild is drawn in ink (`wild-ink.ts`) from tiles
// inked ahead of the person in the same idle time. Opened from the wild, the
// sheet grows to take the traveller in.

import { type Place, type PlaceArea, type Terrain, type WorldPlaces, outlinesOf, waterDepthAt } from "@gaia/terrain";
import { areaVitality, groundVitality } from "@gaia/world";
import { onTap } from "../lab.ts";
import type { StoodWorld } from "../terrain/lab.ts";
import { DECKLE_MASK, MAP_STYLE, type MapStyle, TRAVELLER_SVG, dryness, healthColor, healthField, landWash } from "./map-styles.ts";
import { chained, contour, isoline, simplified } from "./isolines.ts";
import { nameTails } from "./map-names.ts";
import { stampBuilding, stampLandmark } from "./marks.ts";
import { PAPER, type WashArea, type WashSheet, easeRing, fadeMask, floatWash, layWash, noiseCanvas, paintAt, rimPath, ringsPath, valueNoise } from "./wash.ts";
import { INK, type LandView, RIM, type WildInk, createWildInk, layGround, reliefAt } from "./wild-ink.ts";

export interface FieldMap {
  /** The world changed: the paper is painted again while the page is idle. */
  invalidate(): void;
  /** Unfolds or folds the map. */
  open(on: boolean): void;
  /**
   * Where the minimap lies (in the layer's pixels), asked each time the map unfolds: the sheet unfolds out of it
   * and folds back into it.
   */
  unfoldsFrom(minimap: () => MinimapAt | null): void;
  readonly isOpen: boolean;
  /** The painted paper, once it is painted: the minimap shows the same sheet. */
  paper(): Paper | null;
  /** Calls `listener` each time the paper has been painted afresh. */
  onPainted(listener: () => void): void;
  /** Follows the person; redraws only while the map is open. */
  frame(x: number, z: number, yaw: number, place: Place): void;
  /** Whether the immersive world shows: the map paints and opens only while it does. */
  show(on: boolean): void;
  /** What the map shows, for scripted checks: whether its paper is painted, zoom in pixels per meter and as a multiple of the whole sheet's, the paper's painting time and its longest step, names drawn, the sheet's extent and the wild's ink. */
  state(): {
    readonly open: boolean;
    readonly ready: boolean;
    readonly zoom: number;
    readonly near: number;
    readonly paintMs: number;
    readonly longestStepMs: number;
    readonly drawMs: number;
    readonly labels: number;
    /** The sheet's extent, meters, as it last unfolded. */
    readonly box: readonly number[];
    /** The wild's ink: tiles kept and inked, the longest step, and tiles inked at once because a view could not wait. */
    readonly ink: ReturnType<WildInk["stats"]> | null;
  };
}

/**
 * The minimap as the field map unfolds out of it: where it lies, its scale (pixels a meter), how far it turns the
 * land (radians clockwise, so the way the person faces is up) and where the person stands on it (fractions of its
 * width and height).
 */
export interface MinimapAt {
  readonly rect: DOMRect;
  readonly scale: number;
  readonly turn: number;
  readonly at: readonly [number, number];
}

export interface MapSource {
  stood(): StoodWorld;
  placeAt(x: number, z: number): Place;
  /** Every area and file patch, for drawing each file's ground. */
  places(): WorldPlaces;
}

/**
 * How far past the land's square the sheet runs, meters: none, so the painted country runs square to every edge of
 * the sheet (`PAPER` pixels a side), and the land's rounded rim is never drawn.
 */
export const MARGIN = 0;
/** Sample spacing of the areas, the hills and the water, meters. */
const AREA_CELL = 5;
const HILL_CELL = 5;
const WATER_CELL = 2.5;
/** Where an area's name may step to, in pixels, when its own spot is taken. */
const NUDGES: readonly (readonly [number, number])[] = [[0, 0], [0, 26], [0, -26], [34, 10], [-34, 10], [0, 48], [0, -48], [56, 0], [-56, 0], [40, 36], [-40, 36], [40, -36], [-40, -36]];
/** The paper is painted in steps of a millisecond or two, as many as fit in the page's idle time with this much to spare, ms. */
const SPARE_MS = 2;
const SERIF = `"Iowan Old Style", Georgia, "Times New Roman", serif`;
/** The folders lettered above a name that repeats. */
const PARENT_FONT = `italic 600 10px ${SERIF}`;

const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Red, green and blue between two hex colors. */
const mixRgb = (a: string, b: string, t: number): [number, number, number] => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number): number => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return [ch(16), ch(8), ch(0)];
};
const mixHex = (a: string, b: string, t: number): string => `rgb(${mixRgb(a, b, t).join(",")})`;

/** Where an area's name is lettered on the sheet. */
export interface AreaLabel<A = PlaceArea> {
  readonly area: A;
  readonly index: number;
  /** The box its ground spans, meters: a tap on its name brings the map round to it. */
  readonly bounds: readonly [number, number, number, number];
  /** Where its name is written: the area's widest ground. */
  readonly x: number;
  readonly z: number;
  readonly cells: number;
  /** The way the area runs, radians from east toward south: its name is lettered along it. */
  readonly angle: number;
  /** The folders lettered above its name, when another area shares the name (`nameTails`); otherwise empty. */
  readonly above: string;
}

export interface Paper {
  readonly canvas: HTMLCanvasElement;
  readonly reach: number;
  readonly style: MapStyle;
  /** Where to write each area's name: its heart, how much land it holds, and the way it runs. */
  readonly areaLabels: readonly AreaLabel[];
  /** Which area's own ground holds a point, by its index in `areaLabels`, or -1: where a nudged name may go. */
  readonly areaAt: (x: number, z: number) => number;
  /** Every directory's vitality, its subdirectories' included, by its path; "" is the whole world's. */
  readonly vitality: ReadonlyMap<string, number>;
  /**
   * The map's linework in meters, drawn at the view's size at every zoom so it never changes its drawing as the
   * map comes close: the contours from the real heights (every fifth heavier) and every area's border by depth.
   */
  readonly contours: readonly { readonly path: Path2D; readonly index: boolean }[];
  readonly borders: readonly { readonly path: Path2D; readonly depth: number }[];
  /** Each file's patch: its outline in meters, its heart, how far it reaches and its name, drawn once the map comes close. */
  readonly patches: readonly { readonly path: Path2D; readonly x: number; readonly z: number; readonly radius: number; readonly name: string; readonly area: string }[];
  /** The wild past the land, in ink, drawn wherever the paint is not. */
  readonly wild: WildInk;
}

/**
 * The way a patch of ground runs, from the sums of its cells' positions: its
 * long axis kept within a gentle slant so a name along it reads upright
 * (radians from east toward south, none for a round patch), and its length.
 */
function axisOf(s: { readonly x: number; readonly z: number; readonly xx: number; readonly zz: number; readonly xz: number; readonly cells: number }): { angle: number; length: number } {
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
  return { angle: Math.max(-0.42, Math.min(0.42, angle)) * elongated, length: Math.sqrt(long) * 3.4 };
}

/**
 * Each wet cell's distance from the nearest dry one, in cells: how deep into
 * a pond a point lies, for shading deep water.
 */
function wetDistance(wet: Uint8Array, n: number): Float32Array {
  const d = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) d[k] = wet[k] === 1 ? 1e6 : 0;
  const relax = (k: number, from: number, step: number): void => {
    const v = (d[from] as number) + step;
    if (v < (d[k] as number)) d[k] = v;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (wet[k] === 0) continue;
      if (i === 0 || j === 0) d[k] = 1;
      else {
        relax(k, k - 1, 1);
        relax(k, k - n, 1);
        relax(k, k - n - 1, 1.414);
        if (i < n - 1) relax(k, k - n + 1, 1.414);
      }
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      if (wet[k] === 0) continue;
      if (i === n - 1 || j === n - 1) d[k] = Math.min(d[k] as number, 1);
      else {
        relax(k, k + 1, 1);
        relax(k, k + n, 1);
        relax(k, k + n + 1, 1.414);
        if (i > 0) relax(k, k + n - 1, 1.414);
      }
    }
  }
  return d;
}

/**
 * The map's paper over `w` by `h` pixels: a ground mottled as handmade
 * paper is, with fibres and a faint grain. At the map's paper size it is the map's own paper; the wait
 * paints the same paper at the size of its sheet.
 */
export function paintPaperGround(ctx: CanvasRenderingContext2D, style: MapStyle, w: number, h: number): void {
  const k = w / PAPER;
  const many = (w * h) / PAPER ** 2;
  ctx.fillStyle = style.paper;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  for (const [cells, strength] of [[14, 0.09], [56, 0.05]] as const) {
    ctx.globalAlpha = strength;
    ctx.drawImage(noiseCanvas(cells, cells * 7.3, style.mottle), 0, 0, w, h);
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = "round";
  for (const [tone, count, seed] of [["rgba(118,92,56,0.075)", 1800, 11], ["rgba(255,251,238,0.16)", 1100, 23]] as const) {
    ctx.strokeStyle = tone;
    ctx.lineWidth = Math.max(0.7, 1.3 * k);
    ctx.beginPath();
    for (let n = 0; n < count * many; n++) {
      const x = hash(n, seed) * w;
      const y = hash(seed, n) * h;
      const a = hash(n + seed, 3) * Math.PI * 2;
      const len = (6 + hash(n, seed + 1) * 16) * k;
      const bend = (hash(n, seed + 2) - 0.5) * 8 * k;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
    }
    ctx.stroke();
  }
  for (const [tone, from] of [["rgba(120,96,60,0.06)", 0], ["rgba(255,250,235,0.1)", 1]] as const) {
    ctx.fillStyle = tone;
    ctx.beginPath();
    for (let n = from; n < 6000 * many; n += 2) ctx.rect(hash(n, 1) * w, hash(n, 2) * h, (1 + hash(n, 4) * 3) * k, (1 + hash(n, 5) * 3) * k);
    ctx.fill();
  }
}

/**
 * A ragged fringe of wood along the sheet's square edges, on a sheet `reach` meters from its middle to its edge
 * at `scale` pixels per meter: thickest at the edge, thinning into clearings inward and gone where the paint
 * gives way. It follows the paper's edge, never the land's rounded rim.
 */
export function woodsOf(style: MapStyle, reach: number, scale: number): { x: number; y: number; r: number; tone: number }[] {
  const px = (v: number): number => (v + reach) * scale;
  const BAND = 30;
  const wild = (x: number, z: number): boolean => reach - Math.max(Math.abs(x), Math.abs(z)) < BAND * (0.25 + 0.75 * valueNoise((x + reach) / 60, (z + reach) / 60, 17));
  const woodStep = style.woodSize * 2.1;
  const woods: { x: number; y: number; r: number; tone: number }[] = [];
  for (let z = -reach; z < reach; z += woodStep) {
    for (let x = -reach; x < reach; x += woodStep) {
      const jx = x + (hash(x, z) - 0.5) * woodStep;
      const jz = z + (hash(z, x) - 0.5) * woodStep;
      if (!wild(jx, jz)) continue;
      const u = (jx + reach) / (reach * 2);
      const v = (jz + reach) / (reach * 2);
      if (valueNoise(u * 14, v * 14, 5) < 0.32 || hash(jx * 1.3, jz) > paintAt(style, u, v)) continue;
      woods.push({ x: px(jx), y: px(jz), r: (style.woodSize + hash(jx, jz * 1.7) * style.woodSize * 0.6) * scale, tone: hash(jz, jx * 2.3) });
    }
  }
  return woods.sort((a, b) => a.y - b.y);
}

/** Draws a wood's trees: round crowns over soft shadows, lit on their northwest shoulders. */
export function drawWoods(ctx: CanvasRenderingContext2D, woods: readonly { x: number; y: number; r: number; tone: number }[]): void {
  ctx.fillStyle = "rgba(30,46,40,0.24)";
  for (const w of woods) {
    ctx.beginPath();
    ctx.ellipse(w.x + w.r * 0.45, w.y + w.r * 0.55, w.r * 1.05, w.r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const w of woods) {
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
    ctx.fillStyle = mixHex("#4f7f45", "#7aa95a", w.tone);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w.x - w.r * 0.32, w.y - w.r * 0.34, w.r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(214,232,150,0.4)";
    ctx.fill();
  }
}

/** Paints the land onto paper, yielding between steps so a driver can spread the work over idle time. */
function* paintPaper(stood: StoodWorld, placeAt: (x: number, z: number) => Place, places: WorldPlaces, style: MapStyle): Generator<void, Paper> {
  const t = stood.terrain;
  const size = t.spec.size;
  const half = size / 2;
  // The sheet ends just past the land's widest reach: the land runs to its edges and the wild fills its corners.
  const reach = half + MARGIN;
  const scale = PAPER / (reach * 2);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PAPER;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const px = (v: number): number => (v + reach) * scale;

  // The paper's own ground, anchored to the world: past the land every view lays the same paper, so it runs on.
  layGround(ctx, style, px(0), px(0), scale, PAPER, PAPER);
  yield;

  // Areas: one sample per cell.
  const n = Math.ceil((reach * 2) / AREA_CELL);
  const at = new Int16Array(n * n).fill(-1);
  const areas: PlaceArea[] = [];
  const index = new Map<string, number>();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const area = placeAt(-reach + (i + 0.5) * AREA_CELL, -reach + (j + 0.5) * AREA_CELL).area;
      if (area.depth < 0) continue;
      let k = index.get(area.path);
      if (k === undefined) {
        k = areas.length;
        index.set(area.path, k);
        areas.push(area);
      }
      at[j * n + i] = k;
    }
    if (j % 8 === 7) yield;
  }

  // Where the paint gives way to bare paper at the sheet's edge, as a small mask drawn large.
  const fade = yield* fadeMask(style);

  // Washes: color on the map is health. Every area starts from the same healthy land, a little lighter or darker by
  // its path, and each file's health spreads over the ground around it (`healthField`), across area borders too, so
  // the land is one gradient from green through gold and russet to ash. Areas are drawn from the outlines the layout
  // traces (`outlinesOf`); their pigment pools at their rims.
  const traced = outlinesOf(places);
  yield;
  // The outlines follow the lattice they were traced on in steps of a few meters; a pen draws easier lines.
  const outlines = { areas: traced.areas.map((o) => ({ ...o, rings: o.rings.map(easeRing) })) };
  yield;
  // Each area's health: every file under it pooled by the ground its patch holds (which the layout gives in
  // proportion to its code); an area's own wash wilts with the files on its own ground, or with all of its
  // subdirectories' where it holds none of its own.
  const parts = places.patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius }));
  const vitality = areaVitality(parts);
  const grounds = groundVitality(parts);
  const ownVitality = (path: string): number => grounds.get(path) ?? 1;
  const healthAt = healthField(
    places.patches.map((q) => ({ x: q.x, z: q.z, reach: q.radius, size: q.radius * q.radius, vitality: q.vitality })),
    style.spread,
  );
  // Every cell of the sheet in its health over its nearest area's land, laid soft: past the land's rounded rim the
  // painted country goes on to the paper's edge as the land beside it.
  const nearest = nearestAreas(at, n);
  yield;
  const under = document.createElement("canvas");
  under.width = under.height = n;
  const uctx = under.getContext("2d") as CanvasRenderingContext2D;
  const uimg = uctx.createImageData(n, n);
  const lands = areas.map((a) => landWash(style, a.path));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = j * n + i;
      const area = areas[nearest[c] as number];
      const v = healthAt(-reach + (i + 0.5) * AREA_CELL, -reach + (j + 0.5) * AREA_CELL, ownVitality(area?.path ?? ""));
      uimg.data.set([...healthColor(style, lands[nearest[c] as number] ?? mixRgb(style.wild, style.wild, 0), v), 255], c * 4);
    }
    if (j % 8 === 7) yield;
  }
  uctx.putImageData(uimg, 0, 0);
  // Each area's rim pools in its own ground's health; dry ground lets the paper through. An area too small for any
  // sample still pools.
  const outlineOf = new Map(outlines.areas.map((o) => [o.path, o]));
  const ground = (path: string): boolean => stood.grounds.has(path);
  const washAreaOf = (path: string, depth: number, rings: readonly (readonly number[])[]): WashArea => ({
    path: ringsPath(rings, px),
    depth,
    pool: healthColor(style, landWash(style, path), ownVitality(path)),
    dry: ground(path) ? dryness(ownVitality(path)) : 0,
  });
  const sheet: WashSheet = {
    reach,
    half,
    n,
    cell: AREA_CELL,
    nearest,
    fade,
    areas: [
      ...areas.map((a) => washAreaOf(a.path, a.depth, outlineOf.get(a.path)?.rings ?? [])),
      ...outlines.areas.filter((o) => !index.has(o.path)).map((o) => washAreaOf(o.path, o.depth, o.rings)),
    ],
  };
  yield;
  // The washes are laid on their own sheet, each wash opaque over the one it nests in, and the sheet is
  // floated onto the paper at once, so nested washes never muddy each other.
  const wash = document.createElement("canvas");
  wash.width = wash.height = PAPER;
  yield* layWash(wash.getContext("2d") as CanvasRenderingContext2D, under, sheet, style);
  yield;
  yield* floatWash(ctx, wash, 0, 0, style);
  yield;

  // The hills, contours and ponds.
  const contours = yield* paintRelief(ctx, t, style, reach, PAPER);

  // Each file's patch: its own traced shape, drawn in fine dotted ink once the map comes close.
  const patchOf = new Map(places.patches.map((p) => [p.path, p]));
  const patches: Paper["patches"][number][] = [];
  for (const [k, o] of traced.patches.entries()) {
    const p = patchOf.get(o.path);
    if (p !== undefined) patches.push({ path: meterPath(o.rings.map(easeRing)), x: p.x, z: p.z, radius: p.radius, name: p.name, area: p.area });
    if (k % 60 === 59) yield;
  }
  yield;

  const areaLabels = labelsOf(at, n, AREA_CELL, reach, areas);
  const areaAt = (x: number, z: number): number => {
    const i = Math.floor((x + reach) / AREA_CELL);
    const j = Math.floor((z + reach) / AREA_CELL);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : (at[j * n + i] as number);
  };
  const borders = outlines.areas.filter((o) => o.depth > 0).map((o) => ({ path: meterPath(o.rings), depth: o.depth }));
  // Past the paint, the wild is inked as views need it, where the paint gives way to bare paper.
  const wild = createWildInk(t, style, reach, fade);
  return { canvas, reach, style, areaLabels, areaAt, vitality, patches, contours, borders, wild };
}

/** For each cell, the area nearest it: its own (`at`, -1 where none), or past them the nearest cell's area. */
export function nearestAreas(at: Int16Array, n: number): Int16Array {
  const nearest = Int16Array.from(at);
  const queue: number[] = [];
  for (let c = 0; c < n * n; c++) if (nearest[c] !== -1) queue.push(c);
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q] as number;
    const i = c % n;
    for (const d of [i > 0 ? c - 1 : -1, i < n - 1 ? c + 1 : -1, c - n, c + n]) {
      if (d < 0 || d >= n * n || nearest[d] !== -1) continue;
      nearest[d] = nearest[c] as number;
      queue.push(d);
    }
  }
  return nearest;
}

/**
 * Where each area's name is lettered, from a raster of the land: `at` names the area whose own ground holds each of
 * its cells (`n` a side, `cell` meters, from the sheet's corner `reach` meters out) by its index in `areas`, or -1.
 * A name sits on the cell of its area's own ground farthest from its edges, nearest its middle among equals, so it
 * never sits on its rim or past the land's edge, and runs the way its area runs.
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
    return [{ area, index: k, bounds: [edge(s.i0), edge(s.j0), edge(s.i1 + 1), edge(s.j1 + 1)], x, z, cells: s.cells, angle: axisOf(s).angle, above: tails.get(area.path) ?? "" }];
  });
}

/**
 * The land's relief on `ctx`, a sheet `side` pixels a side reaching `reach` meters from the land's middle: the hills
 * shaded violet away from the light in the northwest and lit warm on the slopes facing it, and the ponds, darker
 * toward their middles, with their banks and a few ripples. Returns the contours from the real heights, in meters,
 * for a view to stroke at its own size.
 */
export function* paintRelief(ctx: CanvasRenderingContext2D, t: Terrain, style: MapStyle, reach: number, side: number): Generator<void, Paper["contours"]> {
  const half = t.spec.size / 2;
  const size = t.spec.size;
  const scale = side / (reach * 2);
  const k = side / PAPER;
  const px = (v: number): number => (v + reach) * scale;

  // Hills: shade away from the light in the northwest, and (when lit) a warm light on the slopes facing it.
  const hn = Math.ceil((reach * 2) / HILL_CELL);
  const e = HILL_CELL * 1.5;
  const heights = new Float32Array(hn * hn);
  const shadeImg = new ImageData(hn, hn);
  const lightImg = new ImageData(hn, hn);
  const [sr, sg, sb] = mixRgb(style.shadow, style.shadow, 0);
  const [lr, lg, lb] = mixRgb(style.light, style.light, 0);
  for (let j = 0; j < hn; j++) {
    for (let i = 0; i < hn; i++) {
      const x = -reach + (i + 0.5) * HILL_CELL;
      const z = -reach + (j + 0.5) * HILL_CELL;
      // The ground's height as the sheet paints it: eased at the rim to the height a little way in (`RIM`).
      const gx = (reliefAt(t, x + e, z) - reliefAt(t, x - e, z)) / (2 * e);
      const gz = (reliefAt(t, x, z + e) - reliefAt(t, x, z - e)) / (2 * e);
      const c = j * hn + i;
      heights[c] = reliefAt(t, x, z);
      const lit = (gx + gz) * style.relief;
      // Over the band where the ground is eased toward the rim, and past it, the eased heights would shade in stripes
      // along their rays, so the shading fades out across the band and is gone at the rim.
      const inside = Math.max(0, Math.min(1, (half - Math.pow(x ** 4 + z ** 4, 0.25)) / RIM.inner));
      const fadeHere = paintAt(style, (i + 0.5) / hn, (j + 0.5) / hn) * inside * inside * (3 - 2 * inside);
      shadeImg.data.set([sr, sg, sb, Math.round(255 * Math.max(0, Math.min(1, -lit)) * fadeHere)], c * 4);
      lightImg.data.set([lr, lg, lb, Math.round(255 * Math.max(0, Math.min(1, lit)) * fadeHere)], c * 4);
    }
    if (j % 14 === 13) yield;
  }
  const hill = document.createElement("canvas");
  hill.width = hill.height = hn;
  const hctx = hill.getContext("2d") as CanvasRenderingContext2D;
  // The shading is softened on a sheet a quarter of the paper's size, and laid on the paper from there: a blur
  // over the whole paper would hold up a frame.
  const SOFT = Math.round(side / 4);
  const soft = document.createElement("canvas");
  soft.width = soft.height = SOFT;
  const sctx = soft.getContext("2d") as CanvasRenderingContext2D;
  const lay = (img: ImageData, mode: GlobalCompositeOperation, alpha: number): void => {
    hctx.clearRect(0, 0, hn, hn);
    hctx.putImageData(img, 0, 0);
    sctx.clearRect(0, 0, SOFT, SOFT);
    sctx.filter = `blur(${((style.reliefBlur * k) / 4).toFixed(2)}px)`;
    sctx.drawImage(hill, 0, 0, SOFT, SOFT);
    sctx.filter = "none";
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = alpha;
    ctx.drawImage(soft, 0, 0, side, side);
  };
  lay(shadeImg, "multiply", style.shadowAlpha);
  yield;
  if (style.lightAlpha > 0) lay(lightImg, "screen", style.lightAlpha);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  yield;

  // Contours: lines from the real heights in meters, every few heavier, drawn at the view's size. They stop at the
  // land's rim: past it the ground is eased toward the rim's height, and its lines would only ring the land.
  const c = style.contour;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of heights) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  const hm = (gr: number): number => -reach + (gr + 0.5) * HILL_CELL;
  const contours: Paper["contours"][number][] = [];
  for (let step = Math.ceil(lo / c.interval); step * c.interval <= hi; step++) {
    const segments: number[] = [];
    isoline(heights, hn, step * c.interval, (x0, y0, x1, y1) => {
      const mx = hm((x0 + x1) / 2);
      const mz = hm((y0 + y1) / 2);
      if (mx ** 4 + mz ** 4 > (half - RIM.held) ** 4) return;
      segments.push(hm(x0), hm(y0), hm(x1), hm(y1));
    });
    // Joined into lines and eased of points that add nothing, so a view strokes a few long lines, not thousands of
    // cell-sized pieces.
    const contour = new Path2D();
    for (const line of chained(segments)) {
      const pts = simplified(line, 0.6);
      contour.moveTo(pts[0] as number, pts[1] as number);
      for (let q = 2; q < pts.length; q += 2) contour.lineTo(pts[q] as number, pts[q + 1] as number);
    }
    contours.push({ path: contour, index: step % c.index === 0 });
    yield;
  }
  yield;

  // Water: the ponds sampled on a fine grid. Streams are drawn as lines at the view's size (`drawLand`), so a river
  // looks the same on the whole sheet and close in; only the ponds lie on the paper.
  const wn = Math.ceil((size + 40) / WATER_CELL);
  const w0 = -(size + 40) / 2;
  const wet = new Uint8Array(wn * wn);
  for (let j = 0; j < wn; j++) {
    for (let i = 0; i < wn; i++) {
      const x = w0 + (i + 0.5) * WATER_CELL;
      const z = w0 + (j + 0.5) * WATER_CELL;
      const pond = t.ponds.some((q) => Math.hypot(q.x - x, q.z - z) < q.reach * 1.35);
      wet[j * wn + i] = pond && waterDepthAt(t, x, z) > 0.04 ? 1 : 0;
    }
    if (j % 20 === 19) yield;
  }
  const depth = wetDistance(wet, wn);
  yield;
  // Deep water is darker toward its middle.
  const shallowRgb = [150, 203, 204];
  const deepRgb = [58, 122, 152];
  const water = document.createElement("canvas");
  water.width = water.height = wn;
  const wctx = water.getContext("2d") as CanvasRenderingContext2D;
  const wimg = wctx.createImageData(wn, wn);
  for (let q = 0; q < wn * wn; q++) {
    if (wet[q] === 0) continue;
    const s = Math.min(1, ((depth[q] as number) - 1) / 6);
    wimg.data.set([0, 1, 2].map((ch) => Math.round((shallowRgb[ch] as number) * (1 - s) + (deepRgb[ch] as number) * s)), q * 4);
    wimg.data[q * 4 + 3] = 255;
  }
  wctx.putImageData(wimg, 0, 0);
  const wx0 = px(w0);
  const wspan = wn * WATER_CELL * scale;
  ctx.drawImage(water, wx0, wx0, wspan, wspan);
  ctx.globalAlpha = 1;
  yield;
  const wpx = (gr: number): number => px(w0 + (gr + 0.5) * WATER_CELL);
  const shore = (level: number): Path2D => {
    const p = new Path2D();
    contour(0, wn - 1, 0, wn - 1, (i, j) => (level <= 0 ? wet[j * wn + i] === 1 : (depth[j * wn + i] as number) > level), (x0, y0, x1, y1) => {
      p.moveTo(wpx(x0), wpx(y0));
      p.lineTo(wpx(x1), wpx(y1));
    });
    return p;
  };
  const coast = shore(0);
  yield;
  // Deep water: a shadow under its bank, and the light catching its rim.
  ctx.strokeStyle = "rgba(30,64,84,0.35)";
  ctx.lineWidth = 6 * k;
  ctx.save();
  ctx.translate(2 * k, 2.5 * k);
  ctx.stroke(coast);
  ctx.restore();
  ctx.strokeStyle = "rgba(250,244,222,0.5)";
  ctx.lineWidth = 1.8 * k;
  ctx.stroke(coast);
  // A few ripple strokes inside each pond.
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2 * k;
  for (const pond of t.ponds) {
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      ctx.arc(px(pond.x), px(pond.z), pond.reach * (0.3 + r * 0.18) * scale, Math.PI * (1.15 + r * 0.1), Math.PI * (1.45 + r * 0.1));
      ctx.stroke();
    }
  }
  yield;
  return contours;
}

/** A traced outline as a path in meters, to stroke at any zoom. */
function meterPath(rings: readonly (readonly number[])[]): Path2D {
  const p = new Path2D();
  for (const ring of rings) {
    for (let k = 0; k < ring.length; k += 2) {
      if (k === 0) p.moveTo(ring[0] as number, ring[1] as number);
      else p.lineTo(ring[k] as number, ring[k + 1] as number);
    }
    p.closePath();
  }
  return p;
}

/** How long a tap on the map waits for a second press (a double tap zooms instead), ms. */
const PICK_WAIT_MS = 240;
/** The compass rose's middle, from the sheet's lower right corner, and how far round it a tap finds you, pixels. */
const ROSE = { right: 46, bottom: 62, reach: 30 };
/** How close the map comes, as a multiple of the whole sheet's zoom, before each file's patch and name are drawn. */
export const CLOSE = 2.4;
/** The map opening out of the minimap and folding back into it, and gliding to an area whose name was tapped, ms. */
const UNFOLD_MS = 640;
const FOLD_MS = 360;
const GLIDE_MS = 700;
/**
 * Opened from the wild, the sheet grows to take the traveller in, this many meters past them, and never less than
 * this many pixels, so the traveller stands wholly on it however far out they are.
 */
const TAKE_IN = { meters: 60, px: 36 };
/** How far the person walks before the wild's ink ahead of them is asked for again, meters. */
const WARM_STEP = 20;

/** Runs `step` in the page's idle time, passing the milliseconds left there, until it returns true. */
function whenIdle(step: (budget: number) => boolean): () => void {
  let handle = 0;
  let stopped = false;
  const hasIdle = typeof window.requestIdleCallback === "function";
  const idle = (cb: (deadline?: IdleDeadline) => void): number => (hasIdle ? window.requestIdleCallback(cb, { timeout: 1000 }) : window.setTimeout(cb, 16));
  const run = (deadline?: IdleDeadline): void => {
    if (stopped) return;
    if (!step(deadline?.timeRemaining() ?? 4)) handle = idle(run);
  };
  handle = idle(run);
  return () => {
    stopped = true;
    if (hasIdle) window.cancelIdleCallback(handle);
    else window.clearTimeout(handle);
  };
}

/** Trees' crowns are laid in this many tones of health, so all of a tone fills at once; a healthy crown's green. */
const TREE_TONES = 8;
const TREE_GREEN: readonly [number, number, number] = [95, 148, 71];
/** The linework's widths in pixels at every zoom: a contour, an index contour, an area's border and its hedgerow. */
const LINE = { contour: 0.85, index: 1.4, border: 1, hedge: 3.2 };
/** How a mark grows with the land close in: its scale per pixel a meter, about a building's width over its drawing's. */
const MARK_METERS = 0.67;

/**
 * The land as the sheet shows it in a view `w` by `h` pixels: the painted
 * paper, and past its paint the wild in ink (`wild-ink.ts`); the contours,
 * area borders and rivers, drawn at the view's size so they look the same at
 * every zoom; the dotted ways; every tree as a round crown in its file's
 * health; and buildings and landmarks as marks worn by theirs. `grow` sizes
 * the trees and ways, which never shrink below legible; the marks grow with
 * the land as the map comes close. Both the field map and the minimap draw the
 * land this way, wherever they look, however far out in the wild. A tile of
 * the wild's ink not yet inked is inked at once when `now`, or else left out
 * until the page's idle time has inked it. Returns the boxes the marks take,
 * which names keep off.
 */
export function drawLand(ctx: CanvasRenderingContext2D, w: number, h: number, paper: Paper, stood: StoodWorld, view: LandView, grow: number, now = true): [number, number, number, number][] {
  const sx = (x: number): number => (x - view.x) * view.zoom + w / 2;
  const sy = (z: number): number => (z - view.z) * view.zoom + h / 2;
  const visible = (x: number, y: number, pad: number): boolean => x > -pad && x < w + pad && y > -pad && y < h + pad;
  const style = paper.style;
  // One paper under the whole view, the land's painted square laid on it, and the wild inked where the paint is not.
  paper.wild.ground(ctx, w, h, view);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const side = paper.reach * 2 * view.zoom;
  ctx.drawImage(paper.canvas, sx(-paper.reach), sy(-paper.reach), side, side);
  paper.wild.draw(ctx, w, h, view, now);

  // The linework, in meters under the view's transform, its widths in pixels: contours in sepia, every fifth
  // heavier, and each area's border as a soft hedgerow under a fine line, stopping short of the land's rim.
  ctx.save();
  ctx.translate(w / 2 - view.x * view.zoom, h / 2 - view.z * view.zoom);
  ctx.scale(view.zoom, view.zoom);
  ctx.lineCap = ctx.lineJoin = "round";
  strokeContours(ctx, paper.contours, view.zoom, style);
  ctx.save();
  ctx.clip(rimPath(paper.reach - MARGIN - 3));
  for (const b of paper.borders) {
    ctx.strokeStyle = "rgba(52,80,40,0.16)";
    ctx.lineWidth = (b.depth === 1 ? LINE.hedge * 1.35 : LINE.hedge) / view.zoom;
    ctx.stroke(b.path);
    ctx.strokeStyle = "rgba(46,66,34,0.44)";
    ctx.lineWidth = (b.depth === 1 ? LINE.border * 1.3 : LINE.border) / view.zoom;
    ctx.stroke(b.path);
  }
  ctx.restore();
  ctx.restore();

  drawRivers(ctx, stood.terrain.streams, sx, sy, view.zoom);
  drawTrails(ctx, stood.ways, sx, sy, view.zoom, grow, style);
  drawTrees(ctx, stood.trees, sx, sy, view.zoom, grow, style, visible);

  // Buildings and landmarks: each drawn from its own blueprint and worn as its entity is. Names keep off the box it takes.
  const s = markScale(view.zoom, grow);
  const taken: [number, number, number, number][] = [];
  for (const l of stood.landmarks) {
    const x = sx(l.x);
    const y = sy(l.z);
    if (!visible(x, y, 30 * s)) continue;
    taken.push(stampLandmark(ctx, x, y, s, l, l.vitality, l.name));
  }
  for (const b of stood.buildings) {
    const x = sx(b.x);
    const y = sy(b.z);
    if (!visible(x, y, 30 * s)) continue;
    taken.push(stampBuilding(ctx, x, y, s, b, b.vitality, b.name));
  }
  return taken;
}

/** The contours from the real heights in sepia ink, every fifth heavier, on `ctx` in meters at `zoom` pixels a meter, so they look the same at every zoom. */
export function strokeContours(ctx: CanvasRenderingContext2D, contours: Paper["contours"], zoom: number, style: MapStyle): void {
  const c = style.contour;
  ctx.save();
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = c.ink;
  for (const contour of contours) {
    ctx.globalAlpha = contour.index ? c.indexAlpha : c.alpha;
    ctx.lineWidth = (contour.index ? LINE.index : LINE.contour) / zoom;
    ctx.stroke(contour.path);
  }
  ctx.restore();
}

/**
 * Rivers: a bank, the water and a glint, along each stream's stations, its width the stream's own once the map is
 * close enough and never thinner than a line. `sx` and `sy` take meters to the view's pixels, `zoom` of them a meter.
 */
export function drawRivers(ctx: CanvasRenderingContext2D, streams: Terrain["streams"], sx: (x: number) => number, sy: (z: number) => number, zoom: number): void {
  ctx.lineCap = ctx.lineJoin = "round";
  for (const stream of streams) {
    const st = stream.stations;
    const first = st[0];
    const last = st[st.length - 1];
    if (first === undefined || last === undefined) continue;
    const line = new Path2D();
    line.moveTo(sx(first.x), sy(first.z));
    for (let k = 1; k < st.length - 1; k++) {
      const a = st[k] as (typeof st)[number];
      const b = st[k + 1] as (typeof st)[number];
      line.quadraticCurveTo(sx(a.x), sy(a.z), sx((a.x + b.x) / 2), sy((a.z + b.z) / 2));
    }
    line.lineTo(sx(last.x), sy(last.z));
    const width = 2 * Math.max(...st.map((q) => q.halfWidth)) * zoom;
    ctx.strokeStyle = "rgba(40,84,104,0.5)";
    ctx.lineWidth = Math.max(3.4, width + 2.6);
    ctx.stroke(line);
    ctx.strokeStyle = "rgb(150,203,204)";
    ctx.lineWidth = Math.max(1.9, width);
    ctx.stroke(line);
    ctx.strokeStyle = "rgba(250,244,222,0.45)";
    ctx.lineWidth = Math.max(0.5, width * 0.16);
    ctx.stroke(line);
  }
}

/** Trails, dotted the way a footpath is drawn, a little larger as `grow` says. */
export function drawTrails(ctx: CanvasRenderingContext2D, ways: StoodWorld["ways"], sx: (x: number) => number, sy: (z: number) => number, zoom: number, grow: number, style: MapStyle): void {
  ctx.save();
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.setLineDash([0.1, 5.5 * grow]);
  ctx.strokeStyle = style.trail;
  const stride = Math.max(2, Math.round(3 / zoom)) * 2;
  for (const trail of ways) {
    const p = trail.points;
    ctx.beginPath();
    for (let k = 0; k < p.length; k += stride) {
      const x = sx(p[k] as number);
      const y = sy(p[k + 1] as number);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = (1.9 + trail.style.width * 0.35) * grow;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Trees: round crowns with a soft shadow to the southeast and the sun on their northwest shoulders, colored by
 * their files' health as the land is; each layer is one path, so a thousand trees cost a few fills.
 */
export function drawTrees(ctx: CanvasRenderingContext2D, trees: StoodWorld["trees"], sx: (x: number) => number, sy: (z: number) => number, zoom: number, grow: number, style: MapStyle, visible: (x: number, y: number, pad: number) => boolean): void {
  const shadows = new Path2D();
  const lights = new Path2D();
  const crowns = Array.from({ length: TREE_TONES }, () => new Path2D());
  for (const tree of trees) {
    const x = sx(tree.x);
    const y = sy(tree.z);
    if (!visible(x, y, 8)) continue;
    const seed = hash(tree.x, tree.z);
    const r = Math.max((1.9 + seed * 0.8) * grow, (2 + seed * 1.2) * zoom);
    // Each mark its own closed shape: without the move, one path would join them all into a web.
    shadows.moveTo(x + r * 1.55, y + r * 0.6);
    shadows.ellipse(x + r * 0.5, y + r * 0.6, r * 1.05, r * 0.78, 0, 0, Math.PI * 2);
    const tone = crowns[Math.round(Math.max(0, Math.min(1, tree.vitality)) * (TREE_TONES - 1))] as Path2D;
    tone.moveTo(x + r, y);
    tone.arc(x, y, r, 0, Math.PI * 2);
    lights.moveTo(x - r * 0.3 + r * 0.52, y - r * 0.32);
    lights.arc(x - r * 0.3, y - r * 0.32, r * 0.52, 0, Math.PI * 2);
  }
  ctx.fillStyle = "rgba(34,44,48,0.22)";
  ctx.fill(shadows);
  crowns.forEach((path, k) => {
    ctx.fillStyle = `rgb(${healthColor(style, TREE_GREEN, k / (TREE_TONES - 1)).join(",")})`;
    ctx.fill(path);
  });
  ctx.fillStyle = "rgba(226,240,170,0.45)";
  ctx.fill(lights);
}

/** A mark's scale at `zoom` pixels a meter: a legible size on the whole sheet, growing with the land as the map comes close, as the trees do. */
export const markScale = (zoom: number, grow: number): number => Math.max(1.1 * grow, MARK_METERS * zoom);

/** The size areas' names are lettered at on a sheet `w` pixels wide. */
export const nameSizeFor = (w: number): number => (w < 520 ? 12.5 : 13.5);

/** The box an area's name takes on the sheet when lettered at (x, y) at `nameSize`: its slanted lettering and the folders above it. */
export function nameBox(ctx: CanvasRenderingContext2D, l: AreaLabel<{ readonly name: string }>, nameSize: number): (x: number, y: number) => [number, number, number, number] {
  ctx.font = `600 ${nameSize}px ${SERIF}`;
  ctx.letterSpacing = `${(nameSize * 0.17).toFixed(1)}px`;
  const nameW = ctx.measureText(l.area.name.toUpperCase()).width;
  ctx.letterSpacing = "0px";
  ctx.font = PARENT_FONT;
  const parentW = l.above === "" ? 0 : ctx.measureText(l.above).width;
  const halfW = Math.max(nameW, parentW) / 2 + 4;
  const top = l.above === "" ? 11 : 21;
  const cos = Math.abs(Math.cos(l.angle));
  const sin = Math.abs(Math.sin(l.angle));
  const hw = halfW * cos + ((top + 12) / 2) * sin;
  const hh = halfW * sin + ((top + 12) / 2) * cos;
  return (x, y) => [x - hw, y - hh - (top - 12) / 2, x + hw, y + hh - (top - 12) / 2];
}

/**
 * Letters an area's name at (x, y) in ink, in upright, widely spaced capitals as a survey map letters its regions,
 * along the way the area runs, with the folders that tell a repeated name apart above it in italic.
 */
export function letterName(ctx: CanvasRenderingContext2D, l: AreaLabel<{ readonly name: string }>, x: number, y: number, nameSize: number, style: MapStyle): void {
  const halo = `rgba(${mixRgb(style.paper, style.paper, 0).join(",")},0.82)`;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(x, y);
  ctx.rotate(l.angle);
  if (l.above !== "") {
    ctx.font = PARENT_FONT;
    letter(ctx, l.above, 0, -12, `rgba(${mixRgb(style.ink, style.ink, 0).join(",")},0.8)`, halo, 2.5);
  }
  ctx.font = `600 ${nameSize}px ${SERIF}`;
  ctx.letterSpacing = `${(nameSize * 0.17).toFixed(1)}px`;
  letter(ctx, l.area.name.toUpperCase(), 0, 2, style.ink, halo, 4.5);
  ctx.letterSpacing = "0px";
  ctx.restore();
}

/** Letters `text` in ink with the paper's tone just around it, so it reads over paint without a box: an outline of paper, then the ink. */
export function letter(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string, halo: string, haloWidth = 3): void {
  ctx.lineJoin = "round";
  ctx.lineWidth = haloWidth;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
}

/**
 * `onToggle` hears the map unfold and fold, however it was asked to. `onPick`
 * hears a tap on the open map: the spot in the world, and the heart of the
 * area there (where its name is written); it answers whether the person can
 * go there.
 */
export function createFieldMap(
  root: HTMLElement,
  source: MapSource,
  onToggle?: (open: boolean) => void,
  onPick?: (x: number, z: number, heart: { readonly x: number; readonly z: number } | undefined) => boolean,
): FieldMap {
  const sheet = document.createElement("div");
  sheet.className = "field-map";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Field map");
  sheet.style.setProperty("--deckle", DECKLE_MASK);
  sheet.innerHTML = /* html */ `
    <canvas class="field-map-view"></canvas>
    <div class="field-map-here">${TRAVELLER_SVG}<span class="here-file"></span></div>`;
  root.append(sheet);
  const canvas = sheet.querySelector("canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const here = sheet.querySelector(".field-map-here") as HTMLElement;
  const hereFile = sheet.querySelector(".here-file") as HTMLElement;
  const steps = sheet.querySelector(".traveller-steps") as SVGGElement;

  const style = MAP_STYLE;
  let paper: Paper | null = null;
  const painted: (() => void)[] = [];
  /** Whether the world changed since the paper was painted. */
  let stale = true;
  let painting: Generator<void, Paper> | null = null;
  let stopPainting: (() => void) | null = null;
  const timing = { paintMs: 0, longestStepMs: 0, drawMs: 0 };
  let isOpen = false;
  let shown = false;
  const view = { x: 0, z: 0, zoom: 1, fit: 1 };
  /** The sheet's extent, meters: the land's square, or grown from the wild to take the traveller in. */
  let box: [number, number, number, number] = [-604, -604, 604, 604];
  /** The land's reach the view was last fit to, or null when it was fit before the paper was painted. */
  let fittedTo: number | null = null;
  /** Where the person is, and whether out in the wild, which names no area. */
  const person = { x: 0, z: 0, yaw: 0, wild: false };
  /** Where the person was when the wild's ink was last asked for, whether out in the wild, and for which paper. */
  let warmed = { x: Number.NaN, z: Number.NaN, wild: false, paper: null as Paper | null };
  /** The minimap's scale, pixels a meter, as it last said. */
  let miniScale: number = INK.scale;
  let stopInking: (() => void) | null = null;
  /** A redraw waiting for the next frame, for ink that has come in. */
  let inkDraw = 0;
  let labelCount = 0;
  /** Each name drawn, its box on the sheet and where it leads: an area's heart, or a file's; and the area's box, to bring the map round to it. */
  let names: { box: [number, number, number, number]; x: number; z: number; bounds?: readonly [number, number, number, number] }[] = [];
  /** The spot a tap marked, waiting to be sent, and its timer. */
  let pick: { x: number; z: number; timer: number } | null = null;
  /** Whether the press under way is a double tap's second. */
  let doubled = false;
  /** A glide under way, to an area whose name was tapped. */
  let glide = 0;

  /** Takes one step of painting; true once the paper is done. */
  function paintStep(): boolean {
    if (painting === null) return true;
    const t0 = performance.now();
    const next = painting.next();
    const ms = performance.now() - t0;
    timing.paintMs += ms;
    timing.longestStepMs = Math.max(timing.longestStepMs, ms);
    if (next.done === true) {
      paper = next.value;
      painting = null;
      // Ink that comes in while the map is open is laid at the next frame, however many tiles land before it.
      paper.wild.onLanded(() => {
        if (isOpen && inkDraw === 0) {
          inkDraw = requestAnimationFrame(() => {
            inkDraw = 0;
            if (isOpen) draw();
          });
        }
      });
      // A map opened before its paper was painted was fit to a guess at the land's size: fit it to the land.
      if (isOpen && fittedTo !== paper.reach) fitView();
      if (isOpen) draw();
      for (const l of painted) l();
      warm();
      return true;
    }
    return false;
  }
  /** Paints the paper, then inks the wild around the person before it is shown, so the minimap never waits on it. */
  function* paperAndInk(): Generator<void, Paper> {
    const fresh = yield* paintPaper(source.stood(), source.placeAt, source.places(), style);
    fresh.wild.want([minimapView()]);
    while (fresh.wild.step()) yield;
    return fresh;
  }
  function startPainting(): void {
    stale = false;
    stopPainting?.();
    stopInking?.();
    stopInking = null;
    paper = null;
    painting = paperAndInk();
    timing.paintMs = 0;
    timing.longestStepMs = 0;
    // At least one step in each idle slot, and more while the slot has time to spare.
    stopPainting = whenIdle((budget) => {
      const t0 = performance.now();
      do if (paintStep()) return true;
      while (performance.now() - t0 < budget - SPARE_MS);
      return false;
    });
  }

  function size(): { w: number; h: number; dpr: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return { w, h, dpr };
  }

  /** Keeps the zoom in range and the sheet over the whole view: a sheet smaller than the view sits in its middle. */
  function clampView(): void {
    view.zoom = Math.max(view.fit * 0.9, Math.min(view.fit * 7, view.zoom));
    const [cx, cz] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const hx = Math.max(0, (box[2] - box[0]) / 2 - canvas.clientWidth / (2 * view.zoom));
    const hz = Math.max(0, (box[3] - box[1]) / 2 - canvas.clientHeight / (2 * view.zoom));
    view.x = Math.max(cx - hx, Math.min(cx + hx, view.x));
    view.z = Math.max(cz - hz, Math.min(cz + hz, view.z));
  }

  /**
   * The sheet's extent for a view `w` by `h` pixels, meters, and the zoom that fits it: the land's square on the
   * land; from the wild, grown to take the traveller in, `TAKE_IN` past them.
   */
  function sheetFor(w: number, h: number): { box: [number, number, number, number]; fit: number } {
    const r = paper?.reach ?? 604;
    const fitOf = (b: readonly number[]): number => Math.min(w / ((b[2] as number) - (b[0] as number)), h / ((b[3] as number) - (b[1] as number)));
    let grown: [number, number, number, number] = [-r, -r, r, r];
    if (!person.wild) return { box: grown, fit: fitOf(grown) };
    // The margin in meters keeps the traveller a few pixels in from the edge however small the land has become.
    let margin = TAKE_IN.meters;
    for (let k = 0; k < 3; k++) {
      grown = [Math.min(-r, person.x - margin), Math.min(-r, person.z - margin), Math.max(r, person.x + margin), Math.max(r, person.z + margin)];
      margin = Math.max(TAKE_IN.meters, TAKE_IN.px / fitOf(grown));
    }
    return { box: grown, fit: fitOf(grown) };
  }

  /** The land around the person at the minimap's scale, as far as it could show before the wild's ink is asked for again. */
  function minimapView(): { box: [number, number, number, number]; zoom: number } {
    miniScale = minimapAt()?.scale ?? miniScale;
    const a = INK.ahead;
    return { box: [person.x - a, person.z - a, person.x + a, person.z + a], zoom: miniScale };
  }

  /**
   * Asks for the wild's ink ahead of the person, to be inked in the page's idle time: around them at the minimap's
   * scale first, then the sheet the map would unfold to now. Walking on, it is asked again every few steps, so the
   * ink is there before either draws it.
   */
  function warm(): void {
    const p = paper;
    if (p === null) return;
    warmed = { x: person.x, z: person.z, wild: person.wild, paper: p };
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const views = [minimapView()];
    if (w > 0 && h > 0) {
      const sheet = sheetFor(w, h);
      const close = Math.min(w, h) < 560;
      const zoom = close ? sheet.fit * 2.2 : sheet.fit;
      const [cx, cz] = close ? [person.x, person.z] : [(sheet.box[0] + sheet.box[2]) / 2, (sheet.box[1] + sheet.box[3]) / 2];
      views.push({ box: [cx - w / 2 / zoom, cz - h / 2 / zoom, cx + w / 2 / zoom, cz + h / 2 / zoom], zoom });
    }
    p.wild.want(views);
    inkInIdle();
  }

  /** Inks the wild's waiting tiles in steps of a few milliseconds in the page's idle time, as the paper is painted. */
  function inkInIdle(): void {
    const p = paper;
    if (p === null || stopInking !== null || !p.wild.waiting) return;
    stopInking = whenIdle((budget) => {
      const t0 = performance.now();
      do {
        if (!p.wild.step()) {
          stopInking = null;
          return true;
        }
      } while (performance.now() - t0 < budget - SPARE_MS);
      return false;
    });
  }

  /**
   * You are here: a small traveller standing on the map, their footprints
   * behind them along the way they look, and the file underfoot lettered
   * beside them. It is its own element, moved by a transform, so walking with
   * the map open never redraws the sheet. Should they walk off the open sheet,
   * it waits at the edge nearest them.
   */
  function placeHere(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const fx = (person.x - view.x) * view.zoom + w / 2;
    const fy = (person.z - view.z) * view.zoom + h / 2;
    const x = Math.max(22, Math.min(w - 22, fx));
    const y = Math.max(44, Math.min(h - 30, fy));
    // Waiting at the sheet's edge, the traveller names no file: the file is not on this part of the map.
    hereFile.hidden = x !== fx || y !== fy;
    here.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    steps.setAttribute("transform", `rotate(${((-person.yaw * 180) / Math.PI).toFixed(1)})`);
  }

  function draw(): void {
    const t0 = performance.now();
    const { w, h, dpr } = size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = style.paper;
    ctx.fillRect(0, 0, w, h);
    // Until its paper is painted the sheet lies bare; it is never long, as the paper paints after every bake.
    if (paper === null) return;
    const stood = source.stood();
    const sx = (x: number): number => (x - view.x) * view.zoom + w / 2;
    const sy = (z: number): number => (z - view.z) * view.zoom + h / 2;
    const visible = (x: number, y: number, pad: number): boolean => x > -pad && x < w + pad && y > -pad && y < h + pad;
    // Marks and names grow a little as the map comes closer, and never shrink below legible.
    const near = view.zoom / Math.max(view.fit, 1e-6);
    const grow = Math.min(1.6, Math.max(1, Math.sqrt(near) * 0.85));
    const halo = `rgba(${mixRgb(style.paper, style.paper, 0).join(",")},0.82)`;

    // Close in, the map's next level down: each file's patch in fine dotted ink.
    const close = Math.max(0, Math.min(1, (near - CLOSE) / 0.8));
    const wx = (x: number): number => view.x + (x - w / 2) / view.zoom;
    const wz = (y: number): number => view.z + (y - h / 2) / view.zoom;
    // The wild's ink a view has not had inked yet comes in from the page's idle time, and the sheet is drawn again.
    const marks = drawLand(ctx, w, h, paper, stood, view, grow, false);
    inkInIdle();
    if (close > 0) {
      ctx.save();
      ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * (w / 2 - view.x * view.zoom), dpr * (h / 2 - view.z * view.zoom));
      // Each file's patch shows its bounds in fine dotted ink: the map's next level down.
      ctx.lineWidth = 1 / view.zoom;
      ctx.setLineDash([2.2 / view.zoom, 3.2 / view.zoom]);
      ctx.strokeStyle = `rgba(74,60,44,${(0.42 * close).toFixed(3)})`;
      for (const p of paper.patches) if (visible(sx(p.x), sy(p.z), p.radius * view.zoom * 2)) ctx.stroke(p.path);
      ctx.restore();
    }

    // Names keep off the drawn marks and each other, and off the compass rose in the lower right corner.
    const taken: [number, number, number, number][] = [[w - ROSE.right - 34, h - ROSE.bottom - 46, w, h], ...marks];
    // The traveller and the file lettered beside them.
    const hx = sx(person.x);
    const hy = sy(person.z);
    taken.push([hx - 12, hy - 30, hx + 18 + hereFile.offsetWidth, hy + 8]);
    const free = (x0: number, y0: number, x1: number, y1: number): boolean => taken.every(([a, b, c, d]) => x1 < a || x0 > c || y1 < b || y0 > d);

    // Names are lettered on the land itself in ink, in upright, widely spaced capitals as a survey map letters its
    // regions, along the way each area runs, the paper just around the letters keeping them clear of the paint. A
    // name that repeats carries just enough of its path above it, in italic, to tell it apart (`nameTails`). Names
    // stay one size at any zoom, and where two would collide the larger area's wins.
    labelCount = 0;
    names = [];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const nameSize = nameSizeFor(w);
    const { areaAt } = paper;
    const half = paper.reach - MARGIN;
    const edge = half ** 4;
    for (const l of [...paper.areaLabels].sort((a, b) => b.cells - a.cells)) {
      // The repository's root is the whole sheet, and it is not lettered.
      if (l.area.depth === 0 || !visible(sx(l.x), sy(l.z), 0)) continue;
      const boxAt = nameBox(ctx, l, nameSize);
      // A name sits wholly on the sheet and on the land or not at all, its middle on its own area's ground.
      const onLand = ([x0, y0, x1, y1]: [number, number, number, number]): boolean =>
        areaAt(wx((x0 + x1) / 2), wz((y0 + y1) / 2)) === l.index && [x0, x1].every((x) => [y0, y1].every((y) => wx(x) ** 4 + wz(y) ** 4 < edge));
      const fits = (box: [number, number, number, number]): boolean => box[0] > 4 && box[1] > 4 && box[2] < w - 4 && box[3] < h - 4 && free(...box) && onLand(box);
      const spot = NUDGES.map(([dx, dy]) => [sx(l.x) + dx, sy(l.z) + dy] as const).find(([cx, cy]) => fits(boxAt(cx, cy)));
      if (spot === undefined) continue;
      const [x, y] = spot;
      taken.push(boxAt(x, y));
      names.push({ box: boxAt(x, y), x: l.x, z: l.z, bounds: l.bounds });
      labelCount++;
      letterName(ctx, l, x, y, nameSize, style);
    }

    // Close in, each file's name is lettered small on its patch, and a tap on it goes there.
    if (close > 0) {
      ctx.font = `italic 12px ${SERIF}`;
      ctx.globalAlpha = close;
      for (const p of [...paper.patches].sort((a, b) => b.radius - a.radius)) {
        if (p.radius * view.zoom < 15) continue;
        const x = sx(p.x);
        const y = sy(p.z);
        const halfW = ctx.measureText(p.name).width / 2 + 2;
        const box: [number, number, number, number] = [x - halfW, y - 7, x + halfW, y + 7];
        if (!visible(x, y, -10) || !free(...box)) continue;
        taken.push(box);
        names.push({ box, x: p.x, z: p.z });
        letter(ctx, p.name, x, y, "rgba(58,47,34,0.92)", halo, 2.5);
      }
      ctx.globalAlpha = 1;
    }
    // Buildings and landmarks name themselves once the map is close enough to read them.
    if (near > 1.6) {
      ctx.font = `italic 12.5px ${SERIF}`;
      const named = [...stood.landmarks.map((l) => ({ ...l, below: 15 })), ...stood.buildings.map((b) => ({ ...b, below: 13 }))];
      for (const m of named) {
        const x = sx(m.x);
        const y = sy(m.z) + m.below * grow + 6;
        const halfW = ctx.measureText(m.name).width / 2 + 3;
        const box: [number, number, number, number] = [x - halfW, y - 8, x + halfW, y + 8];
        if (!visible(x, y, 0) || !taken.slice(marks.length + 4).every(([a, b, c, d]) => box[2] < a || box[0] > c || box[3] < b || box[1] > d)) continue;
        taken.push(box);
        letter(ctx, m.name, x, y, style.ink, halo, 3);
      }
    }

    placeHere();
    // The spot a tap picked: a cross in vermilion ink, as a traveller marks a map.
    if (pick !== null) {
      const x = sx(pick.x);
      const y = sy(pick.z);
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 6);
      ctx.lineTo(x + 6, y + 6);
      ctx.moveTo(x + 6, y - 6);
      ctx.lineTo(x - 6, y + 6);
      ctx.strokeStyle = "#b8452c";
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // A compass rose, inked in the lower right corner: a ring, four long points half-shaded from the light, four
    // short ones between, and north named above. A tap on the rose finds you on the map.
    ctx.save();
    ctx.translate(w - ROSE.right, h - ROSE.bottom);
    ctx.strokeStyle = style.ink;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, 12.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
    ctx.lineWidth = 0.5;
    ctx.stroke();
    for (let k = 0; k < 8; k++) {
      const long = k % 2 === 0;
      const r = long ? 21 : 11;
      const halfW = long ? 3.4 : 2.4;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(side * halfW, -halfW);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fillStyle = side < 0 ? style.ink : style.paper;
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.rotate(Math.PI / 4);
    }
    ctx.restore();
    ctx.font = `italic 600 12px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.fillStyle = style.ink;
    ctx.fillText("N", w - ROSE.right, h - ROSE.bottom - 27);
    timing.drawMs = performance.now() - t0;
  }

  function fitView(): void {
    const { w, h } = size();
    fittedTo = paper?.reach ?? null;
    const sheet = sheetFor(w, h);
    box = sheet.box;
    view.fit = sheet.fit;
    // A phone opens close enough to read the names around the person; a wide screen shows it all.
    const close = Math.min(w, h) < 560;
    view.zoom = close ? view.fit * 2.2 : view.fit;
    view.x = close ? person.x : (box[0] + box[2]) / 2;
    view.z = close ? person.z : (box[1] + box[3]) / 2;
    clampView();
  }

  function cancelPick(): void {
    if (pick === null) return;
    window.clearTimeout(pick.timer);
    pick = null;
  }

  /**
   * The transforms that lay the sheet over the minimap with its land as the minimap shows it: at its scale, turned
   * as it turns, around the person where they stand on it. The sheet unfolds from there and folds back into it.
   */
  function overMinimap(minimap: MinimapAt): { sheet: string; land: string; origin: string } {
    const from = minimap.rect;
    const left = sheet.offsetLeft;
    const top = sheet.offsetTop;
    const k = from.width / Math.max(1, sheet.offsetWidth);
    const tx = from.left + from.width / 2 - (left + sheet.offsetWidth / 2);
    const ty = from.top + from.height / 2 - (top + sheet.offsetHeight / 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const px = (person.x - view.x) * view.zoom + w / 2;
    const py = (person.z - view.z) * view.zoom + h / 2;
    const zoom = minimap.scale / Math.max(1e-6, k * view.zoom);
    // Turned the short way round, so the land swings to north up through less than half a turn.
    const turn = ((((minimap.turn * 180) / Math.PI) % 360) + 540) % 360 - 180;
    const [ax, ay] = minimap.at;
    return {
      sheet: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k.toFixed(4)})`,
      land: `translate(${(w * ax - px).toFixed(1)}px, ${(h * ay - py).toFixed(1)}px) scale(${zoom.toFixed(3)}) rotate(${turn.toFixed(2)}deg)`,
      origin: `${px.toFixed(1)}px ${py.toFixed(1)}px`,
    };
  }
  /** Where the minimap lies, asked as the map unfolds; the layer's own pixels. */
  let minimapAt: () => MinimapAt | null = () => null;
  let minimap: MinimapAt | null = null;
  let folding = 0;

  function setOpen(on: boolean): void {
    if (on === isOpen) return;
    isOpen = on;
    cancelPick();
    window.clearTimeout(folding);
    onToggle?.(on);
    const animated: HTMLElement[] = [sheet, canvas];
    if (on) {
      minimap = minimapAt();
      fitView();
      draw();
      // The sheet unfolds out of the minimap: laid over it at its scale, it grows to its place while the land
      // draws back to show the whole, by transforms alone, so nothing redraws while it moves.
      const from = minimap;
      for (const e of animated) e.style.transition = "none";
      if (from !== null) {
        const t = overMinimap(from);
        sheet.style.transform = t.sheet;
        canvas.style.transformOrigin = t.origin;
        canvas.style.transform = t.land;
      }
      void sheet.offsetWidth;
      for (const e of animated) e.style.transition = "";
      sheet.style.setProperty("--unfold", `${UNFOLD_MS}ms`);
      sheet.classList.add("open");
      sheet.style.transform = "";
      canvas.style.transform = "";
    } else {
      // It folds back into the minimap as it came, if it came from there.
      sheet.style.setProperty("--unfold", `${FOLD_MS}ms`);
      if (minimap !== null) {
        const t = overMinimap(minimap);
        canvas.style.transformOrigin = t.origin;
        sheet.style.transform = t.sheet;
        canvas.style.transform = t.land;
      }
      sheet.classList.remove("open");
      folding = window.setTimeout(() => {
        for (const e of animated) e.style.transition = "none";
        sheet.style.transform = "";
        canvas.style.transform = "";
        void sheet.offsetWidth;
        for (const e of animated) e.style.transition = "";
      }, FOLD_MS + 40);
    }
  }
  // The sheet's turned-down corner folds it.
  /** Brings the map round to where the person stands, close enough to read. */
  function findHere(): void {
    view.x = person.x;
    view.z = person.z;
    view.zoom = Math.max(view.zoom, view.fit * 2.2);
    clampView();
    draw();
  }
  /** Glides the map round to frame an area, close enough that its files show. */
  function glideTo(bounds: readonly [number, number, number, number]): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const from = { ...view };
    const span = Math.max(bounds[2] - bounds[0], (bounds[3] - bounds[1]) * (w / h));
    const to = { x: (bounds[0] + bounds[2]) / 2, z: (bounds[1] + bounds[3]) / 2, zoom: Math.max(view.fit * (CLOSE + 0.9), Math.min(view.fit * 7, (w * 0.8) / Math.max(1, span))) };
    const t0 = performance.now();
    cancelAnimationFrame(glide);
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / GLIDE_MS);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      // Zoom eases in log space, so the land comes on at an even pace.
      view.zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
      view.x = from.x + (to.x - from.x) * e;
      view.z = from.z + (to.z - from.z) * e;
      clampView();
      draw();
      if (t < 1 && isOpen) glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  }
  window.addEventListener("keydown", (e) => {
    if (!shown || e.target instanceof HTMLInputElement) return;
    if (e.code === "KeyM") setOpen(!isOpen);
    else if (e.code === "Escape" && isOpen) setOpen(false);
  });
  new ResizeObserver(() => {
    if (isOpen) draw();
  }).observe(canvas);

  // Drag to pan; pinch or scroll to zoom about the fingers or the pointer.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  canvas.addEventListener("pointerdown", (e) => {
    cancelAnimationFrame(glide);
    // A second press while a tap waits is a double tap, which zooms: neither tap goes anywhere.
    doubled = pick !== null;
    if (doubled) {
      cancelPick();
      draw();
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  const zoomAbout = (factor: number, cx: number, cy: number): void => {
    const rect = canvas.getBoundingClientRect();
    const ox = cx - rect.left - rect.width / 2;
    const oy = cy - rect.top - rect.height / 2;
    const wx = view.x + ox / view.zoom;
    const wz = view.z + oy / view.zoom;
    view.zoom *= factor;
    clampView();
    view.x = wx - ox / view.zoom;
    view.z = wz - oy / view.zoom;
    clampView();
  };
  canvas.addEventListener("pointermove", (e) => {
    const was = pointers.get(e.pointerId);
    if (was === undefined) return;
    if (pointers.size === 1) {
      view.x -= (e.clientX - was.x) / view.zoom;
      view.z -= (e.clientY - was.y) / view.zoom;
      clampView();
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) zoomAbout(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = d;
    }
    draw();
  });
  const lift = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      cancelAnimationFrame(glide);
      zoomAbout(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      draw();
    },
    { passive: false },
  );
  // A tap on the compass rose finds you. On an area's name, from afar, the map comes round to the area and its
  // files show; once there, a name or a spot sends the person to it.
  onTap(canvas, (e) => {
    if (paper === null || doubled) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (Math.hypot(px - (rect.width - ROSE.right), py - (rect.height - ROSE.bottom)) < ROSE.reach) {
      findHere();
      return;
    }
    const name = names.find(({ box: [x0, y0, x1, y1] }) => px >= x0 && px <= x1 && py >= y0 && py <= y1);
    if (name?.bounds !== undefined && view.zoom / view.fit < CLOSE) {
      cancelPick();
      glideTo(name.bounds);
      return;
    }
    if (onPick === undefined) return;
    const x = name?.x ?? view.x + (px - rect.width / 2) / view.zoom;
    const z = name?.z ?? view.z + (py - rect.height / 2) / view.zoom;
    const label = paper.areaLabels[paper.areaAt(x, z)];
    const heart = label === undefined ? undefined : { x: label.x, z: label.z };
    cancelPick();
    pick = {
      x,
      z,
      timer: window.setTimeout(() => {
        if (pick === null) return;
        const sent = onPick(pick.x, pick.z, heart);
        if (!sent) pick = null;
        draw();
      }, PICK_WAIT_MS),
    };
    draw();
  });
  canvas.addEventListener("dblclick", (e) => {
    zoomAbout(1.8, e.clientX, e.clientY);
    draw();
  });

  let lastPlace = "";
  return {
    invalidate() {
      // Only the chosen way paints; another waits until it is chosen.
      if (shown) startPainting();
      else stale = true;
    },
    open: setOpen,
    unfoldsFrom(at) {
      minimapAt = at;
    },
    get isOpen() {
      return isOpen;
    },
    paper: () => paper,
    onPainted: (listener) => painted.push(listener),
    frame(x, z, yaw, place) {
      const moved = Math.hypot(x - person.x, z - person.z) > 0.5 || Math.abs(yaw - person.yaw) > 0.03;
      person.x = x;
      person.z = z;
      person.yaw = yaw;
      person.wild = place.area.depth < 0;
      if (paper !== null && (paper !== warmed.paper || person.wild !== warmed.wild || !(Math.hypot(x - warmed.x, z - warmed.z) < WARM_STEP))) warm();
      const key = `${place.area.depth}|${place.area.path}|${place.file?.path ?? ""}`;
      if (key !== lastPlace) {
        lastPlace = key;
        hereFile.textContent = place.file?.name ?? "";
      }
      // Walking with the map open moves the traveller a fraction of a pixel a frame: a few moves a second keep up.
      if (isOpen && moved) placeHere();
    },
    show(on) {
      shown = on;
      if (on && stale) startPainting();
      if (!on) setOpen(false);
    },
    state: () => ({
      open: isOpen,
      ready: paper !== null,
      zoom: view.zoom,
      near: view.zoom / Math.max(1e-6, view.fit),
      paintMs: Math.round(timing.paintMs),
      longestStepMs: +timing.longestStepMs.toFixed(1),
      drawMs: +timing.drawMs.toFixed(1),
      labels: labelCount,
      box: [...box],
      ink: paper?.wild.stats() ?? null,
    }),
  };
}
