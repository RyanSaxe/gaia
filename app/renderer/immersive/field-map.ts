// The field map: a hand-drawn map of the world on a torn sheet of handmade
// paper, unfolded from a small map button, painted in one of the directions
// in `map-styles.ts`. The land runs to the sheet's edges and the wild fills
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
import { onTap } from "../lab.ts";
import type { StoodWorld } from "../terrain/lab.ts";
import { DECKLE_MASK, type MapStyle, type MapStyleName, MAP_STYLES, TRAVELLER_SVG, askedMapStyle, groundWash } from "./map-styles.ts";

export interface FieldMap {
  /** The world changed: the paper is painted again while the page is idle. */
  invalidate(): void;
  /** Unfolds or folds the map. */
  open(on: boolean): void;
  readonly isOpen: boolean;
  /** Follows the person; redraws only while the map is open. */
  frame(x: number, z: number, yaw: number, place: Place): void;
  /** Whether the immersive world shows: the map's button shows with it. */
  show(on: boolean): void;
  /** Paints the map in another direction (`map-styles.ts`). */
  restyle(name: MapStyleName): void;
  /** What the map shows, for scripted checks: its direction, whether its paper is painted, zoom in pixels per meter, the paper's painting time and its longest step, and names drawn. */
  state(): {
    readonly open: boolean;
    readonly style: MapStyleName;
    readonly ready: boolean;
    readonly zoom: number;
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

/** Paper size in pixels, and how far past the land's widest reach the sheet runs, meters: the land meets its edges. */
const PAPER = 2048;
export const MARGIN = 4;
/** Sample spacing of the areas, the hills and the water, meters. */
const AREA_CELL = 5;
const HILL_CELL = 5;
const WATER_CELL = 2.5;
/** Where an area's name may step to, in pixels, when its own spot is taken. */
const NUDGES: readonly (readonly [number, number])[] = [[0, 0], [0, 26], [0, -26], [34, 10], [-34, 10], [0, 48], [0, -48], [56, 0], [-56, 0], [40, 36], [-40, 36], [40, -36], [-40, -36]];
/** The paper is painted in steps of a millisecond or two, as many as fit in the page's idle time with this much to spare, ms. */
const SPARE_MS = 2;
const SERIF = `"Iowan Old Style", Georgia, "Times New Roman", serif`;
const INK = "#4a3c2c";

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

interface AreaLabel {
  readonly area: PlaceArea;
  readonly index: number;
  /** Where its name is written: the area's widest ground. */
  readonly x: number;
  readonly z: number;
  readonly cells: number;
  /** The way the area runs, radians from east toward south: its name is lettered along it. */
  readonly angle: number;
}

interface Paper {
  readonly canvas: HTMLCanvasElement;
  readonly reach: number;
  readonly style: MapStyle;
  /** Where to write each area's name: its heart, how much land it holds, and the way it runs. */
  readonly areaLabels: readonly AreaLabel[];
  /** Each top-level directory's whole region: its name, its middle, the way it runs and how far, meters. */
  readonly regionLabels: readonly { readonly name: string; readonly x: number; readonly z: number; readonly angle: number; readonly length: number }[];
  /** Which area's own ground holds a point, by its index in `areaLabels`, or -1: where a nudged name may go. */
  readonly areaAt: (x: number, z: number) => number;
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

/** A closed blob of `count` points round (x, y), its radius varying by up to `wobble`. */
function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, wobble: number, seed: number, count = 14): void {
  g.beginPath();
  for (let k = 0; k <= count; k++) {
    const a = (k / count) * Math.PI * 2;
    const rr = r * (1 - wobble / 2 + wobble * hash(k % count, seed));
    if (k === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

/**
 * Each wet cell's distance from the nearest dry one, in cells: how deep into
 * a pond a point lies, for shading deep water and engraving water lines.
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
 * Washes one area onto a sheet: its outline filled in its hue, with pigment
 * pooling darker toward its rim. Callable area by area, so the land can be
 * painted in as it is shown.
 */
export function washArea(g: CanvasRenderingContext2D, path: Path2D, rgb: readonly [number, number, number], pool: MapStyle["pool"]): void {
  g.fillStyle = `rgb(${rgb.join(",")})`;
  g.fill(path, "evenodd");
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
 * A direction's paper over `w` by `h` pixels: a ground mottled as handmade
 * paper is, with fibres and a faint grain; old paper is foxed and darker at
 * its edges. At the map's paper size it is the map's own paper; the wait
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
  if (style.aged) {
    for (let n = 0; n < 70; n++) {
      const x = hash(n, 41) * w;
      const y = hash(41, n) * h;
      const r = (6 + hash(n, 42) ** 3 * 60) * k;
      const spot = ctx.createRadialGradient(x, y, 0, x, y, r);
      spot.addColorStop(0, "rgba(150,98,44,0.12)");
      spot.addColorStop(0.7, "rgba(150,98,44,0.05)");
      spot.addColorStop(1, "rgba(150,98,44,0)");
      ctx.fillStyle = spot;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const burn = ctx.createRadialGradient(w / 2, h / 2, w * 0.36, w / 2, h / 2, w * 0.74);
    burn.addColorStop(0, "rgba(120,80,30,0)");
    burn.addColorStop(1, "rgba(120,80,30,0.3)");
    ctx.fillStyle = burn;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Where the paint gives way to bare paper at the sheet's edge: rows `j0` to `j1` of a mask `cells` on a side, in its alpha. */
export function paintFade(img: ImageData, style: MapStyle, j0: number, j1: number): void {
  const cells = img.width;
  for (let j = j0; j < j1; j++) for (let i = 0; i < cells; i++) img.data[(j * cells + i) * 4 + 3] = Math.round(255 * paintAt(style, (i + 0.5) / cells, (j + 0.5) / cells));
}

/** A wood's trees past the land's edge, on a sheet `reach` meters from its middle to its edge at `scale` pixels per meter: thinning into clearings and gone where the paint gives way. */
export function woodsOf(style: MapStyle, half: number, reach: number, scale: number): { x: number; y: number; r: number; tone: number }[] {
  const px = (v: number): number => (v + reach) * scale;
  const wild = (x: number, z: number, past = 0): boolean => Math.abs(x) ** 4 + Math.abs(z) ** 4 > (half + past) ** 4;
  const woodStep = style.woodSize * 2.1;
  const woods: { x: number; y: number; r: number; tone: number }[] = [];
  for (let z = -reach; z < reach; z += woodStep) {
    for (let x = -reach; x < reach; x += woodStep) {
      const jx = x + (hash(x, z) - 0.5) * woodStep;
      const jz = z + (hash(z, x) - 0.5) * woodStep;
      if (!wild(jx, jz, 3)) continue;
      const u = (jx + reach) / (reach * 2);
      const v = (jz + reach) / (reach * 2);
      if (valueNoise(u * 14, v * 14, 5) < 0.32 || hash(jx * 1.3, jz) > paintAt(style, u, v)) continue;
      woods.push({ x: px(jx), y: px(jz), r: (style.woodSize + hash(jx, jz * 1.7) * style.woodSize * 0.6) * scale, tone: hash(jz, jx * 2.3) });
    }
  }
  return woods.sort((a, b) => a.y - b.y);
}

/** Draws a wood's trees the direction's way: round crowns over soft shadows, loose dabs, or little inked trees. */
export function drawWoods(ctx: CanvasRenderingContext2D, style: MapStyle, woods: readonly { x: number; y: number; r: number; tone: number }[]): void {
  if (style.trees === "crown") {
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
  } else if (style.trees === "dab") {
    for (const w of woods) {
      blob(ctx, w.x, w.y, w.r * 1.1, 0.35, w.tone * 31);
      ctx.fillStyle = `rgba(${mixRgb("#6f9a5a", "#a7bd78", w.tone).join(",")},0.42)`;
      ctx.fill();
    }
  } else {
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = "rgba(59,44,28,0.62)";
    for (const w of woods) {
      ctx.beginPath();
      ctx.moveTo(w.x, w.y + w.r * 0.6);
      ctx.lineTo(w.x, w.y + w.r * 1.5);
      ctx.moveTo(w.x + w.r, w.y);
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${mixRgb("#8a9a5c", "#a9ab6c", w.tone).join(",")},0.55)`;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w.x + w.r * 0.25, w.y - w.r * 0.5);
      ctx.lineTo(w.x + w.r * 0.25, w.y + w.r * 0.5);
      ctx.moveTo(w.x + w.r * 0.6, w.y - w.r * 0.3);
      ctx.lineTo(w.x + w.r * 0.6, w.y + w.r * 0.4);
      ctx.stroke();
    }
  }
}

/** Paints the land onto paper in a direction's manner, yielding between steps so a driver can spread the work over idle time. */
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
  /** Each top-level directory's whole region, its subdirectories' ground included: where its name is lettered large. */
  const regions = new Map<string, { x: number; z: number; xx: number; zz: number; xz: number; cells: number }>();
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
      if (area.depth > 0) {
        const top = area.path.split("/")[0] ?? "";
        const r = regions.get(top) ?? { x: 0, z: 0, xx: 0, zz: 0, xz: 0, cells: 0 };
        r.x += x;
        r.z += z;
        r.xx += x * x;
        r.zz += z * z;
        r.xz += x * z;
        r.cells += 1;
        regions.set(top, r);
      }
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

  // Washes: each area in the color of its land's ground, a little lighter or darker by its path, painted from the
  // outlines the layout traces (`outlinesOf`), shallowest first so each nested area washes over its parent's,
  // over the wild's own wash.
  const traced = outlinesOf(places);
  yield;
  // The outlines follow the lattice they were traced on in steps of a few meters; a pen draws easier lines.
  const outlines = { areas: traced.areas.map((o) => ({ ...o, rings: o.rings.map(easeRing) })) };
  yield;
  // An area whose ground is unknown stays bare paper.
  const washOf = (path: string): readonly [number, number, number] => {
    const ground = stood.grounds.get(path);
    return ground === undefined ? mixRgb(style.paper, style.paper, 0) : groundWash(style, ground, path);
  };
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
  g.fillStyle = style.wild;
  g.fillRect(0, 0, PAPER, PAPER);
  const byDepth = [...outlines.areas].sort((a, b) => a.depth - b.depth);
  const paths = new Map<string, Path2D>();
  for (const [k, o] of byDepth.entries()) {
    const path = trace(o.rings);
    paths.set(o.path, path);
    washArea(g, path, washOf(o.path), style.pool);
    if (k % 6 === 5) yield;
  }
  // Blooms: where a wash dried unevenly the pigment lifts in a pale patch with a dark, frilled rim.
  for (let k = 0; k < style.blooms; k++) {
    const x = (0.08 + hash(k, 61) * 0.84) * PAPER;
    const y = (0.08 + hash(61, k) * 0.84) * PAPER;
    const r = 26 + hash(k, 62) * 70;
    blob(g, x, y, r, 0.45, k * 3.7, 18);
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.fill();
    g.globalCompositeOperation = "source-atop";
    g.lineWidth = 3;
    g.strokeStyle = "rgba(70,52,30,0.13)";
    g.stroke();
    g.globalCompositeOperation = "source-over";
  }
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
  const slopes = new Float32Array(hn * hn * 2);
  const shadeImg = new ImageData(hn, hn);
  const lightImg = new ImageData(hn, hn);
  const [sr, sg, sb] = mixRgb(style.shadow, style.shadow, 0);
  const [lr, lg, lb] = mixRgb(style.light, style.light, 0);
  for (let j = 0; j < hn; j++) {
    for (let i = 0; i < hn; i++) {
      const x = -reach + (i + 0.5) * HILL_CELL;
      const z = -reach + (j + 0.5) * HILL_CELL;
      const gx = (heightAt(t.lattice, x + e, z) - heightAt(t.lattice, x - e, z)) / (2 * e);
      const gz = (heightAt(t.lattice, x, z + e) - heightAt(t.lattice, x, z - e)) / (2 * e);
      const k = j * hn + i;
      slopes[k * 2] = gx;
      slopes[k * 2 + 1] = gz;
      const lit = (gx + gz) * style.relief;
      const fadeHere = paintAt(style, (i + 0.5) / hn, (j + 0.5) / hn);
      shadeImg.data.set([sr, sg, sb, Math.round(255 * Math.max(0, Math.min(1, -lit)) * fadeHere)], k * 4);
      lightImg.data.set([lr, lg, lb, Math.round(255 * Math.max(0, Math.min(1, lit)) * fadeHere)], k * 4);
    }
    if (j % 14 === 13) yield;
  }
  const hill = document.createElement("canvas");
  hill.width = hill.height = hn;
  const hctx = hill.getContext("2d") as CanvasRenderingContext2D;
  hctx.putImageData(shadeImg, 0, 0);
  ctx.filter = `blur(${style.reliefBlur}px)`;
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = style.shadowAlpha;
  ctx.drawImage(hill, 0, 0, PAPER, PAPER);
  if (style.lightAlpha > 0) {
    hctx.clearRect(0, 0, hn, hn);
    hctx.putImageData(lightImg, 0, 0);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = style.lightAlpha;
    ctx.drawImage(hill, 0, 0, PAPER, PAPER);
  }
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  yield;
  if (style.hills === "hachure") {
    // Hachures: short strokes down the fall line, closer and darker where the ground is steep and away from the light.
    const step = 3.4;
    const hm = Math.ceil((reach * 2) / step);
    const buckets: Path2D[] = [new Path2D(), new Path2D(), new Path2D()];
    for (let j = 0; j < hm; j++) {
      for (let i = 0; i < hm; i++) {
        const x = -reach + (i + 0.5 + (hash(i, j) - 0.5) * 0.7) * step;
        const z = -reach + (j + 0.5 + (hash(j, i) - 0.5) * 0.7) * step;
        const gx = (heightAt(t.lattice, x + 2, z) - heightAt(t.lattice, x - 2, z)) / 4;
        const gz = (heightAt(t.lattice, x, z + 2) - heightAt(t.lattice, x, z - 2)) / 4;
        const slope = Math.hypot(gx, gz);
        if (slope < 0.1 || hash(i * 3.1, j * 1.7) > slope * 5) continue;
        if (paintAt(style, (x + reach) / (reach * 2), (z + reach) / (reach * 2)) < 0.5) continue;
        const len = Math.min(2.8, 0.9 + slope * 7);
        const ux = (gx / slope) * len;
        const uz = (gz / slope) * len;
        const dark = Math.max(0, -(gx + gz) / slope);
        const bucket = buckets[Math.min(2, Math.floor(slope * 6 + dark * 1.2))] as Path2D;
        bucket.moveTo(px(x - ux), px(z - uz));
        bucket.lineTo(px(x + ux), px(z + uz));
      }
      if (j % 24 === 23) yield;
    }
    ctx.lineCap = "round";
    ctx.lineWidth = 1.5;
    for (const [k, bucket] of buckets.entries()) {
      ctx.strokeStyle = `rgba(59,44,28,${0.22 + k * 0.14})`;
      ctx.stroke(bucket);
    }
    yield;
  }

  // Each file's patch: its own traced shape, faintly washed in its health's color, inside a fine line in some directions.
  const health = new Map(places.patches.map((p) => [p.path, p.vitality]));
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = `rgba(74,60,44,${style.patchLine})`;
  for (const [k, o] of traced.patches.entries()) {
    const path = trace(o.rings.map(easeRing));
    ctx.fillStyle = `rgba(${mixRgb("#a8956a", "#6f9450", Math.max(0, Math.min(1, health.get(o.path) ?? 1))).join(",")},${style.patchFill})`;
    ctx.fill(path, "evenodd");
    if (style.patchLine > 0) ctx.stroke(path);
    if (k % 60 === 59) yield;
  }
  yield;

  // Water: the ponds sampled on a fine grid; streams too narrow for the samples follow their stations.
  const wn = Math.ceil((size + 40) / WATER_CELL);
  const w0 = -(size + 40) / 2;
  const wet = new Uint8Array(wn * wn);
  for (let j = 0; j < wn; j++) {
    for (let i = 0; i < wn; i++) wet[j * wn + i] = waterDepthAt(t, w0 + (i + 0.5) * WATER_CELL, w0 + (j + 0.5) * WATER_CELL) > 0.04 ? 1 : 0;
    if (j % 20 === 19) yield;
  }
  const depth = wetDistance(wet, wn);
  yield;
  const shallowRgb = style.water === "deep" ? [150, 203, 204] : style.water === "engraved" ? [178, 199, 190] : [138, 184, 202];
  const deepRgb = style.water === "deep" ? [58, 122, 152] : style.water === "engraved" ? [150, 178, 176] : [104, 152, 184];
  ctx.lineCap = ctx.lineJoin = "round";
  for (const stream of t.streams) {
    const width = 2 * Math.max(...stream.stations.map((s) => s.halfWidth)) * scale;
    const line = new Path2D();
    stream.stations.forEach((s, k) => (k === 0 ? line.moveTo(px(s.x), px(s.z)) : line.lineTo(px(s.x), px(s.z))));
    if (style.water === "engraved") {
      ctx.strokeStyle = "rgba(59,44,28,0.8)";
      ctx.lineWidth = Math.max(6, width + 4);
      ctx.stroke(line);
    } else if (style.water === "wash") {
      ctx.filter = "blur(2px)";
      ctx.strokeStyle = "rgba(92,136,170,0.45)";
      ctx.lineWidth = Math.max(7, width + 5);
      ctx.stroke(line);
      ctx.filter = "none";
    } else {
      ctx.strokeStyle = "rgba(40,84,104,0.55)";
      ctx.lineWidth = Math.max(6.5, width + 3.5);
      ctx.stroke(line);
    }
    ctx.strokeStyle = `rgb(${shallowRgb.join(",")})`;
    ctx.lineWidth = Math.max(3.5, width);
    ctx.stroke(line);
  }
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
  if (style.water === "wash") {
    // A wash of blue, bleeding a little past its edge.
    ctx.filter = "blur(5px)";
    ctx.globalAlpha = 0.55;
    ctx.drawImage(water, wx0, wx0, wspan, wspan);
    ctx.filter = "none";
    ctx.globalAlpha = 0.6;
  }
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
  if (style.water === "engraved") {
    // The coast inked, and water lines engraved inside it, each a little farther out and fainter.
    ctx.strokeStyle = "rgba(59,44,28,0.85)";
    ctx.lineWidth = 2.6;
    ctx.stroke(coast);
    for (const [level, alpha] of [[1.3, 0.42], [2.5, 0.3], [4, 0.2]] as const) {
      ctx.strokeStyle = `rgba(59,44,28,${alpha})`;
      ctx.lineWidth = 1.2;
      ctx.stroke(shore(level));
      yield;
    }
  } else if (style.water === "wash") {
    // Pigment pools darker where the wash dried at its edge.
    ctx.filter = "blur(1.5px)";
    ctx.strokeStyle = "rgba(64,104,140,0.4)";
    ctx.lineWidth = 3.2;
    ctx.stroke(coast);
    ctx.filter = "none";
  } else {
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
  }
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

  // Area borders: in pencil, in ink, or as a soft painted hedgerow; each is drawn from both sides, so a light hand keeps the two one line.
  // They stop short of the land's edge, where the land gives way to the wild by its colors alone.
  ctx.save();
  const inside = new Path2D();
  for (let k = 0; k <= 180; k++) {
    const a = (k / 180) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r = (half - 3) / Math.pow(Math.abs(c) ** 4 + Math.abs(s) ** 4, 0.25);
    if (k === 0) inside.moveTo(px(c * r), px(s * r));
    else inside.lineTo(px(c * r), px(s * r));
  }
  ctx.clip(inside);
  ctx.lineJoin = "round";
  for (const [k, o] of outlines.areas.entries()) {
    if (o.depth === 0) continue;
    if (style.border === "pencil") {
      ctx.strokeStyle = "rgba(72,66,60,0.32)";
      ctx.lineWidth = 1.5;
      ctx.stroke(trace(o.rings, 2.6, 1));
      ctx.stroke(trace(o.rings, 3.2, 7));
    } else if (style.border === "ink") {
      ctx.strokeStyle = "rgba(59,44,28,0.62)";
      ctx.lineWidth = o.depth === 1 ? 3 : 1.6;
      ctx.stroke(trace(o.rings, 2.2, 1));
    } else {
      const path = trace(o.rings, 1.6, 1);
      ctx.filter = "blur(1.5px)";
      ctx.strokeStyle = "rgba(52,80,40,0.26)";
      ctx.lineWidth = o.depth === 1 ? 7 : 5;
      ctx.stroke(path);
      ctx.filter = "none";
      ctx.strokeStyle = "rgba(46,70,36,0.3)";
      ctx.lineWidth = 1.6;
      ctx.stroke(path);
    }
    if (k % 8 === 7) yield;
  }
  ctx.restore();
  yield;

  // The wild past the land: a wood drawn the direction's way, thinning into clearings and gone where the paint gives way.
  const woods = woodsOf(style, half, reach, scale);
  yield;
  drawWoods(ctx, style, woods);
  yield;

  // The map's title, lettered in the wild at the sheet's top left: "a field map of" and the repository's name.
  const name = places.name.trim().toLowerCase() === "gaia" ? "its own code" : places.name;
  const title = Math.round(PAPER / 36);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = style.paper;
  ctx.shadowBlur = 14;
  ctx.fillStyle = style.ink;
  ctx.globalAlpha = 0.8;
  ctx.font = `600 ${Math.round(title * 0.42)}px ${SERIF}`;
  ctx.letterSpacing = `${(title * 0.15).toFixed(1)}px`;
  for (let pass = 0; pass < 2; pass++) ctx.fillText("A FIELD MAP OF", PAPER * 0.032, PAPER * 0.045);
  ctx.letterSpacing = "0px";
  ctx.globalAlpha = 0.95;
  ctx.font = `italic 600 ${title}px ${SERIF}`;
  for (let pass = 0; pass < 2; pass++) ctx.fillText(name, PAPER * 0.032, PAPER * 0.045 + title * 1.05);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  yield;

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
    return { area, index: k, x, z, cells: s.cells, angle: axisOf(s).angle };
  });
  const areaAt = (x: number, z: number): number => {
    const i = Math.floor((x + reach) / AREA_CELL);
    const j = Math.floor((z + reach) / AREA_CELL);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : (at[j * n + i] as number);
  };
  const regionLabels = [...regions]
    .filter(([, r]) => r.cells >= 40)
    .map(([top, r]) => ({ name: top.toUpperCase(), x: r.x / r.cells, z: r.z / r.cells, ...axisOf(r) }));
  return { canvas, reach, style, areaLabels, regionLabels, areaAt };
}

/** A soft shadow on the paper under a drawn thing, a little to the southeast. */
function groundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.ellipse(x + w * 0.18, y, w, h, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(74,60,44,0.16)";
  ctx.fill();
}

/** Washes a closed path in a color and inks its edge. */
function washAndInk(ctx: CanvasRenderingContext2D, fill: string, width = 1.1): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/**
 * A building drawn as a little vignette, the way a hand-drawn map shows a
 * village: walls washed pale, a roof in the building's own material, a door
 * and a window, and a chimney's curl of smoke. A mill has its wheel, a
 * tower stands tall under a pointed roof.
 */
function drawBuilding(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, kind: string): void {
  const k = kind.toLowerCase();
  if (k.includes("tower")) {
    groundShadow(ctx, x, y + 5 * s, 6.5 * s, 2.2 * s);
    ctx.beginPath();
    ctx.rect(x - 3.6 * s, y - 10 * s, 7.2 * s, 15 * s);
    washAndInk(ctx, "#ece2cb");
    ctx.beginPath();
    ctx.moveTo(x - 5 * s, y - 10 * s);
    ctx.lineTo(x, y - 17.5 * s);
    ctx.lineTo(x + 5 * s, y - 10 * s);
    ctx.closePath();
    washAndInk(ctx, "#6f7f8e");
    ctx.fillStyle = INK;
    ctx.fillRect(x - 0.8 * s, y - 7.5 * s, 1.6 * s, 2.4 * s);
    ctx.fillRect(x - 0.8 * s, y - 3 * s, 1.6 * s, 2.4 * s);
    ctx.fillStyle = "#9a5a3c";
    ctx.fillRect(x - 1.4 * s, y + 1.2 * s, 2.8 * s, 3.8 * s);
    return;
  }
  const roof = k.includes("thatch") ? "#c9a25a" : k.includes("croft") ? "#7d8790" : k.includes("storybook") ? "#b55d3f" : "#a96a45";
  const wall = k.includes("croft") ? "#d9d2c2" : "#f1e6cc";
  const steep = k.includes("storybook") ? 1.35 : k.includes("croft") ? 0.75 : 1;
  groundShadow(ctx, x, y + 5 * s, 8 * s, 2.4 * s);
  if (k.includes("mill")) {
    // The wheel stands at the gable end, half in its race.
    ctx.beginPath();
    ctx.arc(x + 7.2 * s, y + 1.4 * s, 4 * s, 0, Math.PI * 2);
    washAndInk(ctx, "#b48a5a", 1);
    ctx.beginPath();
    for (let a = 0; a < 6; a++) {
      const t = (a / 6) * Math.PI;
      ctx.moveTo(x + 7.2 * s + Math.cos(t) * 4 * s, y + 1.4 * s + Math.sin(t) * 4 * s);
      ctx.lineTo(x + 7.2 * s - Math.cos(t) * 4 * s, y + 1.4 * s - Math.sin(t) * 4 * s);
    }
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  // Walls.
  ctx.beginPath();
  ctx.rect(x - 5.6 * s, y - 1.5 * s, 11.2 * s, 6.5 * s);
  washAndInk(ctx, wall);
  // A chimney, then the roof over it, then its smoke.
  ctx.beginPath();
  ctx.rect(x + 2 * s, y - 8.5 * s, 2 * s, 4 * s);
  washAndInk(ctx, "#a98a6a", 0.9);
  ctx.beginPath();
  ctx.moveTo(x - 7 * s, y - 1 * s);
  ctx.lineTo(x - 3 * s, y - 1.5 * s - 5.5 * s * steep);
  ctx.lineTo(x + 3 * s, y - 1.5 * s - 5.5 * s * steep);
  ctx.lineTo(x + 7 * s, y - 1 * s);
  ctx.closePath();
  washAndInk(ctx, roof);
  // Thatch and slate show their courses as fine strokes.
  ctx.beginPath();
  for (let r = 1; r <= 2; r++) {
    const yy = y - 1.2 * s - r * 1.8 * s * steep;
    const inset = (r * 1.8 * steep * 4) / (5.5 * steep);
    ctx.moveTo(x - 7 * s + inset * s, yy);
    ctx.lineTo(x + 7 * s - inset * s, yy);
  }
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = "rgba(74,60,44,0.55)";
  ctx.stroke();
  ctx.fillStyle = "#8c4f34";
  ctx.fillRect(x - 1.3 * s, y + 1 * s, 2.6 * s, 4 * s);
  ctx.fillStyle = "rgba(74,60,44,0.8)";
  ctx.fillRect(x - 4.3 * s, y + 0.6 * s, 1.8 * s, 1.8 * s);
  ctx.fillRect(x + 2.6 * s, y + 0.6 * s, 1.8 * s, 1.8 * s);
  ctx.beginPath();
  ctx.moveTo(x + 3 * s, y - 9 * s);
  ctx.bezierCurveTo(x + 1.5 * s, y - 11 * s, x + 5 * s, y - 12 * s, x + 3.6 * s, y - 14 * s);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = "rgba(74,60,44,0.45)";
  ctx.stroke();
}

/** A landmark as a vignette: a great tree's crown, a ring of standing stones, or a tower. */
function drawLandmark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, name: string): void {
  const k = name.toLowerCase();
  if (k.includes("ring")) {
    groundShadow(ctx, x, y + 1 * s, 10 * s, 5 * s);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const sx = x + Math.cos(a) * 7.5 * s;
      const sy = y + Math.sin(a) * 4.2 * s;
      ctx.beginPath();
      ctx.roundRect(sx - 1.3 * s, sy - 4.4 * s, 2.6 * s, 4.8 * s, [1.2 * s, 1.2 * s, 0.3 * s, 0.3 * s]);
      washAndInk(ctx, i % 3 === 0 ? "#c9c3b2" : "#d8d2c1", 0.9);
    }
    return;
  }
  if (k.includes("willow")) {
    groundShadow(ctx, x, y + 9 * s, 9 * s, 3 * s);
    ctx.beginPath();
    ctx.moveTo(x, y + 9 * s);
    ctx.lineTo(x, y - 2 * s);
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = "#6e5236";
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y - 4 * s, 9 * s, 6.5 * s, 0, Math.PI, 0);
    for (let i = 0; i <= 8; i++) {
      const fx = x + 9 * s - (i / 8) * 18 * s;
      ctx.lineTo(fx + (i % 2) * 0.8 * s, y + 4 * s + (i % 2 === 0 ? 1.5 : 0) * s);
    }
    ctx.closePath();
    washAndInk(ctx, "#93ad6b");
    ctx.beginPath();
    for (let i = 1; i < 8; i++) {
      const fx = x - 8 * s + i * 2.2 * s;
      ctx.moveTo(fx, y - 5 * s + Math.abs(i - 4) * 0.8 * s);
      ctx.quadraticCurveTo(fx + 0.6 * s, y, fx, y + 3.6 * s);
    }
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = "rgba(60,74,40,0.6)";
    ctx.stroke();
    return;
  }
  if (k.includes("oak") || k.includes("tree")) {
    groundShadow(ctx, x, y + 9 * s, 9 * s, 3 * s);
    ctx.beginPath();
    ctx.moveTo(x - 1.2 * s, y + 9 * s);
    ctx.lineTo(x - 0.8 * s, y + 1 * s);
    ctx.lineTo(x + 0.8 * s, y + 1 * s);
    ctx.lineTo(x + 1.2 * s, y + 9 * s);
    ctx.closePath();
    washAndInk(ctx, "#7a5a3c", 0.9);
    ctx.beginPath();
    for (const [dx, dy, r] of [[-5, -2, 4.6], [5, -2, 4.6], [0, -6, 5.4], [-2.6, 1.4, 4], [3, 1.6, 4]] as const) {
      ctx.moveTo(x + (dx + r) * s, y + dy * s);
      ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    }
    washAndInk(ctx, "#7fa159");
    ctx.beginPath();
    ctx.arc(x - 1.6 * s, y - 6.4 * s, 2.4 * s, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(214,232,160,0.55)";
    ctx.fill();
    return;
  }
  drawBuilding(ctx, x, y, s, "tower");
}

const MAP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.2 9 4l6 2.2 5.5-2.2v13.8L15 20l-6-2.2-5.5 2.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 4v13.8M15 6.2V20" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

/** How long a tap on the map waits for a second press (a double tap zooms instead), ms. */
const PICK_WAIT_MS = 240;
/** The compass rose's middle, from the sheet's lower right corner, and how far round it a tap finds you, pixels. */
const ROSE = { right: 46, bottom: 62, reach: 30 };

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

/** A tree on the land, drawn the direction's way: browning with its file's vitality. */
function drawTree(ctx: CanvasRenderingContext2D, style: MapStyle, x: number, y: number, r: number, vitality: number, seed: number): void {
  const v = Math.max(0, Math.min(1, vitality));
  if (style.trees === "crown") {
    // A round crown with a soft shadow to the southeast and the sun on its northwest shoulder.
    ctx.beginPath();
    ctx.ellipse(x + r * 0.5, y + r * 0.6, r * 1.05, r * 0.78, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(34,44,48,0.22)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = mixHex("#ad9a6c", "#5f9447", v);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.32, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(226,240,170,0.45)";
    ctx.fill();
  } else if (style.trees === "dab") {
    // A loose dab of watercolor, darker where its pigment pooled.
    blob(ctx, x, y, r * 1.15, 0.4, seed);
    ctx.fillStyle = `rgba(${mixRgb("#b5a47c", "#6f9a50", v).join(",")},0.62)`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.35, y + r * 0.3, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(60,80,40,0.16)";
    ctx.fill();
  } else {
    // A small inked tree: a crown on a trunk, hatched on its shaded side.
    ctx.strokeStyle = "rgba(59,44,28,0.8)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.5);
    ctx.lineTo(x, y + r * 1.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = mixHex("#bba878", "#8ea062", v);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + r * 0.3, y - r * 0.55);
    ctx.lineTo(x + r * 0.3, y + r * 0.55);
    ctx.moveTo(x + r * 0.65, y - r * 0.3);
    ctx.lineTo(x + r * 0.65, y + r * 0.35);
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
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
  const button = document.createElement("button");
  button.type = "button";
  button.className = "way-button map-button";
  button.setAttribute("aria-label", "Unfold the map");
  button.title = "Map (M)";
  button.innerHTML = MAP_ICON;
  const sheet = document.createElement("div");
  sheet.className = "field-map";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Field map");
  sheet.style.setProperty("--deckle", DECKLE_MASK);
  sheet.innerHTML = /* html */ `
    <canvas class="field-map-view"></canvas>
    <div class="field-map-here">${TRAVELLER_SVG}<span class="here-file"></span></div>
    <button type="button" class="map-fold" aria-label="Fold the map" title="Fold (Esc)"></button>`;
  root.append(button, sheet);
  const canvas = sheet.querySelector("canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const here = sheet.querySelector(".field-map-here") as HTMLElement;
  const hereFile = sheet.querySelector(".here-file") as HTMLElement;
  const steps = sheet.querySelector(".traveller-steps") as SVGGElement;

  let style = askedMapStyle();
  let paper: Paper | null = null;
  /** Whether the world changed since the paper was painted. */
  let stale = true;
  let painting: Generator<void, Paper> | null = null;
  let stopPainting: (() => void) | null = null;
  const timing = { paintMs: 0, longestStepMs: 0, drawMs: 0 };
  let isOpen = false;
  let shown = false;
  const view = { x: 0, z: 0, zoom: 1, fit: 1 };
  const person = { x: 0, z: 0, yaw: 0 };
  let labelCount = 0;
  /** Each area name drawn, its box on the sheet and its area's heart: a tap on a name goes to its heart. */
  let names: { box: [number, number, number, number]; x: number; z: number }[] = [];
  /** The spot a tap marked, waiting to be sent, and its timer. */
  let pick: { x: number; z: number; timer: number } | null = null;
  /** Whether the press under way is a double tap's second. */
  let doubled = false;

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
      if (isOpen) draw();
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
    if (paper === null) {
      ctx.fillStyle = "rgba(74,60,44,0.6)";
      ctx.font = `italic 15px ${SERIF}`;
      ctx.textAlign = "center";
      ctx.fillText("Inking the map…", w / 2, h / 2);
      return;
    }
    const stood = source.stood();
    const sx = (x: number): number => (x - view.x) * view.zoom + w / 2;
    const sy = (z: number): number => (z - view.z) * view.zoom + h / 2;
    const visible = (x: number, y: number, pad: number): boolean => x > -pad && x < w + pad && y > -pad && y < h + pad;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(paper.canvas, sx(-paper.reach), sy(-paper.reach), paper.reach * 2 * view.zoom, paper.reach * 2 * view.zoom);
    // Marks and names grow a little as the map comes closer, and never shrink below legible.
    const grow = Math.min(1.6, Math.max(1, Math.sqrt(view.zoom / Math.max(view.fit, 1e-6)) * 0.85));

    // Trails: dotted, the way a footpath is drawn.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([0.1, 5.5 * grow]);
    ctx.strokeStyle = style.trail;
    for (const trail of stood.ways) {
      const p = trail.points;
      ctx.beginPath();
      const stride = Math.max(2, Math.round(3 / view.zoom)) * 2;
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

    // Trees: drawn the direction's way, browning with their files' vitality.
    for (const tree of stood.trees) {
      const x = sx(tree.x);
      const y = sy(tree.z);
      if (!visible(x, y, 8)) continue;
      const seed = hash(tree.x, tree.z);
      drawTree(ctx, style, x, y, Math.max((1.9 + seed * 0.8) * grow, (2 + seed * 1.2) * view.zoom), tree.vitality, seed * 97);
    }

    // Names keep off the drawn marks and each other, and off the scale and the compass rose in the lower corners.
    const taken: [number, number, number, number][] = [[w - 48, 0, w, 48], [0, h - 44, 120, h], [w - ROSE.right - 34, h - ROSE.bottom - 46, w, h]];
    // The title is lettered on the paper's top left corner.
    const titleX = sx(-paper.reach) + paper.reach * 2 * view.zoom * 0.03;
    const titleY = sy(-paper.reach) + paper.reach * 2 * view.zoom * 0.02;
    taken.push([titleX - 6, titleY - 6, titleX + paper.reach * 2 * view.zoom * 0.2, titleY + paper.reach * 2 * view.zoom * 0.045]);
    // The traveller and the file lettered beside them.
    const hx = sx(person.x);
    const hy = sy(person.z);
    taken.push([hx - 12, hy - 30, hx + 18 + hereFile.offsetWidth, hy + 8]);
    const free = (x0: number, y0: number, x1: number, y1: number): boolean => taken.every(([a, b, c, d]) => x1 < a || x0 > c || y1 < b || y0 > d);
    for (const m of [...stood.buildings, ...stood.landmarks]) {
      const x = sx(m.x);
      const y = sy(m.z);
      taken.push([x - 9 * grow, y - 16 * grow, x + 9 * grow, y + 10 * grow]);
    }

    // Buildings and landmarks: little drawn vignettes, as on a hand-drawn map.
    ctx.lineJoin = "round";
    for (const l of stood.landmarks) drawLandmark(ctx, sx(l.x), sy(l.z), 1.05 * grow, l.name);
    for (const b of stood.buildings) drawBuilding(ctx, sx(b.x), sy(b.z), 1.1 * grow, b.kind);

    // Each top-level directory's name lettered large and faint across its whole region in spaced capitals, as a
    // map names a province under its towns; it fades as the map comes close, where the region fills the view.
    const near = view.zoom / Math.max(view.fit, 1e-6);
    const faint = style.regionAlpha * Math.max(0, Math.min(1, (2.6 - near) / 1.2));
    if (faint > 0.01) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = style.ink;
      ctx.globalAlpha = faint;
      for (const r of paper.regionLabels) {
        const fontPx = Math.min(64, (r.length * view.zoom * 0.62) / (r.name.length * 1.25));
        if (fontPx < 16) continue;
        ctx.save();
        ctx.translate(sx(r.x), sy(r.z));
        ctx.rotate(r.angle);
        ctx.font = `600 ${fontPx.toFixed(0)}px ${SERIF}`;
        ctx.letterSpacing = `${(fontPx * 0.55).toFixed(0)}px`;
        ctx.fillText(r.name, fontPx * 0.27, 0);
        ctx.restore();
      }
      ctx.letterSpacing = "0px";
      ctx.globalAlpha = 1;
    }

    // Names are lettered on the land itself in ink, along the way each area runs, softened at their edges by
    // the paper showing through; they stay one size at any zoom, and where two would collide the larger area's wins.
    labelCount = 0;
    names = [];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const nameSize = w < 520 ? 15 : 17;
    const { areaAt } = paper;
    const half = paper.reach - MARGIN;
    for (const l of [...paper.areaLabels].sort((a, b) => b.cells - a.cells)) {
      // The repository's root is the whole sheet: the title names it.
      if (l.area.depth === 0 || !visible(sx(l.x), sy(l.z), 0)) continue;
      const capitals = style.capitals && l.area.depth === 1;
      const parent = l.area.path.split("/").slice(0, -1).join(" / ").toUpperCase();
      const label = capitals ? l.area.name.toUpperCase() : l.area.name;
      const nameFont = capitals ? `600 ${nameSize - 1}px ${SERIF}` : `italic 600 ${nameSize}px ${SERIF}`;
      const nameSpacing = capitals ? nameSize * 0.32 : 0;
      ctx.font = nameFont;
      ctx.letterSpacing = `${nameSpacing}px`;
      const nameW = ctx.measureText(label).width;
      ctx.letterSpacing = "0px";
      ctx.font = `600 9px ${SERIF}`;
      const parentW = parent === "" ? 0 : ctx.measureText(parent).width + parent.length * 1.8;
      const halfW = Math.max(nameW, parentW) / 2 + 4;
      const top = parent === "" ? 11 : 21;
      // The box the slanted lettering takes on the sheet.
      const cos = Math.abs(Math.cos(l.angle));
      const sin = Math.abs(Math.sin(l.angle));
      const hw = halfW * cos + ((top + 12) / 2) * sin;
      const hh = halfW * sin + ((top + 12) / 2) * cos;
      const boxAt = (x: number, y: number): [number, number, number, number] => [x - hw, y - hh - (top - 12) / 2, x + hw, y + hh - (top - 12) / 2];
      // A name sits wholly on the sheet and on the land or not at all, its middle on its own area's ground.
      const wx = (x: number): number => view.x + (x - w / 2) / view.zoom;
      const wz = (y: number): number => view.z + (y - h / 2) / view.zoom;
      const edge = half ** 4;
      const onLand = ([x0, y0, x1, y1]: [number, number, number, number]): boolean =>
        areaAt(wx((x0 + x1) / 2), wz((y0 + y1) / 2)) === l.index && [x0, x1].every((x) => [y0, y1].every((y) => wx(x) ** 4 + wz(y) ** 4 < edge));
      const fits = (box: [number, number, number, number]): boolean => box[0] > 4 && box[1] > 4 && box[2] < w - 4 && box[3] < h - 4 && free(...box) && onLand(box);
      const spot = NUDGES.map(([dx, dy]) => [sx(l.x) + dx, sy(l.z) + dy] as const).find(([cx, cy]) => fits(boxAt(cx, cy)));
      if (spot === undefined) continue;
      const [x, y] = spot;
      taken.push(boxAt(x, y));
      names.push({ box: boxAt(x, y), x: l.x, z: l.z });
      labelCount++;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(l.angle);
      ctx.shadowColor = style.paper;
      ctx.shadowBlur = 5;
      for (let pass = 0; pass < 2; pass++) {
        if (parent !== "") {
          ctx.font = `600 9px ${SERIF}`;
          ctx.letterSpacing = "1.8px";
          ctx.fillStyle = `rgba(${mixRgb(style.ink, style.ink, 0).join(",")},0.74)`;
          ctx.fillText(parent, 0, -12);
          ctx.letterSpacing = "0px";
        }
        ctx.font = nameFont;
        ctx.letterSpacing = `${nameSpacing}px`;
        ctx.fillStyle = style.ink;
        ctx.fillText(label, nameSpacing / 2, 2);
        ctx.letterSpacing = "0px";
      }
      ctx.restore();
    }
    // Buildings and landmarks name themselves once the map is close enough to read them.
    if (view.zoom > view.fit * 1.6) {
      ctx.font = `italic 12px ${SERIF}`;
      ctx.shadowColor = style.paper;
      ctx.shadowBlur = 4;
      const marks = [...stood.landmarks.map((l) => ({ ...l, below: 15 })), ...stood.buildings.map((b) => ({ ...b, below: 13 }))];
      for (const m of marks) {
        const x = sx(m.x);
        const y = sy(m.z) + m.below * grow + 6;
        const halfW = ctx.measureText(m.name).width / 2 + 3;
        const box: [number, number, number, number] = [x - halfW, y - 8, x + halfW, y + 8];
        if (!visible(x, y, 0) || !free(...box)) continue;
        taken.push(box);
        ctx.fillStyle = style.ink;
        ctx.fillText(m.name, x, y);
        ctx.fillText(m.name, x, y);
      }
      ctx.shadowBlur = 0;
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

    // A compass rose and a scale, inked in the lower corners: a ring, four long points half-shaded from the
    // light, four short ones between, and north named above. A tap on the rose finds you on the map.
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
    const meters = [50, 100, 200, 500].find((m) => m * view.zoom > 60) ?? 500;
    const bar = meters * view.zoom;
    ctx.strokeStyle = style.ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(22, h - 26);
    ctx.lineTo(22, h - 22);
    ctx.lineTo(22 + bar, h - 22);
    ctx.lineTo(22 + bar, h - 26);
    ctx.stroke();
    ctx.font = `italic 11px ${SERIF}`;
    ctx.textAlign = "left";
    ctx.shadowColor = style.paper;
    ctx.shadowBlur = 4;
    ctx.fillText(`${meters} m`, 22, h - 32);
    ctx.shadowBlur = 0;
    timing.drawMs = performance.now() - t0;
  }

  function fitView(): void {
    const { w, h } = size();
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

  function setOpen(on: boolean): void {
    if (on === isOpen) return;
    isOpen = on;
    cancelPick();
    sheet.classList.toggle("open", on);
    button.setAttribute("aria-expanded", String(on));
    onToggle?.(on);
    if (on) {
      fitView();
      draw();
    }
  }

  button.addEventListener("click", () => setOpen(!isOpen));
  // The sheet's turned-down corner folds it.
  (sheet.querySelector(".map-fold") as HTMLElement).addEventListener("click", () => setOpen(false));
  /** Brings the map round to where the person stands, close enough to read. */
  function findHere(): void {
    view.x = person.x;
    view.z = person.z;
    view.zoom = Math.max(view.zoom, view.fit * 2.2);
    clampView();
    draw();
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
      zoomAbout(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      draw();
    },
    { passive: false },
  );
  // A tap on the compass rose finds you; on an area's name, goes to the area's heart; anywhere else, to that spot.
  onTap(canvas, (e) => {
    if (paper === null || doubled) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (Math.hypot(px - (rect.width - ROSE.right), py - (rect.height - ROSE.bottom)) < ROSE.reach) {
      findHere();
      return;
    }
    if (onPick === undefined) return;
    const name = names.find(({ box: [x0, y0, x1, y1] }) => px >= x0 && px <= x1 && py >= y0 && py <= y1);
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
    get isOpen() {
      return isOpen;
    },
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
      button.classList.toggle("on", on);
      if (!on) setOpen(false);
    },
    restyle(name) {
      if (name === style.name) return;
      style = MAP_STYLES[name];
      if (shown) startPainting();
      else stale = true;
      if (isOpen) draw();
    },
    state: () => ({
      open: isOpen,
      style: style.name,
      ready: paper !== null,
      zoom: view.zoom,
      paintMs: Math.round(timing.paintMs),
      longestStepMs: +timing.longestStepMs.toFixed(1),
      drawMs: +timing.drawMs.toFixed(1),
      labels: labelCount,
    }),
  };
}
