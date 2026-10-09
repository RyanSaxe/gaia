// The field map: a hand-drawn map of the world on a torn sheet of handmade
// paper, unfolded from a small map button, painted as `map-styles.ts`
// says. The land runs to the sheet's edges and the wild fills
// its corners. Each area (a directory) and each file's patch is drawn from
// the outline the layout traces (`outlinesOf`): an area is a watercolor wash
// in the color of the land Jev judged for it (`groundWash`), its pigment
// pooling toward its rim and bleeding into its neighbors; a patch is
// a faint wash in its health's color. Hills are shaded, water is washed,
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

import { type Place, type PlaceArea, type WorldPlaces, heightAt, outlinesOf, waterDepthAt } from "@gaia/terrain";
import { areaVitality, groundVitality } from "@gaia/world";
import { onTap } from "../lab.ts";
import type { StoodWorld } from "../terrain/lab.ts";
import { DECKLE_MASK, MAP_STYLE, type MapStyle, TRAVELLER_SVG, dryness, healthColor, healthField, landWash } from "./map-styles.ts";
import { nameTails } from "./map-names.ts";
import { drawBuilding, drawLandmark } from "./marks.ts";

export interface FieldMap {
  /** The world changed: the paper is painted again while the page is idle. */
  invalidate(): void;
  /** Unfolds or folds the map. */
  open(on: boolean): void;
  /**
   * Where the minimap lies (in the layer's pixels) and its scale (pixels a meter), asked each time the map
   * unfolds: the sheet unfolds out of it and folds back into it.
   */
  unfoldsFrom(minimap: () => { readonly rect: DOMRect; readonly scale: number } | null): void;
  readonly isOpen: boolean;
  /** The painted paper, once it is painted: the minimap shows the same sheet. */
  paper(): Paper | null;
  /** Calls `listener` each time the paper has been painted afresh. */
  onPainted(listener: () => void): void;
  /** Follows the person; redraws only while the map is open. */
  frame(x: number, z: number, yaw: number, place: Place): void;
  /** Whether the immersive world shows: the map paints and opens only while it does. */
  show(on: boolean): void;
  /** What the map shows, for scripted checks: whether its paper is painted, zoom in pixels per meter and as a multiple of the whole sheet's, the paper's painting time and its longest step, and names drawn. */
  state(): {
    readonly open: boolean;
    readonly ready: boolean;
    readonly zoom: number;
    readonly near: number;
    readonly paintMs: number;
    readonly longestStepMs: number;
    readonly drawMs: number;
    readonly labels: number;
  };
}

export interface MapSource {
  stood(): StoodWorld;
  placeAt(x: number, z: number): Place;
  /** Every area and file patch, for drawing each file's ground. */
  places(): WorldPlaces;
}

/**
 * Paper size in pixels, and how far past the land's square the sheet runs, meters: none, so the painted country
 * runs square to every edge of the sheet, and the land's rounded rim is never drawn.
 */
const PAPER = 2048;
export const MARGIN = 0;
/**
 * Near its rounded rim the land rises to a crest. On the sheet its relief eases, over the last `inner` meters, to
 * the height `held` meters in, so neither the hill shade nor the contours draw a ring where the land ends.
 */
const RIM = { inner: 110, held: 60 };
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

/** How many points either side a traced outline's point is averaged with, and how many times, to ease its lattice steps into a line. */
const EASE = { reach: 5, passes: 2 };

/** A closed ring of x, z pairs with each point averaged with its neighbors along the ring. */
function easeRing(ring: readonly number[]): number[] {
  const count = ring.length / 2;
  if (count < EASE.reach * 2 + 3) return [...ring];
  let pts = Float64Array.from(ring);
  for (let pass = 0; pass < EASE.passes; pass++) {
    const out = new Float64Array(pts.length);
    for (let k = 0; k < count; k++) {
      let x = 0;
      let z = 0;
      for (let d = -EASE.reach; d <= EASE.reach; d++) {
        const i = (k + d + count) % count;
        x += pts[i * 2] as number;
        z += pts[i * 2 + 1] as number;
      }
      out[k * 2] = x / (EASE.reach * 2 + 1);
      out[k * 2 + 1] = z / (EASE.reach * 2 + 1);
    }
    pts = out;
  }
  return Array.from(pts);
}

/** A small canvas of soft blotches in one color, to be drawn large: smoothing turns its pixels into gentle mottling. */
function noiseCanvas(cells: number, seed: number, rgb: readonly [number, number, number]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = cells;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const img = g.createImageData(cells, cells);
  for (let k = 0; k < cells * cells; k++) img.data.set([rgb[0], rgb[1], rgb[2], Math.round(255 * hash(k + seed, seed))], k * 4);
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Marching squares over a grid between columns i0..i1 and rows j0..j1: line
 * segments, in grid coordinates, around the cells where `inside` holds.
 */
function contour(i0: number, i1: number, j0: number, j1: number, inside: (i: number, j: number) => boolean, emit: (x0: number, y0: number, x1: number, y1: number) => void): void {
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const k = (inside(i, j) ? 1 : 0) | (inside(i + 1, j) ? 2 : 0) | (inside(i + 1, j + 1) ? 4 : 0) | (inside(i, j + 1) ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const top = [i + 0.5, j] as const;
      const right = [i + 1, j + 0.5] as const;
      const bottom = [i + 0.5, j + 1] as const;
      const left = [i, j + 0.5] as const;
      const seg = (p: readonly [number, number], q: readonly [number, number]): void => emit(p[0], p[1], q[0], q[1]);
      if (k === 1 || k === 14) seg(left, top);
      else if (k === 2 || k === 13) seg(top, right);
      else if (k === 3 || k === 12) seg(left, right);
      else if (k === 4 || k === 11) seg(right, bottom);
      else if (k === 6 || k === 9) seg(top, bottom);
      else if (k === 7 || k === 8) seg(left, bottom);
      else if (k === 5) {
        seg(left, top);
        seg(right, bottom);
      } else if (k === 10) {
        seg(top, right);
        seg(left, bottom);
      }
    }
  }
}

/**
 * Marching squares over a grid of heights `n` on a side, between columns i0..i1
 * and rows j0..j1: line segments, in grid coordinates, where the ground crosses
 * `level`, each end placed along its cell edge where the height passes the
 * level, so a contour runs smooth.
 */
function isoline(h: Float32Array, n: number, level: number, emit: (x0: number, y0: number, x1: number, y1: number) => void, i0 = 0, i1 = n - 1, j0 = 0, j1 = n - 1): void {
  const at = (i: number, j: number): number => h[j * n + i] as number;
  const cross = (a: number, b: number): number => (level - a) / (b - a || 1e-6);
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      const k = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const top = (): [number, number] => [i + cross(a, b), j];
      const right = (): [number, number] => [i + 1, j + cross(b, c)];
      const bottom = (): [number, number] => [i + cross(d, c), j + 1];
      const left = (): [number, number] => [i, j + cross(a, d)];
      const seg = (p: [number, number], q: [number, number]): void => emit(p[0], p[1], q[0], q[1]);
      if (k === 1 || k === 14) seg(left(), top());
      else if (k === 2 || k === 13) seg(top(), right());
      else if (k === 3 || k === 12) seg(left(), right());
      else if (k === 4 || k === 11) seg(right(), bottom());
      else if (k === 6 || k === 9) seg(top(), bottom());
      else if (k === 7 || k === 8) seg(left(), bottom());
      else if (k === 5) {
        seg(left(), top());
        seg(right(), bottom());
      } else if (k === 10) {
        seg(top(), right());
        seg(left(), bottom());
      }
    }
  }
}

/** Joins line segments (x0, y0, x1, y1 each) that share ends into polylines, x and y pairs. */
function chained(segments: readonly number[]): number[][] {
  // Ends meet exactly where two segments share a cell's edge; a millimeter's grid makes them one key.
  const key = (x: number, y: number): number => (Math.round(x * 1000) + 2 ** 24) * 2 ** 26 + (Math.round(y * 1000) + 2 ** 24);
  const at = new Map<number, number[]>();
  const count = segments.length / 4;
  for (let k = 0; k < count; k++) {
    for (const end of [0, 2]) {
      const id = key(segments[k * 4 + end] as number, segments[k * 4 + end + 1] as number);
      const list = at.get(id);
      if (list === undefined) at.set(id, [k]);
      else list.push(k);
    }
  }
  const used = new Uint8Array(count);
  const lines: number[][] = [];
  // From a segment, walks on through the segment sharing its far end until none is left.
  const walk = (k: number, fromEnd: number, line: number[]): void => {
    let seg = k;
    let end = fromEnd;
    for (;;) {
      const x = segments[seg * 4 + end] as number;
      const y = segments[seg * 4 + end + 1] as number;
      const next = (at.get(key(x, y)) ?? []).find((o) => used[o] === 0);
      if (next === undefined) return;
      used[next] = 1;
      const near = key(segments[next * 4] as number, segments[next * 4 + 1] as number) === key(x, y) ? 0 : 2;
      const far = 2 - near;
      line.push(segments[next * 4 + far] as number, segments[next * 4 + far + 1] as number);
      seg = next;
      end = far;
    }
  };
  for (let k = 0; k < count; k++) {
    if (used[k] === 1) continue;
    used[k] = 1;
    const forward = [segments[k * 4] as number, segments[k * 4 + 1] as number, segments[k * 4 + 2] as number, segments[k * 4 + 3] as number];
    walk(k, 2, forward);
    const back: number[] = [];
    walk(k, 0, back);
    const head: number[] = [];
    for (let i = back.length - 2; i >= 0; i -= 2) head.push(back[i] as number, back[i + 1] as number);
    lines.push([...head, ...forward]);
  }
  return lines;
}

/** A polyline (x and y pairs) with the points that stray less than `tolerance` from the line through their neighbors dropped. */
function simplified(line: readonly number[], tolerance: number): number[] {
  const n = line.length / 2;
  if (n < 3) return [...line];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    const ax = line[a * 2] as number;
    const ay = line[a * 2 + 1] as number;
    const dx = (line[b * 2] as number) - ax;
    const dy = (line[b * 2 + 1] as number) - ay;
    const length = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(((line[i * 2] as number) - ax) * dy - ((line[i * 2 + 1] as number) - ay) * dx) / length;
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i] === 1) out.push(line[i * 2] as number, line[i * 2 + 1] as number);
  return out;
}

interface AreaLabel {
  readonly area: PlaceArea;
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
}

/** Smooth noise between 0 and 1, varying over about one unit. */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi + seed, yi);
  const b = hash(xi + 1 + seed, yi);
  const c = hash(xi + seed, yi + 1);
  const d = hash(xi + 1 + seed, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** How much paint the sheet holds at (u, v), its corners 0 and 1: full inside, giving way raggedly to bare paper at the edge. */
function paintAt(style: MapStyle, u: number, v: number): number {
  const edge = Math.min(u, 1 - u, v, 1 - v);
  const rag = (valueNoise(u * 22, v * 22, 3) - 0.5) * 2 * style.ragged + (valueNoise(u * 96, v * 96, 11) - 0.5) * style.ragged * 0.7;
  const t = Math.max(0, Math.min(1, (edge + rag - style.fade[0]) / (style.fade[1] - style.fade[0])));
  return t * t * (3 - 2 * t);
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

/** Pigment pooling darker toward an area's rim, inside its outline, as a wash dries. */
function poolRim(g: CanvasRenderingContext2D, path: Path2D, rgb: readonly [number, number, number], pool: MapStyle["pool"]): void {
  g.save();
  g.clip(path, "evenodd");
  const rim = rgb.map((c) => Math.round(c * 0.6)).join(",");
  for (const [width, alpha] of pool) {
    g.lineWidth = width;
    g.strokeStyle = `rgba(${rim},${alpha})`;
    g.stroke(path);
  }
  g.restore();
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

/** Where the paint gives way to bare paper at the sheet's edge: rows `j0` to `j1` of a mask `cells` on a side, in its alpha. */
function paintFade(img: ImageData, style: MapStyle, j0: number, j1: number): void {
  const cells = img.width;
  for (let j = j0; j < j1; j++) for (let i = 0; i < cells; i++) img.data[(j * cells + i) * 4 + 3] = Math.round(255 * paintAt(style, (i + 0.5) / cells, (j + 0.5) / cells));
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

  paintPaperGround(ctx, style, PAPER, PAPER);
  yield;

  // Areas: one sample per cell.
  const n = Math.ceil((reach * 2) / AREA_CELL);
  const at = new Int16Array(n * n).fill(-1);
  const areas: PlaceArea[] = [];
  const index = new Map<string, number>();
  const sums: { x: number; z: number; xx: number; zz: number; xz: number; cells: number; i0: number; i1: number; j0: number; j1: number }[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -reach + (i + 0.5) * AREA_CELL;
      const z = -reach + (j + 0.5) * AREA_CELL;
      const area = placeAt(x, z).area;
      if (area.depth < 0) continue;
      let k = index.get(area.path);
      if (k === undefined) {
        k = areas.length;
        index.set(area.path, k);
        areas.push(area);
        sums.push({ x: 0, z: 0, xx: 0, zz: 0, xz: 0, cells: 0, i0: i, i1: i, j0: j, j1: j });
      }
      at[j * n + i] = k;
      const s = sums[k] as (typeof sums)[number];
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
    if (j % 8 === 7) yield;
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
  yield;

  // Where the paint gives way to bare paper at the sheet's edge, as a small mask drawn large.
  const FADE_CELLS = 384;
  const fade = document.createElement("canvas");
  fade.width = fade.height = FADE_CELLS;
  const fctx = fade.getContext("2d") as CanvasRenderingContext2D;
  const fimg = fctx.createImageData(FADE_CELLS, FADE_CELLS);
  for (let j = 0; j < FADE_CELLS; j += 96) {
    paintFade(fimg, style, j, Math.min(FADE_CELLS, j + 96));
    yield;
  }
  fctx.putImageData(fimg, 0, 0);

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
  const washOf = (path: string): readonly [number, number, number] => healthColor(style, landWash(style, path), ownVitality(path));
  const healthAt = healthField(
    places.patches.map((q) => ({ x: q.x, z: q.z, reach: q.radius, size: q.radius * q.radius, vitality: q.vitality })),
    style.spread,
  );
  // Each ring is drawn as a curve through the middles of its edges, bending at its corners, so the
  // traced lattice's steps read as a pen's easy line; a border's pen also wobbles a little.
  const trace = (rings: readonly (readonly number[])[], wobble = 0, seed = 0): Path2D => {
    const p = new Path2D();
    for (const ring of rings) {
      const count = ring.length / 2;
      if (count < 3) continue;
      const point = (k: number): [number, number] => {
        const i = ((k % count) + count) % count;
        const jitter = wobble === 0 ? 0 : wobble * (hash(i + seed, count) - 0.5);
        return [px(ring[i * 2] as number) + jitter, px(ring[i * 2 + 1] as number) - jitter];
      };
      const [ax, ay] = point(0);
      let [bx, by] = point(1);
      p.moveTo((ax + bx) / 2, (ay + by) / 2);
      for (let k = 1; k <= count; k++) {
        const [cx, cy] = point(k + 1);
        p.quadraticCurveTo(bx, by, (bx + cx) / 2, (by + cy) / 2);
        [bx, by] = [cx, cy];
      }
      p.closePath();
    }
    return p;
  };
  // The washes are laid on their own sheet, each wash opaque over the one it nests in, and the sheet is
  // floated onto the paper at once, so nested washes never muddy each other.
  const wash = document.createElement("canvas");
  wash.width = wash.height = PAPER;
  const g = wash.getContext("2d") as CanvasRenderingContext2D;
  g.lineJoin = "round";
  // Every cell of the sheet in its health over its nearest area's land, laid soft: past the land's rounded rim the
  // painted country goes on to the paper's edge as the land beside it.
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
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(under, 0, 0, n * AREA_CELL * scale, n * AREA_CELL * scale);
  yield;
  const byDepth = [...outlines.areas].sort((a, b) => a.depth - b.depth);
  const ground = (path: string): boolean => stood.grounds.has(path);
  const paths = new Map<string, Path2D>();
  // The pooling stops a little inside the land's rim, so no rim is drawn along it.
  g.save();
  g.clip(rimPath(half - 8, px));
  for (const [k, o] of byDepth.entries()) {
    const path = trace(o.rings);
    paths.set(o.path, path);
    poolRim(g, path, washOf(o.path), style.pool);
    if (k % 6 === 5) yield;
  }
  g.restore();
  // Dry land lets the paper through in dry-brush streaks, each cell by the area nearest it, so the corners past the
  // land's rim take their neighbor's streaks and nothing marks the rim.
  const spans = new Map<number, [number, number, number, number]>();
  for (let c = 0; c < n * n; c++) {
    const k = nearest[c] as number;
    const i = c % n;
    const j = Math.floor(c / n);
    const b = spans.get(k);
    spans.set(k, b === undefined ? [i, j, i, j] : [Math.min(b[0], i), Math.min(b[1], j), Math.max(b[2], i), Math.max(b[3], j)]);
  }
  const cellAt = (x: number, y: number): number => Math.floor(y / scale / AREA_CELL) * n + Math.floor(x / scale / AREA_CELL);
  for (const [k, b] of spans) {
    const area = areas[k];
    const dry = area !== undefined && ground(area.path) ? dryness(ownVitality(area.path)) : 0;
    if (dry <= 0.05) continue;
    const box = [b[0], b[1], b[2] + 1, b[3] + 1].map((c) => c * AREA_CELL * scale) as [number, number, number, number];
    dryBrush(g, box, dry, style, k, (x, y) => nearest[cellAt(x, y)] === k);
  }
  yield;
  // Brushwork: the wash laid in broad, overlapping strokes, each a little warmer or cooler, lighter or darker.
  g.globalCompositeOperation = "source-atop";
  g.lineCap = "round";
  for (let k = 0; k < style.strokes; k++) {
    const x = hash(k, 71) * PAPER;
    const y = hash(71, k) * PAPER;
    const a = -0.5 + (hash(k, 72) - 0.5) * 0.9;
    const len = 50 + hash(k, 73) * 120;
    const tone = hash(k, 74);
    g.strokeStyle = tone < 0.3 ? "rgba(255,236,170,0.09)" : tone < 0.55 ? "rgba(70,110,120,0.07)" : tone < 0.8 ? "rgba(255,255,240,0.08)" : "rgba(70,56,30,0.07)";
    g.lineWidth = 12 + hash(k, 75) * 22;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (hash(k, 76) - 0.5) * 30, y + Math.sin(a) * len * 0.5 + (hash(k, 77) - 0.5) * 30, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
    if (k % 900 === 899) yield;
  }
  // Granulation: pigment settles unevenly into the paper's tooth, in fine specks and broad blooms.
  g.imageSmoothingEnabled = true;
  for (const [cells, strength, seed] of [[420, 0.16, 3.1], [36, 0.12, 9.7]] as const) {
    g.globalAlpha = strength;
    g.drawImage(noiseCanvas(cells, seed, [60, 46, 26]), 0, 0, PAPER, PAPER);
  }
  g.globalAlpha = 1;
  yield;
  // The paint gives way to paper at the sheet's edge.
  g.globalCompositeOperation = "destination-in";
  g.drawImage(fade, 0, 0, PAPER, PAPER);
  g.globalCompositeOperation = "source-over";
  yield;
  // Wet in wet: a softened copy of the washes laid first lets each one bleed into its neighbors.
  ctx.filter = `blur(${style.bleedPx}px)`;
  ctx.globalAlpha = style.bleed;
  ctx.drawImage(wash, 0, 0);
  ctx.filter = "none";
  yield;
  ctx.globalAlpha = style.washAlpha;
  ctx.drawImage(wash, 0, 0);
  ctx.globalAlpha = 1;
  yield;

  // Hills: shade away from the light in the northwest, and (when lit) a warm light on the slopes facing it.
  const hn = Math.ceil((reach * 2) / HILL_CELL);
  const e = HILL_CELL * 1.5;
  /** The ground's height as the sheet paints it: eased at the rim to the height a little way in (`RIM`). */
  const reliefAt = (x: number, z: number): number => {
    const r = Math.pow(Math.abs(x) ** 4 + Math.abs(z) ** 4, 0.25);
    const toRim = half - r;
    const h = heightAt(t.lattice, x, z);
    if (toRim >= RIM.inner) return h;
    const pull = Math.min(1, (half - RIM.held) / Math.max(r, 1e-6));
    const held = heightAt(t.lattice, x * pull, z * pull);
    const k = Math.max(0, Math.min(1, (toRim - RIM.held) / (RIM.inner - RIM.held)));
    return held + (h - held) * k * k * (3 - 2 * k);
  };
  const slopes = new Float32Array(hn * hn * 2);
  const heights = new Float32Array(hn * hn);
  const shadeImg = new ImageData(hn, hn);
  const lightImg = new ImageData(hn, hn);
  const [sr, sg, sb] = mixRgb(style.shadow, style.shadow, 0);
  const [lr, lg, lb] = mixRgb(style.light, style.light, 0);
  for (let j = 0; j < hn; j++) {
    for (let i = 0; i < hn; i++) {
      const x = -reach + (i + 0.5) * HILL_CELL;
      const z = -reach + (j + 0.5) * HILL_CELL;
      const gx = (reliefAt(x + e, z) - reliefAt(x - e, z)) / (2 * e);
      const gz = (reliefAt(x, z + e) - reliefAt(x, z - e)) / (2 * e);
      const k = j * hn + i;
      heights[k] = reliefAt(x, z);
      slopes[k * 2] = gx;
      slopes[k * 2 + 1] = gz;
      const lit = (gx + gz) * style.relief;
      // Over the band where the ground is eased toward the rim, and past it, the eased heights would shade in stripes
      // along their rays, so the shading fades out across the band and is gone at the rim.
      const inside = Math.max(0, Math.min(1, (half - Math.pow(x ** 4 + z ** 4, 0.25)) / RIM.inner));
      const fadeHere = paintAt(style, (i + 0.5) / hn, (j + 0.5) / hn) * inside * inside * (3 - 2 * inside);
      shadeImg.data.set([sr, sg, sb, Math.round(255 * Math.max(0, Math.min(1, -lit)) * fadeHere)], k * 4);
      lightImg.data.set([lr, lg, lb, Math.round(255 * Math.max(0, Math.min(1, lit)) * fadeHere)], k * 4);
    }
    if (j % 14 === 13) yield;
  }
  const hill = document.createElement("canvas");
  hill.width = hill.height = hn;
  const hctx = hill.getContext("2d") as CanvasRenderingContext2D;
  // The shading is softened on a sheet a quarter of the paper's size, and laid on the paper from there: a blur
  // over the whole paper would hold up a frame.
  const SOFT = PAPER / 4;
  const soft = document.createElement("canvas");
  soft.width = soft.height = SOFT;
  const sctx = soft.getContext("2d") as CanvasRenderingContext2D;
  const lay = (img: ImageData, mode: GlobalCompositeOperation, alpha: number): void => {
    hctx.clearRect(0, 0, hn, hn);
    hctx.putImageData(img, 0, 0);
    sctx.clearRect(0, 0, SOFT, SOFT);
    sctx.filter = `blur(${(style.reliefBlur / 4).toFixed(2)}px)`;
    sctx.drawImage(hill, 0, 0, SOFT, SOFT);
    sctx.filter = "none";
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = alpha;
    ctx.drawImage(soft, 0, 0, PAPER, PAPER);
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
      for (let k = 2; k < pts.length; k += 2) contour.lineTo(pts[k] as number, pts[k + 1] as number);
    }
    contours.push({ path: contour, index: step % c.index === 0 });
    yield;
  }
  yield;

  // Each file's patch: its own traced shape, drawn in fine dotted ink once the map comes close.
  const patchOf = new Map(places.patches.map((p) => [p.path, p]));
  const patches: Paper["patches"][number][] = [];
  for (const [k, o] of traced.patches.entries()) {
    const p = patchOf.get(o.path);
    if (p !== undefined) patches.push({ path: meterPath(o.rings.map(easeRing)), x: p.x, z: p.z, radius: p.radius, name: p.name, area: p.area });
    if (k % 60 === 59) yield;
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
  for (let k = 0; k < wn * wn; k++) {
    if (wet[k] === 0) continue;
    const s = Math.min(1, ((depth[k] as number) - 1) / 6);
    wimg.data.set([0, 1, 2].map((c) => Math.round((shallowRgb[c] as number) * (1 - s) + (deepRgb[c] as number) * s)), k * 4);
    wimg.data[k * 4 + 3] = 255;
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
  ctx.lineWidth = 6;
  ctx.save();
  ctx.translate(2, 2.5);
  ctx.stroke(coast);
  ctx.restore();
  ctx.strokeStyle = "rgba(250,244,222,0.5)";
  ctx.lineWidth = 1.8;
  ctx.stroke(coast);
  // A few ripple strokes inside each pond.
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  for (const pond of t.ponds) {
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(px(pond.x), px(pond.z), pond.reach * (0.3 + k * 0.18) * scale, Math.PI * (1.15 + k * 0.1), Math.PI * (1.45 + k * 0.1));
      ctx.stroke();
    }
  }
  yield;


  const tails = nameTails(areas.filter((a) => a.depth > 0).map((a) => a.path));
  const areaLabels = areas.map((area, k): AreaLabel => {
    const s = sums[k] as (typeof sums)[number];
    const mx = s.x / s.cells;
    const mz = s.z / s.cells;
    // The cell of the area's own ground farthest from its edges, nearest its middle among equals: the name sits
    // where the area is widest, never on its rim or past the land's edge.
    let x = mx;
    let z = mz;
    let best = -Infinity;
    for (let j = s.j0; j <= s.j1; j++) {
      for (let i = s.i0; i <= s.i1; i++) {
        if (at[j * n + i] !== k) continue;
        const cx = -reach + (i + 0.5) * AREA_CELL;
        const cz = -reach + (j + 0.5) * AREA_CELL;
        const score = (deep[j * n + i] as number) - Math.hypot(cx - mx, cz - mz) / (AREA_CELL * 40);
        if (score > best) {
          best = score;
          x = cx;
          z = cz;
        }
      }
    }
    const cell = (i: number): number => -reach + i * AREA_CELL;
    return { area, index: k, bounds: [cell(s.i0), cell(s.j0), cell(s.i1 + 1), cell(s.j1 + 1)], x, z, cells: s.cells, angle: axisOf(s).angle, above: tails.get(area.path) ?? "" };
  });
  const areaAt = (x: number, z: number): number => {
    const i = Math.floor((x + reach) / AREA_CELL);
    const j = Math.floor((z + reach) / AREA_CELL);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : (at[j * n + i] as number);
  };
  const borders = outlines.areas.filter((o) => o.depth > 0).map((o) => ({ path: meterPath(o.rings), depth: o.depth }));
  return { canvas, reach, style, areaLabels, areaAt, vitality, patches, contours, borders };
}

/** The land's rounded square `r` meters from its middle, through `px` (meters to the sheet's pixels): what keeps a pen inside the land. */
export function rimPath(r: number, px: (v: number) => number = (v) => v): Path2D {
  const p = new Path2D();
  for (let k = 0; k <= 180; k++) {
    const a = (k / 180) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const d = r / Math.pow(Math.abs(c) ** 4 + Math.abs(s) ** 4, 0.25);
    if (k === 0) p.moveTo(px(c * d), px(s * d));
    else p.lineTo(px(c * d), px(s * d));
  }
  p.closePath();
  return p;
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

/**
 * Dry land's wash, brushed thin: streaks along the brush's way where the
 * paper shows through, more and stronger the drier the land. `box` is the
 * area's extent on the paper and `inside` says whether a point of it is the
 * area's own ground; the streaks go down in two strokes of the brush, so a
 * dry area costs two draws however large it is.
 */
function dryBrush(g: CanvasRenderingContext2D, box: readonly [number, number, number, number], dry: number, style: MapStyle, seed: number, inside: (x: number, y: number) => boolean): void {
  const [x0, y0, x1, y1] = box;
  const count = Math.round(((x1 - x0) * (y1 - y0) * style.wilt.streaks * dry) / 4000);
  const strokes = [new Path2D(), new Path2D()];
  for (let k = 0; k < count; k++) {
    const x = x0 + hash(k + seed * 101, 31) * (x1 - x0);
    const y = y0 + hash(31, k + seed * 101) * (y1 - y0);
    if (!inside(x, y)) continue;
    const a = -0.45 + (hash(k, seed + 33) - 0.5) * 0.4;
    const len = 18 + hash(k, seed + 34) * 60;
    const p = strokes[k % 2] as Path2D;
    p.moveTo(x, y);
    p.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
  g.save();
  g.globalCompositeOperation = "destination-out";
  g.lineCap = "round";
  strokes.forEach((p, k) => {
    g.strokeStyle = `rgba(0,0,0,${(0.2 + dry * (k === 0 ? 0.25 : 0.45)).toFixed(3)})`;
    g.lineWidth = k === 0 ? 5.5 : 2.4;
    g.stroke(p);
  });
  g.restore();
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

/** A view of the land: its middle in meters, and pixels per meter. */
export interface LandView {
  readonly x: number;
  readonly z: number;
  readonly zoom: number;
}

/**
 * The land as the sheet shows it in a view `w` by `h` pixels: the painted
 * paper; the contours, area borders and rivers, drawn at the view's size so
 * they look the same at every zoom; the dotted ways; every tree as a round
 * crown in its file's health; and buildings and landmarks as marks worn by
 * theirs. `grow` sizes the trees and ways, which never shrink below legible;
 * the marks grow with the land as the map comes close. Both the field map and
 * the minimap draw the land this way. Returns the boxes the marks take, which
 * names keep off.
 */
export function drawLand(ctx: CanvasRenderingContext2D, w: number, h: number, paper: Paper, stood: StoodWorld, view: LandView, grow: number): [number, number, number, number][] {
  const sx = (x: number): number => (x - view.x) * view.zoom + w / 2;
  const sy = (z: number): number => (z - view.z) * view.zoom + h / 2;
  const visible = (x: number, y: number, pad: number): boolean => x > -pad && x < w + pad && y > -pad && y < h + pad;
  const style = paper.style;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const side = paper.reach * 2 * view.zoom;
  ctx.drawImage(paper.canvas, sx(-paper.reach), sy(-paper.reach), side, side);

  // The linework, in meters under the view's transform, its widths in pixels: contours in sepia, every fifth
  // heavier, and each area's border as a soft hedgerow under a fine line, stopping short of the land's rim.
  ctx.save();
  ctx.translate(w / 2 - view.x * view.zoom, h / 2 - view.z * view.zoom);
  ctx.scale(view.zoom, view.zoom);
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "multiply";
  const c = style.contour;
  ctx.strokeStyle = c.ink;
  for (const contour of paper.contours) {
    ctx.globalAlpha = contour.index ? c.indexAlpha : c.alpha;
    ctx.lineWidth = (contour.index ? LINE.index : LINE.contour) / view.zoom;
    ctx.stroke(contour.path);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
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

  // Rivers: a bank, the water and a glint, along each stream's stations, its width the stream's own once the map is
  // close enough and never thinner than a line.
  ctx.lineCap = ctx.lineJoin = "round";
  for (const stream of stood.terrain.streams) {
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
    const width = 2 * Math.max(...st.map((q) => q.halfWidth)) * view.zoom;
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

  // Trails: dotted, the way a footpath is drawn.
  ctx.setLineDash([0.1, 5.5 * grow]);
  ctx.strokeStyle = style.trail;
  const stride = Math.max(2, Math.round(3 / view.zoom)) * 2;
  for (const trail of stood.ways) {
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
  ctx.setLineDash([]);

  // Trees: round crowns with a soft shadow to the southeast and the sun on their northwest shoulders, colored by
  // their files' health as the land is; each layer is one path, so a thousand trees cost a few fills.
  const shadows = new Path2D();
  const lights = new Path2D();
  const crowns = Array.from({ length: TREE_TONES }, () => new Path2D());
  for (const tree of stood.trees) {
    const x = sx(tree.x);
    const y = sy(tree.z);
    if (!visible(x, y, 8)) continue;
    const seed = hash(tree.x, tree.z);
    const r = Math.max((1.9 + seed * 0.8) * grow, (2 + seed * 1.2) * view.zoom);
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

  // Buildings and landmarks: each kind's own mark, worn as its entity is. A mark keeps a legible size on the whole
  // sheet and grows with the land as the map comes close, as the trees do.
  const s = Math.max(1.1 * grow, MARK_METERS * view.zoom);
  const taken: [number, number, number, number][] = [];
  for (const l of stood.landmarks) {
    const x = sx(l.x);
    const y = sy(l.z);
    if (!visible(x, y, 30 * s)) continue;
    drawLandmark(ctx, x, y, s, l.name, l.vitality);
    taken.push([x - 10 * s, y - 18 * s, x + 10 * s, y + 4 * s]);
  }
  for (const b of stood.buildings) {
    const x = sx(b.x);
    const y = sy(b.z);
    if (!visible(x, y, 30 * s)) continue;
    drawBuilding(ctx, x, y, s, b.kind, b.vitality);
    taken.push([x - 10 * s, y - 18 * s, x + 10 * s, y + 4 * s]);
  }
  return taken;
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
  /** The land's reach the view was last fit to, or null when it was fit before the paper was painted. */
  let fittedTo: number | null = null;
  const person = { x: 0, z: 0, yaw: 0 };
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
      // A map opened before its paper was painted was fit to a guess at the land's size: fit it to the land.
      if (isOpen && fittedTo !== paper.reach) fitView();
      if (isOpen) draw();
      for (const l of painted) l();
      return true;
    }
    return false;
  }
  function startPainting(): void {
    stale = false;
    stopPainting?.();
    paper = null;
    painting = paintPaper(source.stood(), source.placeAt, source.places(), style);
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

  /** Keeps the zoom in range and the paper over the whole view: a sheet smaller than the view sits in its middle. */
  function clampView(): void {
    view.zoom = Math.max(view.fit * 0.9, Math.min(view.fit * 7, view.zoom));
    const r = paper?.reach ?? 604;
    const hx = Math.max(0, r - canvas.clientWidth / (2 * view.zoom));
    const hz = Math.max(0, r - canvas.clientHeight / (2 * view.zoom));
    view.x = Math.max(-hx, Math.min(hx, view.x));
    view.z = Math.max(-hz, Math.min(hz, view.z));
  }

  /**
   * You are here: a small traveller standing on the map, their footprints
   * behind them along the way they look, and the file underfoot lettered
   * beside them. It is its own element, moved by a transform, so walking with
   * the map open never redraws the sheet. Out in the wilds past the sheet it
   * waits at the edge nearest them.
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
    const marks = drawLand(ctx, w, h, paper, stood, view, grow);
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
    const nameSize = w < 520 ? 12.5 : 13.5;
    const spacing = `${(nameSize * 0.17).toFixed(1)}px`;
    const { areaAt } = paper;
    const half = paper.reach - MARGIN;
    const edge = half ** 4;
    for (const l of [...paper.areaLabels].sort((a, b) => b.cells - a.cells)) {
      // The repository's root is the whole sheet, and it is not lettered.
      if (l.area.depth === 0 || !visible(sx(l.x), sy(l.z), 0)) continue;
      const parent = l.above;
      const label = l.area.name.toUpperCase();
      const nameFont = `600 ${nameSize}px ${SERIF}`;
      ctx.font = nameFont;
      ctx.letterSpacing = spacing;
      const nameW = ctx.measureText(label).width;
      ctx.letterSpacing = "0px";
      ctx.font = PARENT_FONT;
      const parentW = parent === "" ? 0 : ctx.measureText(parent).width;
      const halfW = Math.max(nameW, parentW) / 2 + 4;
      const top = parent === "" ? 11 : 21;
      // The box the slanted lettering takes on the sheet.
      const cos = Math.abs(Math.cos(l.angle));
      const sin = Math.abs(Math.sin(l.angle));
      const hw = halfW * cos + ((top + 12) / 2) * sin;
      const hh = halfW * sin + ((top + 12) / 2) * cos;
      const boxAt = (x: number, y: number): [number, number, number, number] => [x - hw, y - hh - (top - 12) / 2, x + hw, y + hh - (top - 12) / 2];
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
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(l.angle);
      if (parent !== "") {
        ctx.font = PARENT_FONT;
        letter(ctx, parent, 0, -12, `rgba(${mixRgb(style.ink, style.ink, 0).join(",")},0.8)`, halo, 2.5);
      }
      ctx.font = nameFont;
      ctx.letterSpacing = spacing;
      letter(ctx, label, 0, 2, style.ink, halo, 4.5);
      ctx.letterSpacing = "0px";
      ctx.restore();
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
    view.fit = Math.min(w, h) / ((paper?.reach ?? 604) * 2);
    // A phone opens close enough to read the names around the person; a wide screen shows it all.
    const close = Math.min(w, h) < 560;
    view.zoom = close ? view.fit * 2.2 : view.fit;
    view.x = close ? person.x : 0;
    view.z = close ? person.z : 0;
    clampView();
  }

  function cancelPick(): void {
    if (pick === null) return;
    window.clearTimeout(pick.timer);
    pick = null;
  }

  /**
   * The transforms that lay the sheet over `from` (the minimap, in the layer's pixels) with its land at the
   * minimap's scale, `scale` pixels a meter, around the person: what the sheet unfolds from and folds back into.
   */
  function overMinimap(from: DOMRect, scale: number): { sheet: string; land: string; origin: string } {
    const left = sheet.offsetLeft;
    const top = sheet.offsetTop;
    const k = from.width / Math.max(1, sheet.offsetWidth);
    const tx = from.left + from.width / 2 - (left + sheet.offsetWidth / 2);
    const ty = from.top + from.height / 2 - (top + sheet.offsetHeight / 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const px = (person.x - view.x) * view.zoom + w / 2;
    const py = (person.z - view.z) * view.zoom + h / 2;
    const zoom = scale / Math.max(1e-6, k * view.zoom);
    return {
      sheet: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k.toFixed(4)})`,
      land: `translate(${(w / 2 - px).toFixed(1)}px, ${(h / 2 - py).toFixed(1)}px) scale(${zoom.toFixed(3)})`,
      origin: `${px.toFixed(1)}px ${py.toFixed(1)}px`,
    };
  }
  /** Where the minimap lies and its scale, asked as the map unfolds; the layer's own pixels. */
  let minimapAt: () => { readonly rect: DOMRect; readonly scale: number } | null = () => null;
  let minimap: { readonly rect: DOMRect; readonly scale: number } | null = null;
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
        const t = overMinimap(from.rect, from.scale);
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
        const t = overMinimap(minimap.rect, minimap.scale);
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
    }),
  };
}
