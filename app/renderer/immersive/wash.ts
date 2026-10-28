// Paints the field sheet's watercolor washes (docs/design-system.md, "The
// field sheet"). The field map paints the whole land at once (`field-map.ts`),
// and the loading screen paints each part as its vitality arrives (`wait/`).
// Both paint with `layWash` on a sheet `PAPER` pixels square, then blend it
// onto the paper with `floatWash`.

import type { MapStyle } from "./map-styles.ts";
import { type LandOutline, pastTheEdge } from "@gaia/terrain";

/** The sheet's side in pixels. Every width and count in this module is at this size. */
export const PAPER = 2048;

/** A box on the sheet: left, top, right and bottom. */
export type Box = readonly [number, number, number, number];

/** The land's cells and areas that a wash is painted from. */
export interface WashSheet {
  /** In meters, the distance from the land's center to the sheet's edge (`reach`) and the land's half-width (`half`), inside which rims pool. */
  readonly reach: number;
  readonly half: number;
  /** The land's width over its depth (`LandOutline`). */
  readonly aspect?: number;
  /** A grid of `n` cells a side, each `cell` meters, from the sheet's corner, and for each cell the index in `areas` of the nearest area. */
  readonly n: number;
  readonly cell: number;
  readonly nearest: Int16Array;
  readonly areas: readonly WashArea[];
  /** The paint's fade to bare paper at the sheet's edge, as an alpha mask stretched over the whole sheet (`fadeMask`). */
  readonly fade: HTMLCanvasElement;
}

/**
 * An area's wash inputs: its outline on the sheet, its depth (shallower areas pool first), its rim's pool color (null
 * while its vitality is unknown), and its own ground's dryness from 0 to 1.
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

/** How many points on each side `easeRing` averages each point with, and how many passes, to smooth a traced outline's lattice steps. */
const EASE = { reach: 5, passes: 2 };

/** Smooths a closed ring of x, z pairs by averaging each point with its neighbors along the ring. */
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

/** Within this many meters of the land's edge, a traced outline point follows the edge rather than bordering another area. */
const EDGE_RUN = 2.5;

/**
 * Returns an area's border as SVG path data in meters. Each ring is smoothed
 * (`easeRing`), thinned to every other point and drawn as a curve through the
 * midpoints of its edges. Stretches along the land's edge are left out, since
 * there the paint fades into paper instead. The loading screen's pen and
 * hedgerows and the field map's borders all draw this path.
 */
export function borderPath(rings: readonly (readonly number[])[], land: LandOutline): string {
  const f = (v: number): string => v.toFixed(1);
  let d = "";
  for (const raw of rings) {
    const count = raw.length / 2;
    if (count < 3) continue;
    const ring = easeRing(raw);
    const at = (k: number): [number, number] => [ring[k * 2] as number, ring[k * 2 + 1] as number];
    const mid = (a: number, b: number): string => {
      const [ax, az] = at(a);
      const [bx, bz] = at(b);
      return `${f((ax + bx) / 2)} ${f((az + bz) / 2)}`;
    };
    // Tests the raw traced point, not the smoothed one, because smoothing pulls a stretch along a rounded corner inward.
    const inner = (k: number): boolean => pastTheEdge(land, raw[k * 2] as number, raw[k * 2 + 1] as number) < -EDGE_RUN;
    const step = count < 12 ? 1 : 2;
    const kept: number[] = [];
    for (let k = 0; k < count; k += step) kept.push(k);
    const edge = kept.findIndex((k) => !inner(k));
    if (edge < 0) {
      // A ring that never meets the edge is one closed curve.
      const n = kept.length;
      d += `M${mid(kept[0] as number, kept[1 % n] as number)}`;
      for (let q = 1; q <= n; q++) d += `Q${at(kept[q % n] as number).map(f).join(" ")} ${mid(kept[q % n] as number, kept[(q + 1) % n] as number)}`;
      d += "Z";
      continue;
    }
    // Otherwise each run of inner points between stretches along the edge is an open curve. Runs start just past an
    // edge point, so no run wraps around the ring's start.
    let run: number[] = [];
    const flush = (): void => {
      if (run.length >= 3) {
        d += `M${at(run[0] as number).map(f).join(" ")}`;
        for (let q = 1; q < run.length - 1; q++) d += `Q${at(run[q] as number).map(f).join(" ")} ${mid(run[q] as number, run[q + 1] as number)}`;
        d += `L${at(run[run.length - 1] as number).map(f).join(" ")}`;
      }
      run = [];
    };
    for (let q = 1; q <= kept.length; q++) {
      const k = kept[(edge + q) % kept.length] as number;
      if (inner(k)) run.push(k);
      else flush();
    }
    flush();
  }
  return d;
}

/**
 * Returns rings of x, z pairs in meters as one Path2D through `px`, which maps
 * meters to sheet pixels. Each ring is a quadratic curve through the midpoints
 * of its edges with the corners as control points, so a traced lattice's
 * steps read as a smooth line.
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

/** Returns points in meters around the land's edge, `inset` meters inside it (`pastTheEdge`). */
export function rimPoints(land: LandOutline, inset: number, count = 180): [number, number][] {
  const size = land.size;
  const out: [number, number][] = [];
  for (let k = 0; k <= count; k++) {
    const a = (k / count) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Bisects along each ray from the center for the distance where the inset edge falls.
    let lo = 0;
    let hi = size;
    for (let i = 0; i < 24; i++) {
      const d = (lo + hi) / 2;
      if (pastTheEdge(land, c * d, s * d) < -inset) lo = d;
      else hi = d;
    }
    out.push([c * lo, s * lo]);
  }
  return out;
}

/** The land's edge `inset` meters inside it as a Path2D through `px`, for clipping a pen to the land. */
export function rimPath(land: LandOutline, inset: number, px: (v: number) => number = (v) => v): Path2D {
  const p = new Path2D();
  rimPoints(land, inset).forEach(([x, z], k) => (k === 0 ? p.moveTo(px(x), px(z)) : p.lineTo(px(x), px(z))));
  p.closePath();
  return p;
}

const noises = new Map<string, HTMLCanvasElement>();
/** A small cached canvas of random alpha in one color. Drawn scaled up, image smoothing turns its pixels into soft mottling. */
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

/** The paint amount from 0 to 1 at (u, v), where the sheet's corners are 0 and 1. It is full inside and fades raggedly to bare paper at the edge. */
export function paintAt(style: MapStyle, u: number, v: number, aspect = 1): number {
  // The sheet spans the land's width. To the north and south, the paint ends where the land does.
  const edge = Math.min(u, 1 - u, 0.5 / aspect - Math.abs(v - 0.5));
  const rag = (valueNoise(u * 22, v * 22, 3) - 0.5) * 2 * style.ragged + (valueNoise(u * 96, v * 96, 11) - 0.5) * style.ragged * 0.7;
  const t = Math.max(0, Math.min(1, (edge + rag - style.fade[0]) / (style.fade[1] - style.fade[0])));
  return t * t * (3 - 2 * t);
}

/** The fade mask's side in cells. It is stretched over the whole sheet. */
const FADE_CELLS = 384;

/** Paints the fade mask (`paintAt`) into a small canvas's alpha, yielding after each band of 96 rows. */
export function* fadeMask(style: MapStyle, aspect = 1): Generator<void, HTMLCanvasElement> {
  const fade = document.createElement("canvas");
  fade.width = fade.height = FADE_CELLS;
  const g = fade.getContext("2d") as CanvasRenderingContext2D;
  const img = g.createImageData(FADE_CELLS, FADE_CELLS);
  for (let j0 = 0; j0 < FADE_CELLS; j0 += 96) {
    for (let j = j0; j < Math.min(FADE_CELLS, j0 + 96); j++) {
      for (let i = 0; i < FADE_CELLS; i++) img.data[(j * FADE_CELLS + i) * 4 + 3] = Math.round(255 * paintAt(style, (i + 0.5) / FADE_CELLS, (j + 0.5) / FADE_CELLS, aspect));
    }
    yield;
  }
  g.putImageData(img, 0, 0);
  return fade;
}

/** Strokes an area's outline in a darker shade, clipped inside it, so the rim looks like pooled pigment. */
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
 * Erases dry-brush streaks from a dry area's wash so the paper shows through,
 * more and stronger as `dry` rises. `box` is the area's extent on the paper,
 * and `inside` says whether a point is the area's own ground. The streaks go
 * into two paths, so a dry area costs two draws however large it is.
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
 * Paints the wash on `g`, whose transform maps sheet pixels to its own.
 * `under` holds the sheet's cells (`sheet.n` a side), each in its color and
 * alpha. Only work that reaches `box` is drawn. The steps after the cells are
 * rim pooling for areas with known vitality, dry-brush streaks, brush strokes,
 * granulation and the edge fade. Each draws only where paint is, so a cell
 * without paint stays bare.
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
  // Each area's cell extent on the sheet, which bounds its rim pooling and dry streaks.
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
  // Clips pooling to 8 m inside the land's edge, so no rim is drawn along the edge.
  g.save();
  g.globalCompositeOperation = "source-atop";
  g.clip(rimPath({ size: sheet.half * 2, ...(sheet.aspect === undefined ? {} : { aspect: sheet.aspect }) }, 8, px));
  const pooled = [...sheet.areas.entries()].sort(([, a], [, b]) => a.depth - b.depth);
  for (const [step, [k, a]] of pooled.entries()) {
    const at = extent(k);
    if (a.pool === null || (at !== null && !overlaps(at, box))) continue;
    poolRim(g, a.path, a.pool, style.pool);
    if (step % 6 === 5) yield;
  }
  g.restore();
  // Dry-brush streaks follow each cell's nearest area, so cells past the land's edge take their neighbor's streaks and
  // nothing marks the edge.
  const cellAt = (x: number, y: number): number => Math.floor(y / scale / cell) * n + Math.floor(x / scale / cell);
  for (const [k, a] of sheet.areas.entries()) {
    const at = extent(k);
    if (a.dry <= 0.05 || at === null || !overlaps(at, box)) continue;
    dryBrush(g, at, a.dry, style, k, (x, y) => nearest[cellAt(x, y)] === k);
  }
  yield;
  // Brush strokes: broad and overlapping, each a little warmer or cooler, lighter or darker.
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
  // Granulation: two noise layers, fine specks and broad blooms, like pigment settling into the paper's texture.
  g.imageSmoothingEnabled = true;
  for (const [cells, strength, seed] of [[420, 0.16, 3.1], [36, 0.12, 9.7]] as const) {
    g.globalAlpha = strength;
    g.drawImage(noiseCanvas(cells, seed, [60, 46, 26]), 0, 0, PAPER, PAPER);
  }
  g.globalAlpha = 1;
  yield;
  // Fades the paint to bare paper at the sheet's edge.
  g.globalCompositeOperation = "destination-in";
  g.drawImage(sheet.fade, 0, 0, PAPER, PAPER);
  g.globalCompositeOperation = "source-over";
}

/**
 * Draws a painted wash onto the paper at (`x`, `y`) of `ctx`. A blurred copy
 * goes down first so each area bleeds into its neighbors, then the wash
 * itself. `k` is how many of `ctx`'s pixels one sheet pixel covers.
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
