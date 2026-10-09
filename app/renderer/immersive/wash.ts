// The field sheet's watercolor washes, laid one way wherever a sheet paints
// health (docs/design-system.md, "The field sheet"): the field map lays the
// whole land at once (`field-map.ts`), and the wait lays each part of it as
// its health settles (`wait/`). A wash is laid on a sheet `PAPER` pixels a
// side from one sample a cell of the land, each in its color with as much
// paint as it has: pigment pools at each area's rim, dry land lets the paper
// through in streaks, broad strokes and granulation give it brushwork, and
// the paint gives way raggedly to bare paper at the sheet's edge. Floated
// onto the paper, a softened copy laid first lets neighbors bleed into each
// other.

import type { MapStyle } from "./map-styles.ts";

/** The sheet's side in pixels, which every width and count here is given at. */
export const PAPER = 2048;

/** A box on the sheet: left, top, right and bottom. */
export type Box = readonly [number, number, number, number];

/** What a wash is laid over: the land's cells and areas, as one sheet paints them. */
export interface WashSheet {
  /** How far the sheet reaches from the land's middle, meters, and the land's own half-width, inside which pigment pools. */
  readonly reach: number;
  readonly half: number;
  /** Cells a side, each `cell` meters, from the sheet's corner, and the area nearest each, by its index in `areas`. */
  readonly n: number;
  readonly cell: number;
  readonly nearest: Int16Array;
  readonly areas: readonly WashArea[];
  /** Where the paint gives way to bare paper at the sheet's edge, in its alpha, drawn over the whole sheet (`fadeMask`). */
  readonly fade: HTMLCanvasElement;
}

/**
 * An area as its wash dries: its outline on the sheet and its depth (the shallower pool first), the color its
 * pigment pools in at its rim (none while its health is unknown) and how dry its own ground is, 0 to 1.
 */
export interface WashArea {
  readonly path: Path2D;
  readonly depth: number;
  readonly pool: readonly [number, number, number] | null;
  readonly dry: number;
}

const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** How many points either side a traced outline's point is averaged with, and how many times, to ease its lattice steps into a line. */
const EASE = { reach: 5, passes: 2 };

/** A closed ring of x, z pairs with each point averaged with its neighbors along the ring. */
export function easeRing(ring: readonly number[]): number[] {
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

/**
 * Rings of x, z pairs in meters as one path through `px` (meters to the
 * sheet's pixels): a curve through the middles of each ring's edges, bending
 * at its corners, so a traced lattice's steps read as a pen's easy line.
 */
export function ringsPath(rings: readonly (readonly number[])[], px: (v: number) => number): Path2D {
  const p = new Path2D();
  for (const ring of rings) {
    const count = ring.length / 2;
    if (count < 3) continue;
    const point = (k: number): [number, number] => {
      const i = ((k % count) + count) % count;
      return [px(ring[i * 2] as number), px(ring[i * 2 + 1] as number)];
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

const noises = new Map<string, HTMLCanvasElement>();
/** A small canvas of soft blotches in one color, to be drawn large: smoothing turns its pixels into gentle mottling. */
export function noiseCanvas(cells: number, seed: number, rgb: readonly [number, number, number]): HTMLCanvasElement {
  const key = `${cells}|${seed}|${rgb.join(",")}`;
  const kept = noises.get(key);
  if (kept !== undefined) return kept;
  const c = document.createElement("canvas");
  c.width = c.height = cells;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const img = g.createImageData(cells, cells);
  for (let k = 0; k < cells * cells; k++) img.data.set([rgb[0], rgb[1], rgb[2], Math.round(255 * hash(k + seed, seed))], k * 4);
  g.putImageData(img, 0, 0);
  noises.set(key, c);
  return c;
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
export function paintAt(style: MapStyle, u: number, v: number): number {
  const edge = Math.min(u, 1 - u, v, 1 - v);
  const rag = (valueNoise(u * 22, v * 22, 3) - 0.5) * 2 * style.ragged + (valueNoise(u * 96, v * 96, 11) - 0.5) * style.ragged * 0.7;
  const t = Math.max(0, Math.min(1, (edge + rag - style.fade[0]) / (style.fade[1] - style.fade[0])));
  return t * t * (3 - 2 * t);
}

/** Cells a side of the mask where the paint gives way to bare paper, drawn large over the whole sheet. */
const FADE_CELLS = 384;

/** Where the paint gives way to bare paper at the sheet's edge, as a small mask in its alpha, painted a band of rows a step. */
export function* fadeMask(style: MapStyle): Generator<void, HTMLCanvasElement> {
  const fade = document.createElement("canvas");
  fade.width = fade.height = FADE_CELLS;
  const g = fade.getContext("2d") as CanvasRenderingContext2D;
  const img = g.createImageData(FADE_CELLS, FADE_CELLS);
  for (let j0 = 0; j0 < FADE_CELLS; j0 += 96) {
    for (let j = j0; j < Math.min(FADE_CELLS, j0 + 96); j++) {
      for (let i = 0; i < FADE_CELLS; i++) img.data[(j * FADE_CELLS + i) * 4 + 3] = Math.round(255 * paintAt(style, (i + 0.5) / FADE_CELLS, (j + 0.5) / FADE_CELLS));
    }
    yield;
  }
  g.putImageData(img, 0, 0);
  return fade;
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
 * Dry land's wash, brushed thin: streaks along the brush's way where the
 * paper shows through, more and stronger the drier the land. `box` is the
 * area's extent on the paper and `inside` says whether a point of it is the
 * area's own ground; the streaks go down in two strokes of the brush, so a
 * dry area costs two draws however large it is.
 */
function dryBrush(g: CanvasRenderingContext2D, box: Box, dry: number, style: MapStyle, seed: number, inside: (x: number, y: number) => boolean): void {
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

const overlaps = (a: Box, b: Box): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * Lays the wash on `g`, whose transform takes the sheet's pixels to its own,
 * from `under`, the sheet's cells (`sheet.n` a side), each in its color with
 * as much paint as it has; only what reaches into `box` is laid. Pigment
 * pools at the rims of the areas whose health is known, dry ground lets the
 * paper through, and the paint gives way to bare paper at the sheet's edge.
 * Everything after the cells is laid only where paint is, so a cell without
 * paint stays bare.
 */
export function* layWash(g: CanvasRenderingContext2D, under: CanvasImageSource, sheet: WashSheet, style: MapStyle, box: Box = [0, 0, PAPER, PAPER]): Generator<void> {
  const { n, cell, reach, nearest } = sheet;
  const scale = PAPER / (reach * 2);
  const px = (v: number): number => (v + reach) * scale;
  g.lineJoin = "round";
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(under, 0, 0, n * cell * scale, n * cell * scale);
  yield;
  // Each area's cells' extent on the sheet: what its rim's pigment and its dry streaks can reach.
  const spans = new Map<number, [number, number, number, number]>();
  for (let c = 0; c < n * n; c++) {
    const k = nearest[c] as number;
    const i = c % n;
    const j = Math.floor(c / n);
    const b = spans.get(k);
    spans.set(k, b === undefined ? [i, j, i, j] : [Math.min(b[0], i), Math.min(b[1], j), Math.max(b[2], i), Math.max(b[3], j)]);
  }
  const extent = (k: number): Box | null => {
    const b = spans.get(k);
    return b === undefined ? null : [b[0] * cell * scale, b[1] * cell * scale, (b[2] + 1) * cell * scale, (b[3] + 1) * cell * scale];
  };
  // The pooling stops a little inside the land's rim, so no rim is drawn along it.
  g.save();
  g.globalCompositeOperation = "source-atop";
  g.clip(rimPath(sheet.half - 8, px));
  const pooled = [...sheet.areas.entries()].sort(([, a], [, b]) => a.depth - b.depth);
  for (const [step, [k, a]] of pooled.entries()) {
    const at = extent(k);
    if (a.pool === null || (at !== null && !overlaps(at, box))) continue;
    poolRim(g, a.path, a.pool, style.pool);
    if (step % 6 === 5) yield;
  }
  g.restore();
  // Dry land lets the paper through in dry-brush streaks, each cell by the area nearest it, so the corners past the
  // land's rim take their neighbor's streaks and nothing marks the rim.
  const cellAt = (x: number, y: number): number => Math.floor(y / scale / cell) * n + Math.floor(x / scale / cell);
  for (const [k, a] of sheet.areas.entries()) {
    const at = extent(k);
    if (a.dry <= 0.05 || at === null || !overlaps(at, box)) continue;
    dryBrush(g, at, a.dry, style, k, (x, y) => nearest[cellAt(x, y)] === k);
  }
  yield;
  // Brushwork: the wash laid in broad, overlapping strokes, each a little warmer or cooler, lighter or darker.
  g.globalCompositeOperation = "source-atop";
  g.lineCap = "round";
  const reachOf = 200;
  for (let k = 0; k < style.strokes; k++) {
    const x = hash(k, 71) * PAPER;
    const y = hash(71, k) * PAPER;
    if (x + reachOf < box[0] || x - reachOf > box[2] || y + reachOf < box[1] || y - reachOf > box[3]) continue;
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
  g.drawImage(sheet.fade, 0, 0, PAPER, PAPER);
  g.globalCompositeOperation = "source-over";
}

/**
 * Floats a laid wash onto paper at (`x`, `y`) of `ctx`: wet in wet, a
 * softened copy laid first lets each wash bleed into its neighbors, then the
 * wash itself. `k` is how many of `ctx`'s pixels a sheet's pixel takes.
 */
export function* floatWash(ctx: CanvasRenderingContext2D, wash: CanvasImageSource, x: number, y: number, style: MapStyle, k = 1): Generator<void> {
  ctx.filter = `blur(${(style.bleedPx * k).toFixed(2)}px)`;
  ctx.globalAlpha = style.bleed;
  ctx.drawImage(wash, x, y);
  ctx.filter = "none";
  yield;
  ctx.globalAlpha = style.washAlpha;
  ctx.drawImage(wash, x, y);
  ctx.globalAlpha = 1;
}
