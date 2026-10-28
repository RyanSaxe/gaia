// The field map: a painted map of the world on a torn paper sheet that opens
// from the minimap (`map-styles.ts`). The land is one watercolor wash colored
// by each file's vitality (`wash.ts`), with hill shading, water, dotted
// trails, plant and building marks, and area names lettered on the land.
//
// The land is painted onto a paper canvas a few milliseconds at a time while
// the page is idle after each bake, so it never delays a frame. Opening,
// panning and zooming redraw only the view of that paper and the marks and
// names over it, which keep one size at any zoom.

import { shownVitality } from "@gaia/realize";
import { outlinesOf, pastTheEdge, type Place, type PlaceArea, type Terrain, waterDepthAt, type WorldPlaces } from "@gaia/terrain";
import { areaVitality, groundVitality } from "@gaia/world";
import { onTap } from "../tap.ts";
import type { StoodPlant, StoodWorld } from "../terrain/world.ts";
import { DECKLE_MASK, MAP_STYLE, type MapStyle, TRAVELLER_SVG, dryness, healthColor, healthField, landWash } from "./map-styles.ts";
import { contour, contourLines, simplified, slopes } from "./isolines.ts";
import { type AreaLabel, type Box, CELL, type NameLand, type NamePlace, type NamePlaces, PARENT_FONT, ROSE, SERIF, canvasMeasure, nameFont, nameLand, nameSpacing, placeNames } from "./map-names.ts";
import { markScale, stampBuilding, stampLandmark } from "./marks.ts";
import { stampPlant } from "./plant-marks.ts";
import { PAPER, type WashArea, type WashSheet, borderPath, easeRing, fadeMask, floatWash, layWash, paintAt, rimPath, ringsPath } from "./wash.ts";
import { INK, type LandView, RIM, type WildInk, createWildInk, layGround, reliefAt } from "./wild-ink.ts";

export interface FieldMap {
  /** Marks the paper stale after a world change. It repaints in idle time, or with `soon` for a minimum time every frame while the person waits for the world. */
  invalidate(soon?: boolean): void;
  /** Opens or closes the map. */
  open(on: boolean): void;
  /**
   * Sets the callback that returns the minimap's position in the layer's pixels each time the map opens. The sheet
   * opens from it and closes back into it.
   */
  unfoldsFrom(minimap: () => MinimapAt | null): void;
  readonly isOpen: boolean;
  /** The painted paper, or null before it is painted. The minimap shows the same sheet. */
  paper(): Paper | null;
  /** Calls `listener` each time the paper is repainted. */
  onPainted(listener: () => void): void;
  /** Updates the person's position and heading. Redraws only while the map is open. */
  frame(x: number, z: number, yaw: number, place: Place): void;
  /** Sets whether the immersive world shows. The map paints and opens only while it does. */
  show(on: boolean): void;
  /** What the map shows, for scripted checks: whether the paper is painted, the zoom in pixels per meter and as a multiple of the whole sheet's (`near`), the paint time and longest step, the draw time, the names drawn, the sheet's extent and the wild's ink. */
  state(): {
    readonly open: boolean;
    readonly ready: boolean;
    readonly zoom: number;
    readonly x: number;
    readonly z: number;
    readonly near: number;
    readonly paintMs: number;
    readonly longestStepMs: number;
    readonly drawMs: number;
    readonly labels: number;
    /** The sheet's extent in meters when it last opened. */
    readonly box: readonly number[];
    /** The wild ink's stats (`WildInk.stats`). */
    readonly ink: ReturnType<WildInk["stats"]> | null;
  };
}

/**
 * The minimap the field map opens from: its rect, its scale in pixels per meter, its rotation of the land in radians
 * clockwise so the person's heading is up, and the person's position on it as fractions of its width and height.
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
 * How far in meters the sheet runs past the land's square. It is 0, so the paint runs to every edge of the sheet
 * (`PAPER` pixels a side) and the land's rounded rim is never drawn.
 */
export const MARGIN = 0;
/** Sample spacing in meters of the areas, hills and water. */
const AREA_CELL = 5;
const HILL_CELL = 5;
const WATER_CELL = 2.5;
/** The paper paints in steps of a millisecond or two, as many as fit in the page's idle time while leaving this many ms spare. */
const SPARE_MS = 2;
/** While the person waits for the world, the paper paints for at least this many ms every frame. */
const SOON_MS = 8;
/** How many ms the relief painting runs before it yields, kept short so the loading screen's lines never stall. */
const RELIEF_STEP_MS = 4;

/** Mixes two hex colors by `t` and returns the RGB. */
const mixRgb = (a: string, b: string, t: number): [number, number, number] => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number): number => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return [ch(16), ch(8), ch(0)];
};

export interface Paper {
  readonly canvas: HTMLCanvasElement;
  readonly reach: number;
  readonly style: MapStyle;
  /** The rasterized land for lettering (`nameLand`): each area's default name position and the lots names keep off. */
  readonly names: NameLand;
  /** The label of the area whose own ground holds a point in the name raster, or undefined past the land. */
  readonly labelAt: (x: number, z: number) => AreaLabel | undefined;
  /** Every directory's vitality by path, including its subdirectories. "" is the whole world's. */
  readonly vitality: ReadonlyMap<string, number>;
  /**
   * The map's linework in meters: contours from the real heights, with every fifth heavier, and every area's border
   * by depth. A view strokes them at its own scale, so the lines do not change as the map zooms in.
   */
  readonly contours: readonly { readonly path: Path2D; readonly index: boolean }[];
  readonly borders: readonly { readonly path: Path2D; readonly depth: number }[];
  /** Each file's patch: its outline in meters, center, radius and name, drawn once the map zooms in close. */
  readonly patches: readonly { readonly path: Path2D; readonly x: number; readonly z: number; readonly radius: number; readonly name: string; readonly area: string }[];
  /** The ink for the wild past the land, drawn wherever there is no paint. */
  readonly wild: WildInk;
}

/**
 * Returns each wet cell's distance in cells from the nearest dry one, by a
 * two-pass chamfer, for shading deeper water.
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

/** Paints the land onto paper, yielding between steps so a driver can spread the work over idle time. */
function* paintPaper(stood: StoodWorld, placeAt: (x: number, z: number) => Place, places: WorldPlaces, style: MapStyle): Generator<void, Paper> {
  const t = stood.terrain;
  const size = t.spec.size;
  const half = size / 2;
  // The sheet ends `MARGIN` past the land's half side. The land runs to its edges and the wild fills its corners.
  const reach = half + MARGIN;
  const scale = PAPER / (reach * 2);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PAPER;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const px = (v: number): number => (v + reach) * scale;

  // The world-anchored paper texture. Every view lays the same texture past the land, so the paper is continuous.
  layGround(ctx, style, px(0), px(0), scale, PAPER, PAPER);
  yield;

  // Samples each cell's area.
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

  // The mask that fades the paint to bare paper at the sheet's edge.
  const fade = yield* fadeMask(style, places.aspect ?? 1);

  // Washes: color on the map shows vitality. Every area starts from the same green, toned by its path, and each
  // file's vitality spreads over the ground around it (`healthField`), across area borders too, so the land is one
  // gradient. Areas use the outlines the layout traces (`outlinesOf`), and their rims pool.
  const traced = outlinesOf(places);
  yield;
  // The traced outlines step along a lattice a few meters apart, so they are smoothed first.
  const outlines = { areas: traced.areas.map((o) => ({ ...o, rings: o.rings.map(easeRing) })) };
  yield;
  // An area's vitality pools every file under it, weighted by patch area, which the layout makes proportional to
  // code. An area's own wash uses the files on its own ground, or all of its subdirectories' files where it has none
  // of its own (`groundVitality`).
  const parts = places.patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius }));
  const vitality = areaVitality(parts);
  const grounds = groundVitality(parts);
  const ownVitality = (path: string): number => grounds.get(path) ?? 1;
  const healthAt = healthField(
    places.patches.map((q) => ({ x: q.x, z: q.z, reach: q.radius, size: q.radius * q.radius, vitality: q.vitality })),
    style.spread,
  );
  // Colors every cell by its vitality over its nearest area's green. Past the land's rounded rim, cells take the
  // nearest area, so the paint runs on to the sheet's edge.
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
      const v = shownVitality(healthAt(-reach + (i + 0.5) * AREA_CELL, -reach + (j + 0.5) * AREA_CELL, ownVitality(area?.path ?? "")));
      uimg.data.set([...healthColor(style, lands[nearest[c] as number] ?? mixRgb(style.wild, style.wild, 0), v), 255], c * 4);
    }
    if (j % 8 === 7) yield;
  }
  uctx.putImageData(uimg, 0, 0);
  // Each area's rim pools in its own ground's vitality color, and dry ground shows the paper through. An area too
  // small for any sample still gets a rim (the second list below).
  const outlineOf = new Map(outlines.areas.map((o) => [o.path, o]));
  const ground = (path: string): boolean => stood.grounds.has(path);
  const washAreaOf = (path: string, depth: number, rings: readonly (readonly number[])[]): WashArea => ({
    path: ringsPath(rings, px),
    depth,
    pool: healthColor(style, landWash(style, path), shownVitality(ownVitality(path))),
    dry: ground(path) ? dryness(shownVitality(ownVitality(path))) : 0,
  });
  const sheet: WashSheet = {
    reach,
    half,
    ...(places.aspect === undefined ? {} : { aspect: places.aspect }),
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
  // Paints the washes on a separate canvas, each opaque over the one it nests in, then blends that canvas onto the
  // paper in one pass, so nested washes never muddy each other.
  const wash = document.createElement("canvas");
  wash.width = wash.height = PAPER;
  yield* layWash(wash.getContext("2d") as CanvasRenderingContext2D, under, sheet, style);
  yield;
  yield* floatWash(ctx, wash, 0, 0, style);
  yield;

  // Hill shading, contours and ponds.
  const contours = yield* paintRelief(ctx, t, style, reach, PAPER);

  // Each file's traced patch outline, drawn in fine dotted ink once the map zooms in close.
  const patchOf = new Map(places.patches.map((p) => [p.path, p]));
  const patches: Paper["patches"][number][] = [];
  for (const [k, o] of traced.patches.entries()) {
    const p = patchOf.get(o.path);
    if (p !== undefined) patches.push({ path: meterPath(o.rings.map(easeRing)), x: p.x, z: p.z, radius: p.radius, name: p.name, area: p.area });
    if (k % 60 === 59) yield;
  }
  yield;

  // Rasterizes the land for names from the traced outlines and the lots, as the loading screen does from the same
  // land before the world loads.
  const names = yield* nameLand(traced.areas, size, reach, stood.lots, places.aspect);
  const labelOf = new Map(names.labels.map((l) => [l.index, l]));
  const labelAt = (x: number, z: number): AreaLabel | undefined => {
    const i = Math.floor((x + reach) / CELL);
    const j = Math.floor((z + reach) / CELL);
    return i < 0 || j < 0 || i >= names.n || j >= names.n ? undefined : labelOf.get(names.at[j * names.n + i] as number);
  };
  const borders = outlines.areas.filter((o) => o.depth > 0).map((o) => ({ path: new Path2D(borderPath(o.rings, t.spec)), depth: o.depth }));
  // The wild past the paint is inked as views need it.
  const wild = createWildInk(t, style, reach, fade);
  return { canvas, reach, style, names, labelAt, vitality, patches, contours, borders, wild };
}

/** Returns each cell's area from `at`, or for a cell with none (-1), the area of the nearest cell with one, by breadth-first fill. */
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
 * Writes one cell's hill shading into cell `c` of `shade` and `light` from the gradient (`gx`, `gz`), scaled by
 * `fade`. Slopes facing away from the northwest light get shadow, and slopes facing it get warm light. `reliefMost`
 * caps both, so a steep wall shades no darker than a gentle hillside and a valley's side reads as a slope, not a band.
 */
export function shadeSlope(style: MapStyle, gx: number, gz: number, fade: number, shade: ImageData, light: ImageData, c: number): void {
  let tint = tints.get(style);
  if (tint === undefined) tints.set(style, (tint = [mixRgb(style.shadow, style.shadow, 0), mixRgb(style.light, style.light, 0)]));
  const lit = (gx + gz) * style.relief;
  const [[sr, sg, sb], [lr, lg, lb]] = tint;
  shade.data.set([sr, sg, sb, Math.round(255 * Math.max(0, Math.min(style.reliefMost, -lit)) * fade)], c * 4);
  light.data.set([lr, lg, lb, Math.round(255 * Math.max(0, Math.min(style.reliefMost, lit)) * fade)], c * 4);
}
const tints = new WeakMap<MapStyle, readonly [readonly [number, number, number], readonly [number, number, number]]>();

/**
 * Draws a grid of hill shading (`shadeSlope`) over a sheet `side` pixels square, blurred by `style.reliefBlur`. It
 * blurs on a canvas a quarter of the sheet's size and scales that up, since a blur over the whole paper would delay a
 * frame.
 */
export function layShade(ctx: CanvasRenderingContext2D, img: ImageData, mode: GlobalCompositeOperation, alpha: number, style: MapStyle, side: number): void {
  const hill = document.createElement("canvas");
  hill.width = img.width;
  hill.height = img.height;
  (hill.getContext("2d") as CanvasRenderingContext2D).putImageData(img, 0, 0);
  const SOFT = Math.round(side / 4);
  const soft = document.createElement("canvas");
  soft.width = soft.height = SOFT;
  const sctx = soft.getContext("2d") as CanvasRenderingContext2D;
  sctx.filter = `blur(${((style.reliefBlur * side) / PAPER / 4).toFixed(2)}px)`;
  sctx.drawImage(hill, 0, 0, SOFT, SOFT);
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.drawImage(soft, 0, 0, side, side);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/**
 * Returns contour paths in meters through a grid of heights `n` a side, `cell` meters apart starting at `from`
 * meters: one every `style.contour.interval` meters, with every `index`th heavier, kept where `keep` accepts. On steep
 * ground, such as a valley's sides or a stream's banks, only the heavier lines are drawn (`contour.thin`), as survey
 * maps thin lines that would crowd into a band. Each level is joined and simplified, so a view strokes a few long
 * lines, not thousands of cell-sized pieces.
 */
export function* contoursOf(heights: Float32Array, n: number, cell: number, from: number, style: MapStyle, keep: (x0: number, y0: number, x1: number, y1: number) => boolean): Generator<void, Paper["contours"]> {
  const c = style.contour;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of heights) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  const m = (g: number): number => from + (g + 0.5) * cell;
  const thin = { slopes: slopes(heights, n, cell), steepest: c.thin };
  const contours: Paper["contours"][number][] = [];
  for (let step = Math.ceil(lo / c.interval); step * c.interval <= hi; step++) {
    const index = step % c.index === 0;
    const contour = new Path2D();
    for (const line of contourLines(heights, n, step * c.interval, keep, index ? undefined : thin)) {
      const pts = simplified(line.map(m), 0.6);
      contour.moveTo(pts[0] as number, pts[1] as number);
      for (let q = 2; q < pts.length; q += 2) contour.lineTo(pts[q] as number, pts[q + 1] as number);
    }
    contours.push({ path: contour, index });
    yield;
  }
  return contours;
}

/**
 * Paints the land's relief on `ctx`, a sheet `side` pixels square that reaches `reach` meters from the land's center.
 * Hills are shaded violet away from the northwest light and warm toward it. Ponds darken toward their centers and get
 * banks and a few ripples. Returns the contours in meters for a view to stroke at its own scale.
 */
export function* paintRelief(ctx: CanvasRenderingContext2D, t: Terrain, style: MapStyle, reach: number, side: number): Generator<void, Paper["contours"]> {
  // The grids grow with the world, so the loops yield by elapsed time, not by rows.
  let since = performance.now();
  const due = (): boolean => {
    if (performance.now() - since < RELIEF_STEP_MS) return false;
    since = performance.now();
    return true;
  };
  const size = t.spec.size;
  const scale = side / (reach * 2);
  const k = side / PAPER;
  const px = (v: number): number => (v + reach) * scale;

  // Hills: shadow on slopes facing away from the northwest light, and warm light on slopes facing it when `style.lightAlpha` is above 0.
  const hn = Math.ceil((reach * 2) / HILL_CELL);
  const e = HILL_CELL * 1.5;
  const heights = new Float32Array(hn * hn);
  const shadeImg = new ImageData(hn, hn);
  const lightImg = new ImageData(hn, hn);
  for (let j = 0; j < hn; j++) {
    for (let i = 0; i < hn; i++) {
      const x = -reach + (i + 0.5) * HILL_CELL;
      const z = -reach + (j + 0.5) * HILL_CELL;
      // Uses the sheet's relief (`reliefAt`), blended at the rim (`RIM`).
      const gx = (reliefAt(t, x + e, z) - reliefAt(t, x - e, z)) / (2 * e);
      const gz = (reliefAt(t, x, z + e) - reliefAt(t, x, z - e)) / (2 * e);
      const c = j * hn + i;
      heights[c] = reliefAt(t, x, z);
      // In the blended band at the rim and past it, the blended heights would shade in stripes along their rays. So
      // the shading fades out across the band and is 0 at the rim.
      const inside = Math.max(0, Math.min(1, -pastTheEdge(t.spec, x, z) / RIM.inner));
      const fadeHere = paintAt(style, (i + 0.5) / hn, (j + 0.5) / hn, t.spec.aspect ?? 1) * inside * inside * (3 - 2 * inside);
      shadeSlope(style, gx, gz, fadeHere, shadeImg, lightImg, c);
    }
    if (due()) yield;
  }
  layShade(ctx, shadeImg, "multiply", style.shadowAlpha, style, side);
  yield;
  if (style.lightAlpha > 0) layShade(ctx, lightImg, "screen", style.lightAlpha, style, side);
  yield;

  // Contours stop `RIM.held` meters inside the land's edge. Past that the heights are blended toward the rim, and
  // their lines would only ring the land.
  const hm = (gr: number): number => -reach + (gr + 0.5) * HILL_CELL;
  const onLand = (x0: number, y0: number, x1: number, y1: number): boolean => pastTheEdge(t.spec, hm((x0 + x1) / 2), hm((y0 + y1) / 2)) <= -RIM.held;
  const contours = yield* contoursOf(heights, hn, HILL_CELL, -reach, style, onLand);
  yield;

  // Samples the ponds on a fine grid. Only ponds go on the paper. `drawLand` draws streams as lines at the view's
  // scale, so a river looks the same at any zoom.
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
    if (due()) yield;
  }
  const depth = wetDistance(wet, wn);
  yield;
  // Water darkens toward a pond's center.
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
  // A shadow under each pond's bank and a light line along its rim.
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

/** The halo color drawn around a small name so it reads clear of the paint. */
export const haloOf = (style: MapStyle): string => `rgba(${mixRgb(style.paper, style.paper, 0).join(",")},0.82)`;
/** How far in meters the land and its margin reach north and south of the center. On square land it equals the paper's reach. */
export const landDepth = (paper: Paper): number => Math.min(paper.reach, (paper.reach - MARGIN) / (paper.names.aspect ?? 1) + MARGIN);
/** The delay in ms before a tap on the map acts, so a second press can make it a double tap, which zooms. */
const PICK_WAIT_MS = 240;
/** The zoom, as a multiple of the whole sheet's, at which each file's patch and name are drawn. */
export const CLOSE = 2.4;
/** How far in pixels into the compass rose's corner an area's name fades out completely. The rose and its N start 13 px in. */
const ROSE_FADE = 12;
/** How much marks, trees and trails grow at zoom `near`, a multiple of the whole sheet's: from 1 up to 1.6. */
const growAt = (near: number): number => Math.min(1.6, Math.max(1, Math.sqrt(near) * 0.85));
/** Durations in ms of the map opening from the minimap, closing into it, and gliding to an area whose name was tapped. */
const UNFOLD_MS = 640;
const FOLD_MS = 360;
const GLIDE_MS = 700;
/**
 * When the map opens in the wild, the sheet grows to include the traveller plus this many meters, and at least this
 * many pixels, so the traveller is wholly on it however far out they are.
 */
const TAKE_IN = { meters: 60, px: 36 };
/** How far in meters the person walks before the wild's ink around them is queued again. */
const WARM_STEP = 20;

/**
 * Runs `step` in the page's idle time, passing the milliseconds left, until it returns true. With `least`, the work
 * runs for at least that many ms every frame however busy the page is. Idle time alone could leave it one step a
 * second while a world opens.
 */
function whenIdle(step: (budget: number) => boolean, least = 0): () => void {
  let handle = 0;
  let stopped = false;
  const hasIdle = typeof window.requestIdleCallback === "function";
  const idle = (cb: (deadline?: IdleDeadline) => void): number => (hasIdle ? window.requestIdleCallback(cb, { timeout: least > 0 ? 16 : 1000 }) : window.setTimeout(cb, 16));
  const run = (deadline?: IdleDeadline): void => {
    if (stopped) return;
    if (!step(Math.max(least, deadline?.timeRemaining() ?? 4))) handle = idle(run);
  };
  handle = idle(run);
  return () => {
    stopped = true;
    if (hasIdle) window.cancelIdleCallback(handle);
    else window.clearTimeout(handle);
  };
}

/** Line widths in pixels at every zoom: a contour, an index contour, an area's border and its hedgerow. */
const LINE = { contour: 0.85, index: 1.4, border: 1, hedge: 3.2 };

/**
 * Draws the land in a view `w` by `h` pixels: the painted paper and the wild's
 * ink past it (`wild-ink.ts`), then contours, area borders and rivers at the
 * view's scale, dotted trails, plants (`drawPlants`), and building and
 * landmark marks worn by their vitality. `grow` sizes the trees, trails and
 * marks. The field map, the minimap and the jump cover all draw the land this
 * way. With `now`, a wild ink tile not yet inked is inked at once. Otherwise
 * it waits for idle time. Returns the boxes the marks take, which names keep
 * off.
 */
export function drawLand(ctx: CanvasRenderingContext2D, w: number, h: number, paper: Paper, stood: StoodWorld, view: LandView, grow: number, now = true): [number, number, number, number][] {
  const sx = (x: number): number => (x - view.x) * view.zoom + w / 2;
  const sy = (z: number): number => (z - view.z) * view.zoom + h / 2;
  const visible = (x: number, y: number, pad: number): boolean => x > -pad && x < w + pad && y > -pad && y < h + pad;
  const style = paper.style;
  // The paper texture under the whole view, the land's painted square on it, and the wild's ink where there is no paint.
  paper.wild.ground(ctx, w, h, view);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const side = paper.reach * 2 * view.zoom;
  ctx.drawImage(paper.canvas, sx(-paper.reach), sy(-paper.reach), side, side);
  paper.wild.draw(ctx, w, h, view, now);

  // Linework in meters under the view's transform, with widths in pixels: contours, and area borders clipped 3 m
  // inside the land's edge.
  ctx.save();
  ctx.translate(w / 2 - view.x * view.zoom, h / 2 - view.z * view.zoom);
  ctx.scale(view.zoom, view.zoom);
  ctx.lineCap = ctx.lineJoin = "round";
  strokeContours(ctx, paper.contours, view.zoom, style);
  ctx.save();
  ctx.clip(rimPath({ size: (paper.reach - MARGIN) * 2, ...(paper.names.aspect === undefined ? {} : { aspect: paper.names.aspect }) }, 3));
  strokeBorders(ctx, paper.borders, view.zoom);
  ctx.restore();
  ctx.restore();

  drawRivers(ctx, stood.terrain.streams, sx, sy, view.zoom);
  drawTrails(ctx, stood.ways, sx, sy, view.zoom, grow, style);
  drawPlants(ctx, stood, sx, sy, view.zoom, grow, visible);

  // Buildings and landmarks, each drawn from its blueprint and worn by its vitality. Names keep off the boxes they take.
  const s = markScale(view.zoom, grow);
  const taken: [number, number, number, number][] = [];
  for (const l of stood.landmarks) {
    const x = sx(l.x);
    const y = sy(l.z);
    if (!visible(x, y, 30 * s)) continue;
    taken.push(stampLandmark(ctx, x, y, s, l, shownVitality(l.vitality), l.name));
  }
  for (const b of stood.buildings) {
    const x = sx(b.x);
    const y = sy(b.z);
    if (!visible(x, y, 30 * s)) continue;
    taken.push(stampBuilding(ctx, x, y, s, b, shownVitality(b.vitality), b.name));
  }
  return taken;
}

/** Strokes each area's border as a soft hedgerow under a fine line, on `ctx` in meters at `zoom` pixels per meter. Depth 1 borders are a little heavier. */
export function strokeBorders(ctx: CanvasRenderingContext2D, borders: Paper["borders"], zoom: number): void {
  for (const b of borders) {
    ctx.strokeStyle = "rgba(52,80,40,0.16)";
    ctx.lineWidth = (b.depth === 1 ? LINE.hedge * 1.35 : LINE.hedge) / zoom;
    ctx.stroke(b.path);
    ctx.strokeStyle = "rgba(46,66,34,0.44)";
    ctx.lineWidth = (b.depth === 1 ? LINE.border * 1.3 : LINE.border) / zoom;
    ctx.stroke(b.path);
  }
}

/** Strokes the contours on `ctx` in meters at `zoom` pixels per meter, with widths in pixels, so they look the same at every zoom. */
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

/** The station fields a sheet needs to draw a river: position and half width. */
export type RiverStation = Pick<Terrain["streams"][number]["stations"][number], "x" | "z" | "halfWidth">;

/**
 * Returns a river's course through its stations as SVG path data, a curve from source to mouth. `to` maps meters to
 * the drawing's units. The field map, its picture and the loading screen's pen all draw this course.
 */
export function riverCourse(stations: readonly RiverStation[], to: (x: number, z: number) => readonly [number, number]): string {
  const first = stations[0];
  const last = stations[stations.length - 1];
  if (first === undefined || last === undefined) return "";
  const f = (v: number): string => v.toFixed(2);
  const at = (x: number, z: number): string => to(x, z).map(f).join(" ");
  let d = `M${at(first.x, first.z)}`;
  for (let k = 1; k < stations.length - 1; k++) {
    const a = stations[k] as (typeof stations)[number];
    const b = stations[k + 1] as (typeof stations)[number];
    d += `Q${at(a.x, a.z)} ${at((a.x + b.x) / 2, (a.z + b.z) / 2)}`;
  }
  return `${d}L${at(last.x, last.z)}`;
}

/**
 * Splits a river into stretches of one drawn width each at `zoom` pixels per meter, so it draws narrower where it is
 * narrower, such as above a confluence and toward its ends. Each stretch ends at the station where the next begins.
 */
export function riverStretches<S extends RiverStation>(stations: readonly S[], zoom: number): readonly { readonly stations: readonly S[]; readonly width: number }[] {
  const stretches: { stations: readonly S[]; width: number }[] = [];
  let from = 0;
  for (let k = 1; k <= stations.length; k++) {
    const width = (s: number): number => 2 * (stations[s] as (typeof stations)[number]).halfWidth * zoom;
    if (k < stations.length && Math.abs(width(k) - width(from)) < STRETCH_PX) continue;
    const part = stations.slice(from, Math.min(stations.length, k + 1));
    if (part.length > 1) stretches.push({ stations: part, width: Math.max(...part.map((q) => 2 * q.halfWidth * zoom)) });
    from = k;
  }
  return stretches;
}

/** How many pixels a river's drawn width may change before a new stretch begins. */
const STRETCH_PX = 0.5;

/**
 * Returns a river stretch's three strokes for `width` pixels: a pale blue wash wider than the river, a darker edge,
 * and the water. Each has a minimum width, so a river never draws thinner than a line.
 */
export function riverStrokes(width: number): readonly { readonly color: string; readonly width: number }[] {
  return [
    { color: "rgba(122,182,206,0.32)", width: Math.max(5, width * 1.6 + 5) },
    { color: "rgba(46,104,136,0.6)", width: Math.max(2.2, width + 1.1) },
    { color: "rgb(112,172,200)", width: Math.max(1.4, width - 0.2) },
  ];
}

/**
 * Draws rivers along their courses (`riverCourse`), each stretch at its own width (`riverStretches`, `riverStrokes`).
 * It strokes every river's wash, then every edge, then all the water, so joining rivers merge without a seam. `sx`
 * and `sy` map meters to the view's pixels, at `zoom` pixels per meter.
 */
export function drawRivers(ctx: CanvasRenderingContext2D, streams: readonly { readonly stations: readonly RiverStation[] }[], sx: (x: number) => number, sy: (z: number) => number, zoom: number): void {
  ctx.lineCap = ctx.lineJoin = "round";
  const stretches = streams.flatMap((stream) =>
    riverStretches(stream.stations, zoom).map((s) => ({ line: new Path2D(riverCourse(s.stations, (x, z) => [sx(x), sy(z)])), strokes: riverStrokes(s.width) })),
  );
  for (let layer = 0; layer < 3; layer++) {
    for (const { line, strokes } of stretches) {
      const stroke = strokes[layer] as (typeof strokes)[number];
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.stroke(line);
    }
  }
}

/** Draws trails as dotted lines, scaled by `grow`. */
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

/** The smallest width in pixels of a tree's crown on the sheet at `grow` 1, at any zoom, so it stays legible. */
const TREE_LEAST = 4.6;
/** The pixel span at which a stone's, bush's or drift's mark starts to fade in, and the span at which it is opaque. The understory draws only at its true size on the land. */
const UNDERSTORY_SHOWS = [3, 6] as const;

/**
 * Draws trees, bushes, stones and flower drifts, each from its build (`plant-marks.ts`), from the top of the sheet
 * down so nearer marks overlap farther ones. A tree draws at its size on the land, with a crown at least `TREE_LEAST`
 * times `grow` across. A stone, bush or drift draws only at its size on the land, so the understory appears as the
 * map zooms in.
 */
export function drawPlants(ctx: CanvasRenderingContext2D, stood: Pick<StoodWorld, "trees" | "understory">, sx: (x: number) => number, sy: (z: number) => number, zoom: number, grow: number, visible: (x: number, y: number, pad: number) => boolean): void {
  for (const _ of drawingPlants(ctx, stood, sx, sy, zoom, grow, visible)) {
    // Draws every mark without pausing.
  }
}

/** Like `drawPlants`, but yields after every `stepMs` of drawing, so a caller drawing one step per frame never stalls. */
export function* drawingPlants(ctx: CanvasRenderingContext2D, stood: Pick<StoodWorld, "trees" | "understory">, sx: (x: number) => number, sy: (z: number) => number, zoom: number, grow: number, visible: (x: number, y: number, pad: number) => boolean, stepMs = Number.POSITIVE_INFINITY): Generator<void> {
  const marks: { x: number; y: number; s: number; plant: StoodPlant; alpha: number }[] = [];
  for (const t of stood.trees) {
    const x = sx(t.x);
    const y = sy(t.z);
    const s = Math.max(zoom * t.scale, (TREE_LEAST * grow) / (2 * t.build.radius));
    if (visible(x, y - t.build.height * s * 0.5, Math.max(t.build.height, t.build.radius * 2) * s)) marks.push({ x, y, s, plant: t, alpha: 1 });
  }
  for (const u of stood.understory) {
    const s = zoom * u.scale;
    const span = Math.max(u.build.height, u.build.radius * 2) * s;
    if (span < UNDERSTORY_SHOWS[0]) continue;
    const x = sx(u.x);
    const y = sy(u.z);
    if (visible(x, y, span)) marks.push({ x, y, s, plant: u, alpha: Math.min(1, (span - UNDERSTORY_SHOWS[0]) / (UNDERSTORY_SHOWS[1] - UNDERSTORY_SHOWS[0])) });
  }
  marks.sort((a, b) => a.y - b.y);
  let t0 = performance.now();
  for (const m of marks) {
    ctx.globalAlpha = m.alpha;
    stampPlant(ctx, m.x, m.y, m.s, m.plant.build, shownVitality(m.plant.vitality));
    if (performance.now() - t0 > stepMs) {
      ctx.globalAlpha = 1;
      yield;
      t0 = performance.now();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Letters an area's name at (x, y) in spaced capitals along the area's slant, as on a survey map, with the parent
 * folders of a repeated name above it in italic.
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
  ctx.font = nameFont(nameSize);
  ctx.letterSpacing = `${nameSpacing(nameSize)}px`;
  letter(ctx, l.area.name.toUpperCase(), 0, 2, style.ink, halo, 4.5);
  ctx.letterSpacing = "0px";
  ctx.restore();
}

/** Draws `text` with a paper-colored outline under the ink, so it reads over paint without a box. */
export function letter(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string, halo: string, haloWidth = 3): void {
  ctx.lineJoin = "round";
  ctx.lineWidth = haloWidth;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
}

/**
 * Creates the field map. `onToggle` is called whenever the map opens or
 * closes. `onPick` is called for a tap on the open map with the spot in the
 * world and the default name position of the area there, and returns whether
 * the person can go there.
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
  /** Whether to paint the paper while the person waits for the world, rather than only in idle time. */
  let paintSoon = false;
  let painting: Generator<void, Paper> | null = null;
  let stopPainting: (() => void) | null = null;
  const timing = { paintMs: 0, longestStepMs: 0, drawMs: 0 };
  let isOpen = false;
  let shown = false;
  const view = { x: 0, z: 0, zoom: 1, fit: 1 };
  /** The sheet's extent in meters: the land's square, or larger to include a traveller in the wild. */
  let box: [number, number, number, number] = [-604, -604, 604, 604];
  /** The land's reach the view was last fit to, or null when it was fit before the paper was painted. */
  let fittedTo: number | null = null;
  /** The person's position and heading, and whether they are in the wild, which has no area. */
  const person = { x: 0, z: 0, yaw: 0, wild: false };
  /** The person's position and wild flag when the wild's ink was last queued, and the paper it was queued for. */
  let warmed = { x: Number.NaN, z: Number.NaN, wild: false, paper: null as Paper | null };
  /** The minimap's last reported scale in pixels per meter. */
  let miniScale: number = INK.scale;
  let stopInking: (() => void) | null = null;
  /** The animation frame id of a pending redraw for newly inked tiles, or 0. */
  let inkDraw = 0;
  let labelCount = 0;
  /** Each name drawn: its box on the sheet, the position a tap on it leads to, and an area's bounds for the map to glide to. */
  let names: { box: [number, number, number, number]; x: number; z: number; bounds?: readonly [number, number, number, number] }[] = [];
  /** The spot a tap marked, waiting to be sent, and its timer. */
  let pick: { x: number; z: number; timer: number } | null = null;
  /** Whether the current press is the second of a double tap. */
  let doubled = false;
  /** The animation frame id of a glide to a tapped area name. */
  let glide = 0;
  /**
   * Every area's name placed for the sheet's side (`placeNames`): once for the whole sheet, as the loading screen
   * places them, and once at `CLOSE` zoom, where the land has room for each name on its own ground.
   */
  let placed: { paper: Paper; side: number; whole: NamePlaces; close: NamePlaces } | null = null;
  const measure = canvasMeasure(document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D);
  /** The open sheet's width in pixels, which names are placed for, as the loading screen places them for its sheet. */
  // The sheet is as wide as the land's square, and as deep as the land.
  const sheetSide = (): number => canvas.clientWidth || Math.min(window.innerWidth * 0.94, window.innerHeight * 0.9, 980);
  function* placing(p: Paper, side: number): Generator<void, NonNullable<typeof placed>> {
    const whole = yield* placeNames(p.names, side, measure);
    const close = yield* placeNames(p.names, side * CLOSE, measure, growAt(CLOSE));
    return { paper: p, side, whole, close };
  }
  /** Returns the names placed for the paper and the sheet's side. They are placed while the paper paints, and again only if the sheet changes size. */
  function namesOn(p: Paper): NonNullable<typeof placed> {
    const side = sheetSide();
    if (placed?.paper !== p || placed.side !== side) {
      const steps = placing(p, side);
      let step = steps.next();
      while (step.done !== true) step = steps.next();
      placed = step.value;
    }
    return placed;
  }

  /** Runs one painting step. Returns true once the paper is done. */
  function paintStep(): boolean {
    if (painting === null) return true;
    const t0 = performance.now();
    const next = painting.next();
    const ms = performance.now() - t0;
    timing.paintMs += ms;
    timing.longestStepMs = Math.max(timing.longestStepMs, ms);
    if (next.done === true) {
      paper = next.value;
      // The sheet keeps its width and takes the depth of the land and its margin.
      sheet.style.setProperty("--aspect", (paper.reach / landDepth(paper)).toFixed(4));
      painting = null;
      // Tiles inked while the map is open are drawn once at the next frame, however many land before it.
      paper.wild.onLanded(() => {
        if (isOpen && inkDraw === 0) {
          inkDraw = requestAnimationFrame(() => {
            inkDraw = 0;
            if (isOpen) draw();
          });
        }
      });
      // A map opened before its paper was painted was fit to a guessed land size, so it is fit again.
      if (isOpen && fittedTo !== paper.reach) fitView();
      if (isOpen) draw();
      for (const l of painted) l();
      warm();
      return true;
    }
    return false;
  }
  /**
   * Paints the paper and places its names, then inks the wild around the person before the paper is shown, so the
   * minimap has its ink when it first draws.
   */
  function* paperAndInk(): Generator<void, Paper> {
    const fresh = yield* paintPaper(source.stood(), source.placeAt, source.places(), style);
    placed = yield* placing(fresh, sheetSide());
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
    // Runs at least one step per idle slot, and more while the slot has time to spare.
    stopPainting = whenIdle((budget) => {
      const t0 = performance.now();
      do if (paintStep()) return true;
      while (performance.now() - t0 < budget - SPARE_MS);
      return false;
    }, paintSoon ? SOON_MS + SPARE_MS : 0);
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

  /** Clamps the zoom and keeps the sheet over the whole view. A sheet smaller than the view stays centered. */
  function clampView(): void {
    view.zoom = Math.max(view.fit * 0.9, Math.min(view.fit * 7, view.zoom));
    const [cx, cz] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const hx = Math.max(0, (box[2] - box[0]) / 2 - canvas.clientWidth / (2 * view.zoom));
    const hz = Math.max(0, (box[3] - box[1]) / 2 - canvas.clientHeight / (2 * view.zoom));
    view.x = Math.max(cx - hx, Math.min(cx + hx, view.x));
    view.z = Math.max(cz - hz, Math.min(cz + hz, view.z));
  }

  /**
   * Returns the sheet's extent in meters for a view `w` by `h` pixels, and the zoom that fits it. On the land it is
   * the land and its margin. In the wild it grows to include the traveller plus `TAKE_IN`.
   */
  function sheetFor(w: number, h: number): { box: [number, number, number, number]; fit: number } {
    const r = paper?.reach ?? 604;
    const d = paper === null ? r : landDepth(paper);
    const fitOf = (b: readonly number[]): number => Math.min(w / ((b[2] as number) - (b[0] as number)), h / ((b[3] as number) - (b[1] as number)));
    let grown: [number, number, number, number] = [-r, -d, r, d];
    if (!person.wild) return { box: grown, fit: fitOf(grown) };
    // Iterates because the margin depends on the fit. It keeps the traveller `TAKE_IN.px` pixels from the edge however small the land becomes.
    let margin = TAKE_IN.meters;
    for (let k = 0; k < 3; k++) {
      grown = [Math.min(-r, person.x - margin), Math.min(-d, person.z - margin), Math.max(r, person.x + margin), Math.max(d, person.z + margin)];
      margin = Math.max(TAKE_IN.meters, TAKE_IN.px / fitOf(grown));
    }
    return { box: grown, fit: fitOf(grown) };
  }

  /** The box `INK.ahead` meters around the person at the minimap's scale, which the wild's ink is queued for. */
  function minimapView(): { box: [number, number, number, number]; zoom: number } {
    miniScale = minimapAt()?.scale ?? miniScale;
    const a = INK.ahead;
    return { box: [person.x - a, person.z - a, person.x + a, person.z + a], zoom: miniScale };
  }

  /**
   * Queues the wild's ink for idle time: around the person at the minimap's scale first, then the sheet the map would
   * open to now. `frame` calls it again every `WARM_STEP` meters, so the ink is ready before either view draws it.
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
      const close = w < 560;
      const zoom = close ? sheet.fit * 2.2 : sheet.fit;
      const [cx, cz] = close ? [person.x, person.z] : [(sheet.box[0] + sheet.box[2]) / 2, (sheet.box[1] + sheet.box[3]) / 2];
      views.push({ box: [cx - w / 2 / zoom, cz - h / 2 / zoom, cx + w / 2 / zoom, cz + h / 2 / zoom], zoom });
    }
    p.wild.want(views);
    inkInIdle();
  }

  /** Inks the wild's queued tiles in idle time, a few milliseconds at a time, as the paper paints. */
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
   * Moves the traveller marker, with the name of the file underfoot beside
   * it, to the person's position, and turns the footprints to their heading.
   * It is a separate element moved by a transform, so walking with the map
   * open never redraws the sheet. If the person is off the visible sheet, the
   * marker stays at the nearest edge.
   */
  function placeHere(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const fx = (person.x - view.x) * view.zoom + w / 2;
    const fy = (person.z - view.z) * view.zoom + h / 2;
    const x = Math.max(22, Math.min(w - 22, fx));
    const y = Math.max(44, Math.min(h - 30, fy));
    // At the edge, the marker hides the file name because that file is not on this part of the map.
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
    // The sheet stays bare until the paper is painted, which happens soon after every bake.
    if (paper === null) return;
    const stood = source.stood();
    const sx = (x: number): number => (x - view.x) * view.zoom + w / 2;
    const sy = (z: number): number => (z - view.z) * view.zoom + h / 2;
    const visible = (x: number, y: number, pad: number): boolean => x > -pad && x < w + pad && y > -pad && y < h + pad;
    // Marks grow a little as the map zooms in (`growAt`).
    const near = view.zoom / Math.max(view.fit, 1e-6);
    const grow = growAt(near);
    const halo = haloOf(style);

    // How far the file level has faded in, from 0 at `CLOSE` to 1 at `CLOSE` + 0.8.
    const close = Math.max(0, Math.min(1, (near - CLOSE) / 0.8));
    // Wild ink tiles this view lacks are inked in idle time, and `onLanded` redraws the sheet.
    const marks = drawLand(ctx, w, h, paper, stood, view, grow, false);
    inkInIdle();
    if (close > 0) {
      ctx.save();
      ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * (w / 2 - view.x * view.zoom), dpr * (h / 2 - view.z * view.zoom));
      // Each file's patch outline in fine dotted ink.
      ctx.lineWidth = 1 / view.zoom;
      ctx.setLineDash([2.2 / view.zoom, 3.2 / view.zoom]);
      ctx.strokeStyle = `rgba(74,60,44,${(0.42 * close).toFixed(3)})`;
      for (const p of paper.patches) if (visible(sx(p.x), sy(p.z), p.radius * view.zoom * 2)) ctx.stroke(p.path);
      ctx.restore();
    }

    // Each area's name is lettered (`letterName`) where `placeNames` put it for the whole sheet, the same place the
    // loading screen uses. It moves with the land as the map pans and zooms and keeps one size, lettered smaller only
    // on a view that shows the land smaller than the whole sheet. The person's position plays no part. As the map
    // nears `CLOSE`, a name that sat off its own ground on the whole sheet crossfades to its close-in place. The
    // compass rose stays in its corner, so a name the view moves into that corner fades out over `ROSE_FADE` pixels
    // and fades back in as it leaves. On the whole sheet `placeNames` keeps names clear of the corner.
    const { whole, close: closeIn } = namesOn(paper);
    const rose: Box = [w - ROSE.right - 34, h - ROSE.bottom - 46, w, h];
    const offRose = (b: Box): number => Math.max(0, Math.min(1, 1 - Math.min(b[2] - rose[0], b[3] - rose[1]) / ROSE_FADE));
    labelCount = 0;
    names = [];
    /** Every name lettered on this view, which the smaller names keep off. */
    const taken: Box[] = [];
    /** Letters a name placed for `scale` pixels per meter at opacity `alpha`. Returns whether it shows on this view. */
    const placeName = (p: NamePlace, scale: number, alpha: number): boolean => {
      const shrink = Math.min(1, view.zoom / scale);
      const x = sx(p.x);
      const y = sy(p.z);
      const box: [number, number, number, number] = [x + p.box[0] * shrink, y + p.box[1] * shrink, x + p.box[2] * shrink, y + p.box[3] * shrink];
      alpha *= offRose(box);
      if (alpha <= 0 || box[2] < 0 || box[0] > w || box[3] < 0 || box[1] > h) return false;
      taken.push(box);
      if (alpha >= 0.5) names.push({ box, x: p.label.x, z: p.label.z, bounds: p.label.bounds });
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.scale(shrink, shrink);
      letterName(ctx, p.label, 0, 0, p.size, style);
      ctx.restore();
      return true;
    };
    const closeOf = new Map(closeIn.places.map((p) => [p.label.area.path, p]));
    for (const p of whole.places) {
      const q = closeOf.get(p.label.area.path) ?? p;
      // The same place on both levels is lettered once.
      const same = Math.hypot(sx(q.x) - sx(p.x), sy(q.z) - sy(p.z)) < 1 && q.size === p.size;
      const shown = same ? placeName(p, whole.scale, 1) : [placeName(p, whole.scale, 1 - close), placeName(q, closeIn.scale, close)].includes(true);
      if (shown) labelCount++;
    }
    const apart = (box: Box, from: readonly Box[]): boolean => from.every(([a, b, c, d]) => box[2] < a || box[0] > c || box[3] < b || box[1] > d);

    // Zoomed in close, each file's name is lettered small on its patch, and a tap on it travels there.
    if (close > 0) {
      ctx.font = `italic 12px ${SERIF}`;
      ctx.globalAlpha = close;
      for (const p of [...paper.patches].sort((a, b) => b.radius - a.radius)) {
        if (p.radius * view.zoom < 15) continue;
        const x = sx(p.x);
        const y = sy(p.z);
        const halfW = ctx.measureText(p.name).width / 2 + 2;
        const box: [number, number, number, number] = [x - halfW, y - 7, x + halfW, y + 7];
        if (!visible(x, y, -10) || !apart(box, [rose, ...marks, ...taken])) continue;
        taken.push(box);
        names.push({ box, x: p.x, z: p.z });
        letter(ctx, p.name, x, y, "rgba(58,47,34,0.92)", halo, 2.5);
      }
      ctx.globalAlpha = 1;
    }
    // Above 1.6 times the whole sheet's zoom, buildings and landmarks get names below them, clear of the rose and
    // every other name.
    if (near > 1.6) {
      ctx.font = `italic 12.5px ${SERIF}`;
      const named = [...stood.landmarks.map((l) => ({ ...l, below: 15 })), ...stood.buildings.map((b) => ({ ...b, below: 13 }))];
      for (const m of named) {
        const x = sx(m.x);
        const y = sy(m.z) + m.below * grow + 6;
        const halfW = ctx.measureText(m.name).width / 2 + 3;
        const box: [number, number, number, number] = [x - halfW, y - 8, x + halfW, y + 8];
        if (!visible(x, y, 0) || !apart(box, [rose, ...taken])) continue;
        taken.push(box);
        letter(ctx, m.name, x, y, style.ink, halo, 3);
      }
    }

    placeHere();
    // A vermilion cross on the spot a tap picked.
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

    // The compass rose in the lower right corner: a ring, four long half-shaded points, four short ones between, and
    // N above. A tap on it centers the map on the person (`findHere`).
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
    // A sheet narrower than 560 px, as on a phone, opens zoomed in on the person so names are readable. A wider one
    // shows the whole land. The sheet's height follows the land, so its width alone tells the two apart.
    const close = w < 560;
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
   * Returns the CSS transforms that place the sheet over the minimap, with its land at the minimap's scale and
   * rotation around the person's spot. The sheet opens from there and closes back into it.
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
    // Normalizes the turn to -180..180 degrees, so the land rotates to north-up the short way.
    const turn = ((((minimap.turn * 180) / Math.PI) % 360) + 540) % 360 - 180;
    const [ax, ay] = minimap.at;
    return {
      sheet: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k.toFixed(4)})`,
      land: `translate(${(w * ax - px).toFixed(1)}px, ${(h * ay - py).toFixed(1)}px) scale(${zoom.toFixed(3)}) rotate(${turn.toFixed(2)}deg)`,
      origin: `${px.toFixed(1)}px ${py.toFixed(1)}px`,
    };
  }
  /** Returns the minimap's position in the layer's pixels. Called as the map opens. */
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
      // The sheet starts over the minimap at its scale and transitions to its place while the land zooms out. Only
      // transforms change, so nothing redraws during the animation.
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
      // Closes back into the minimap if it opened from there.
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
  /** Centers the map on the person, zoomed in enough to read. */
  function findHere(): void {
    view.x = person.x;
    view.z = person.z;
    view.zoom = Math.max(view.zoom, view.fit * 2.2);
    clampView();
    draw();
  }
  /** Animates the map to frame an area, zoomed in past `CLOSE` so its files show. */
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
      // Interpolates zoom in log space, so the scale changes at an even rate.
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

  // Drag pans. Pinch or scroll zooms about the fingers or the pointer.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  canvas.addEventListener("pointerdown", (e) => {
    cancelAnimationFrame(glide);
    // A second press within `PICK_WAIT_MS` is a double tap, which zooms. Neither tap travels.
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
  // A tap on the compass rose centers the map on the person. Below `CLOSE` zoom, a tap on an area's name glides to
  // the area. Otherwise a tap on a name or a spot marks it and, after `PICK_WAIT_MS`, passes it to `onPick`.
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
    const label = paper.labelAt(x, z);
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
    invalidate(soon = false) {
      // The latest call sets whether painting runs every frame (`soon`) or only in idle time.
      paintSoon = soon;
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
      // Moves the traveller only when the person moved more than 0.5 m or turned more than 0.03 rad since the last frame.
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
      /** The world point at the map's center. */
      x: view.x,
      z: view.z,
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
