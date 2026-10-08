// The field map: a hand-drawn map of the world on mottled paper, unfolded
// from a small map button. Each area (a directory) is a watercolor wash, its
// hue shared by every area under the same top-level directory, its pigment
// pooling toward its rim, inside a thin ink border; hills are shaded, water
// is washed blue and inked at its edge, trails are dotted, trees are dabs,
// buildings and landmarks are little drawn vignettes, and an inked
// cartouche carries Gaia's mark. A vermilion arrow says "you are here".
//
// The land (washes, hills, water, borders) is painted onto a paper canvas a
// few milliseconds at a time while the page is idle after each bake, so it
// never holds up a frame. Opening, panning and zooming redraw only the view of
// the paper and the marks and names over it, which stay one size at any zoom.

import { type Place, type PlaceArea, type WorldPlaces, heightAt, waterDepthAt } from "@gaia/terrain";
import { LOGO_ASPECT, logoImage } from "../brand/logo.ts";
import type { StoodWorld } from "../terrain/lab.ts";

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
  /** What the map shows, for scripted checks: zoom in pixels per meter, the paper's painting time and its longest step, and names drawn. */
  state(): { readonly open: boolean; readonly zoom: number; readonly paintMs: number; readonly longestStepMs: number; readonly drawMs: number; readonly labels: number };
}

export interface MapSource {
  stood(): StoodWorld;
  placeAt(x: number, z: number): Place;
  /** Every area and file patch, for drawing each file's ground. */
  places(): WorldPlaces;
}

/** Paper size in pixels, and how far past the land the map shows of the wild, meters. */
const PAPER = 2048;
const MARGIN = 70;
/** Sample spacing of the areas, the hills and the water, meters. */
const AREA_CELL = 5;
const HILL_CELL = 5;
const WATER_CELL = 2.5;
/** Where an area's name may step to, in pixels, when its own spot is taken. */
const NUDGES: readonly (readonly [number, number])[] = [[0, 0], [0, 26], [0, -26], [34, 10], [-34, 10], [0, 48], [0, -48]];
/** How far inside an area's edge its wash keeps darkening, as pigment pools at a wash's rim, in area cells. */
const POOL_CELLS = 3.5;
/** The paper is painted in steps of a millisecond or two, as many as fit in the page's idle time with this much to spare, ms. */
const SPARE_MS = 2;
const SERIF = `"Iowan Old Style", Georgia, "Times New Roman", serif`;
const INK = "#4a3c2c";
const PAPER_TONE = "#efe4c8";
/** The wash of land no directory but the repository's root holds. */
const COMMON_GROUND = "#cfd3a4";
/** Watercolor hues for top-level directories, soft enough to read names over. */
const WASHES = ["#9fbf83", "#dcb56f", "#d09684", "#8eb0c9", "#b39fcb", "#86b8a1", "#d79e68", "#a9bd93", "#cdb48a", "#9cadd6"];

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

interface Paper {
  readonly canvas: HTMLCanvasElement;
  readonly reach: number;
  /** Where to write each area's name: its heart, and how much land it holds. */
  readonly areaLabels: readonly { readonly area: PlaceArea; readonly x: number; readonly z: number; readonly cells: number }[];
}

/** Paints the land onto paper, yielding between steps so a driver can spread the work over idle time. */
function* paintPaper(stood: StoodWorld, placeAt: (x: number, z: number) => Place, places: WorldPlaces): Generator<void, Paper> {
  const t = stood.terrain;
  const size = t.spec.size;
  const reach = size / 2 + MARGIN;
  const scale = PAPER / (reach * 2);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PAPER;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const px = (v: number): number => (v + reach) * scale;

  // Paper: a warm ground, mottled as handmade paper is, with fibres and a faint grain.
  ctx.fillStyle = PAPER_TONE;
  ctx.fillRect(0, 0, PAPER, PAPER);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  for (const [cells, strength] of [[14, 0.09], [56, 0.05]] as const) {
    ctx.globalAlpha = strength;
    ctx.drawImage(noiseCanvas(cells, cells * 7.3, [96, 72, 40]), 0, 0, PAPER, PAPER);
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = "round";
  for (const [tone, count, seed] of [["rgba(118,92,56,0.075)", 1800, 11], ["rgba(255,251,238,0.16)", 1100, 23]] as const) {
    ctx.strokeStyle = tone;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let k = 0; k < count; k++) {
      const x = hash(k, seed) * PAPER;
      const y = hash(seed, k) * PAPER;
      const a = hash(k + seed, 3) * Math.PI * 2;
      const len = 6 + hash(k, seed + 1) * 16;
      const bend = (hash(k, seed + 2) - 0.5) * 8;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
    }
    ctx.stroke();
  }
  for (const [tone, from] of [["rgba(120,96,60,0.06)", 0], ["rgba(255,250,235,0.1)", 1]] as const) {
    ctx.fillStyle = tone;
    ctx.beginPath();
    for (let k = from; k < 6000; k += 2) ctx.rect(hash(k, 1) * PAPER, hash(k, 2) * PAPER, 1 + hash(k, 4) * 3, 1 + hash(k, 5) * 3);
    ctx.fill();
  }
  yield;

  // Areas: one sample per cell.
  const n = Math.ceil((reach * 2) / AREA_CELL);
  const at = new Int16Array(n * n).fill(-1);
  const areas: PlaceArea[] = [];
  const index = new Map<string, number>();
  const sums: { x: number; z: number; cells: number; i0: number; i1: number; j0: number; j1: number }[] = [];
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
        sums.push({ x: 0, z: 0, cells: 0, i0: i, i1: i, j0: j, j1: j });
      }
      at[j * n + i] = k;
      const s = sums[k] as (typeof sums)[number];
      s.x += x;
      s.z += z;
      s.cells += 1;
      s.i0 = Math.min(s.i0, i);
      s.i1 = Math.max(s.i1, i);
      s.j0 = Math.min(s.j0, j);
      s.j1 = Math.max(s.j1, j);
    }
    if (j % 8 === 7) yield;
  }

  // Washes: each top-level directory a hue, its subdirectories a little lighter or darker.
  const tops = [...new Set(areas.map((a) => a.path.split("/")[0] ?? ""))].sort();
  const washOf = areas.map((a) => {
    // The repository's own common ground is a pale meadow, so its directories' washes stand out on it.
    if (a.depth === 0) return mixRgb(COMMON_GROUND, "#fbf5e6", 0.15);
    const base = WASHES[tops.indexOf(a.path.split("/")[0] ?? "") % WASHES.length] as string;
    const tone = (hash(a.path.length * 13.1, a.path.charCodeAt(a.path.length - 1) || 0) - 0.5) * 0.56;
    return tone > 0 ? mixRgb(base, "#fbf5e6", tone) : mixRgb(base, "#5b5040", -tone * 0.5);
  });
  // How far each cell lies inside its area's edge, in cells: watercolor pools its pigment there, so each wash darkens toward its rim.
  const edge = new Float32Array(n * n).fill(POOL_CELLS);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = j * n + i;
      const k = at[c];
      if ((i > 0 && at[c - 1] !== k) || (i < n - 1 && at[c + 1] !== k) || (j > 0 && at[c - n] !== k) || (j < n - 1 && at[c + n] !== k)) edge[c] = 0;
    }
  }
  for (let c = 0; c < n * n; c++) {
    const i = c % n;
    if (i > 0) edge[c] = Math.min(edge[c] as number, (edge[c - 1] as number) + 1);
    if (c >= n) edge[c] = Math.min(edge[c] as number, (edge[c - n] as number) + 1);
  }
  for (let c = n * n - 1; c >= 0; c--) {
    const i = c % n;
    if (i < n - 1) edge[c] = Math.min(edge[c] as number, (edge[c + 1] as number) + 1);
    if (c < n * n - n) edge[c] = Math.min(edge[c] as number, (edge[c + n] as number) + 1);
  }
  yield;
  const small = document.createElement("canvas");
  small.width = small.height = n;
  const sctx = small.getContext("2d") as CanvasRenderingContext2D;
  const washes = sctx.createImageData(n, n);
  for (let c = 0; c < n * n; c++) {
    const rgb = washOf[at[c] as number];
    if (rgb === undefined) continue;
    const pool = Math.max(0, 1 - (edge[c] as number) / POOL_CELLS) ** 1.6;
    // Granulation: pigment settles unevenly into the paper's tooth.
    const grain = 1 + (hash(c % n, Math.floor(c / n)) - 0.5) * 0.07 + (hash(Math.floor((c % n) / 6), Math.floor(c / n / 6)) - 0.5) * 0.09;
    const shade = (1 - pool * 0.3) * grain;
    washes.data.set([Math.min(255, rgb[0] * shade), Math.min(255, rgb[1] * shade), Math.min(255, rgb[2] * shade * 0.98), 255], c * 4);
  }
  sctx.putImageData(washes, 0, 0);
  // Upscaled in two smooth steps, so the washes bleed softly into each other.
  const mid = document.createElement("canvas");
  mid.width = mid.height = n * 3;
  const mctx = mid.getContext("2d") as CanvasRenderingContext2D;
  mctx.imageSmoothingEnabled = true;
  mctx.imageSmoothingQuality = "high";
  mctx.drawImage(small, 0, 0, n * 3, n * 3);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = 0.6;
  ctx.drawImage(mid, 0, 0, PAPER, PAPER);
  ctx.globalAlpha = 1;
  yield;

  // Hills: shade from the northwest, laid lightly over the washes.
  const hn = Math.ceil((reach * 2) / HILL_CELL);
  const hill = document.createElement("canvas");
  hill.width = hill.height = hn;
  const hctx = hill.getContext("2d") as CanvasRenderingContext2D;
  const img = hctx.createImageData(hn, hn);
  const e = HILL_CELL * 1.5;
  for (let j = 0; j < hn; j++) {
    for (let i = 0; i < hn; i++) {
      const x = -reach + (i + 0.5) * HILL_CELL;
      const z = -reach + (j + 0.5) * HILL_CELL;
      const gx = (heightAt(t.lattice, x + e, z) - heightAt(t.lattice, x - e, z)) / (2 * e);
      const gz = (heightAt(t.lattice, x, z + e) - heightAt(t.lattice, x, z - e)) / (2 * e);
      const shade = Math.max(0, Math.min(1, 0.86 + (gx + gz) * 1.5));
      const o = (j * hn + i) * 4;
      const v = Math.round(255 * shade);
      img.data[o] = v;
      img.data[o + 1] = Math.round(v * 0.97);
      img.data[o + 2] = Math.round(v * 0.9);
      img.data[o + 3] = 255;
    }
    if (j % 14 === 13) yield;
  }
  hctx.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.42;
  ctx.drawImage(hill, 0, 0, PAPER, PAPER);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  yield;

  // Each file's patch: a faint wash in its health's color inside a fine ring, so the ground of every file shows.
  ctx.lineWidth = 1.6;
  for (const p of places.patches) {
    const r = p.radius * scale;
    ctx.beginPath();
    ctx.arc(px(p.x), px(p.z), r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${mixRgb("#a8956a", "#6f9450", Math.max(0, Math.min(1, p.vitality))).join(",")},0.2)`;
    ctx.fill();
    ctx.strokeStyle = "rgba(74,60,44,0.28)";
    ctx.stroke();
  }
  yield;

  // Water: washed blue and inked at its edge; streams too narrow for the samples follow their stations.
  const wn = Math.ceil((size + 40) / WATER_CELL);
  const w0 = -(size + 40) / 2;
  const wet = new Uint8Array(wn * wn);
  for (let j = 0; j < wn; j++) {
    for (let i = 0; i < wn; i++) wet[j * wn + i] = waterDepthAt(t, w0 + (i + 0.5) * WATER_CELL, w0 + (j + 0.5) * WATER_CELL) > 0.04 ? 1 : 0;
    if (j % 20 === 19) yield;
  }
  ctx.lineCap = ctx.lineJoin = "round";
  for (const stream of t.streams) {
    const width = 2 * Math.max(...stream.stations.map((s) => s.halfWidth)) * scale;
    ctx.beginPath();
    stream.stations.forEach((s, k) => (k === 0 ? ctx.moveTo(px(s.x), px(s.z)) : ctx.lineTo(px(s.x), px(s.z))));
    ctx.strokeStyle = "rgba(60,88,98,0.7)";
    ctx.lineWidth = Math.max(6, width + 4);
    ctx.stroke();
    ctx.strokeStyle = "rgb(140,182,192)";
    ctx.lineWidth = Math.max(3.5, width);
    ctx.stroke();
  }
  const water = document.createElement("canvas");
  water.width = water.height = wn;
  const wctx = water.getContext("2d") as CanvasRenderingContext2D;
  const wimg = wctx.createImageData(wn, wn);
  for (let k = 0; k < wn * wn; k++) {
    if (wet[k] === 0) continue;
    wimg.data[k * 4] = 140;
    wimg.data[k * 4 + 1] = 182;
    wimg.data[k * 4 + 2] = 192;
    wimg.data[k * 4 + 3] = 255;
  }
  wctx.putImageData(wimg, 0, 0);
  ctx.drawImage(water, px(w0), px(w0), wn * WATER_CELL * scale, wn * WATER_CELL * scale);
  yield;
  const wpx = (g: number): number => px(w0 + (g + 0.5) * WATER_CELL);
  ctx.strokeStyle = "rgba(60,88,98,0.8)";
  ctx.lineWidth = 2.6;
  for (let j0 = 0; j0 < wn - 1; j0 += 60) {
    ctx.beginPath();
    contour(0, wn - 1, j0, Math.min(wn - 1, j0 + 60), (i, j) => wet[j * wn + i] === 1, (x0, y0, x1, y1) => {
      ctx.moveTo(wpx(x0), wpx(y0));
      ctx.lineTo(wpx(x1), wpx(y1));
    });
    ctx.stroke();
    yield;
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

  // Area borders: a thin ink line, wobbling a little as a pen does.
  const apx = (g: number): number => px(-reach + (g + 0.5) * AREA_CELL);
  const wobble = (x: number, y: number): [number, number] => [apx(x) + (hash(x, y) - 0.5) * 3, apx(y) + (hash(y, x) - 0.5) * 3];
  ctx.strokeStyle = "rgba(74,60,44,0.55)";
  ctx.lineWidth = 2.8;
  for (let a = 0; a < areas.length; a++) {
    ctx.beginPath();
    const s = sums[a] as (typeof sums)[number];
    contour(Math.max(0, s.i0 - 1), Math.min(n - 1, s.i1 + 1), Math.max(0, s.j0 - 1), Math.min(n - 1, s.j1 + 1), (i, j) => at[j * n + i] === a, (x0, y0, x1, y1) => {
      const [ax, ay] = wobble(x0, y0);
      const [bx, by] = wobble(x1, y1);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    });
    // Each border is inked from both sides; a light hand keeps the two strokes one line.
    ctx.globalAlpha = 0.62;
    ctx.stroke();
    ctx.globalAlpha = 1;
    yield;
  }
  yield;

  // The land's edge, and wild brush past it as tufts of short strokes.
  ctx.beginPath();
  for (let k = 0; k <= 360; k++) {
    const a = (k / 360) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r = size / 2 / Math.pow(Math.abs(c) ** 4 + Math.abs(s) ** 4, 0.25);
    if (k === 0) ctx.moveTo(px(c * r), px(s * r));
    else ctx.lineTo(px(c * r), px(s * r));
  }
  ctx.strokeStyle = "rgba(74,60,44,0.7)";
  ctx.lineWidth = 3.4;
  ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 2400; k++) {
    const x = -reach + hash(k, 7) * reach * 2;
    const z = -reach + hash(k, 8) * reach * 2;
    if (Math.abs(x) ** 4 + Math.abs(z) ** 4 < (size / 2 + 8) ** 4) continue;
    const cx = px(x);
    const cy = px(z);
    for (const lean of [-0.5, 0, 0.45]) {
      ctx.moveTo(cx + lean * 4, cy);
      ctx.lineTo(cx + lean * 9, cy - 10 - hash(k, lean) * 6);
    }
  }
  ctx.strokeStyle = "rgba(92,104,64,0.5)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // A double rule round the sheet.
  ctx.strokeStyle = "rgba(74,60,44,0.55)";
  ctx.lineWidth = 3;
  ctx.strokeRect(14, 14, PAPER - 28, PAPER - 28);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(24, 24, PAPER - 48, PAPER - 48);
  yield;

  const areaLabels = areas.map((area, k) => {
    const s = sums[k] as (typeof sums)[number];
    const mx = s.x / s.cells;
    const mz = s.z / s.cells;
    // The cell of the area nearest its center of mass, so a crescent's name stays on its own land.
    let x = mx;
    let z = mz;
    let best = Infinity;
    for (let j = s.j0; j <= s.j1; j++) {
      for (let i = s.i0; i <= s.i1; i++) {
        if (at[j * n + i] !== k) continue;
        const cx = -reach + (i + 0.5) * AREA_CELL;
        const cz = -reach + (j + 0.5) * AREA_CELL;
        const d = Math.hypot(cx - mx, cz - mz);
        if (d < best) {
          best = d;
          x = cx;
          z = cz;
        }
      }
    }
    return { area, x, z, cells: s.cells };
  });
  return { canvas, reach, areaLabels };
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

interface Cartouche {
  readonly name: string;
  readonly narrow: boolean;
  readonly logoW: number;
  readonly logoH: number;
  readonly w: number;
  readonly h: number;
  /** The box it takes on the sheet, so names keep clear of it. */
  readonly box: [number, number, number, number];
}

/** Lays out the map's title: Gaia's mark over "a field map of" and the repository's name. */
function cartoucheOf(ctx: CanvasRenderingContext2D, name: string, narrow: boolean): Cartouche {
  const logoW = narrow ? 70 : 92;
  const logoH = logoW / LOGO_ASPECT;
  ctx.font = `600 8.5px ${SERIF}`;
  ctx.letterSpacing = "2.4px";
  const capsW = ctx.measureText("A FIELD MAP OF").width;
  ctx.letterSpacing = "0px";
  ctx.font = `italic 600 ${narrow ? 15 : 17}px ${SERIF}`;
  const nameW = ctx.measureText(name).width;
  const w = Math.max(logoW, capsW, nameW) + 34;
  const h = logoH + (narrow ? 44 : 48);
  return { name, narrow, logoW, logoH, w, h, box: [12, 12, 16 + w + 4, 16 + h + 8] };
}

/** The map's title in an inked cartouche at the sheet's top left. */
function drawCartouche(ctx: CanvasRenderingContext2D, logo: HTMLImageElement, { name, narrow, logoW, logoH, w, h }: Cartouche): void {
  const x0 = 16;
  const y0 = 16;
  const notch = 7;
  const frame = (inset: number): void => {
    const a = x0 + inset;
    const b = y0 + inset;
    const c = x0 + w - inset;
    const d = y0 + h - inset;
    const r = notch - inset * 0.6;
    ctx.beginPath();
    ctx.moveTo(a + r, b);
    ctx.lineTo(c - r, b);
    ctx.arc(c, b, r, Math.PI, Math.PI / 2, true);
    ctx.lineTo(c, d - r);
    ctx.arc(c, d, r, -Math.PI / 2, Math.PI, true);
    ctx.lineTo(a + r, d);
    ctx.arc(a, d, r, 0, -Math.PI / 2, true);
    ctx.lineTo(a, b + r);
    ctx.arc(a, b, r, Math.PI / 2, 0, true);
    ctx.closePath();
  };
  ctx.save();
  ctx.shadowColor = "rgba(74,60,44,0.22)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 1.5;
  frame(0);
  ctx.fillStyle = "rgba(248,241,224,0.95)";
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3;
  frame(0);
  ctx.stroke();
  ctx.lineWidth = 0.6;
  frame(4);
  ctx.stroke();
  const cx = x0 + w / 2;
  if (logo.complete && logo.naturalWidth > 0) ctx.drawImage(logo, cx - logoW / 2, y0 + 9, logoW, logoH);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(74,60,44,0.78)";
  ctx.font = `600 8.5px ${SERIF}`;
  ctx.letterSpacing = "2.4px";
  ctx.fillText("A FIELD MAP OF", cx + 1.2, y0 + logoH + 22);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = INK;
  ctx.font = `italic 600 ${narrow ? 15 : 17}px ${SERIF}`;
  ctx.fillText(name, cx, y0 + logoH + (narrow ? 39 : 42));
  // A small diamond on the bottom rule, as a cartographer finishes a label.
  ctx.beginPath();
  ctx.moveTo(cx, y0 + h - 3);
  ctx.lineTo(cx + 3, y0 + h);
  ctx.lineTo(cx, y0 + h + 3);
  ctx.lineTo(cx - 3, y0 + h);
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
}

const MAP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.2 9 4l6 2.2 5.5-2.2v13.8L15 20l-6-2.2-5.5 2.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 4v13.8M15 6.2V20" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;
const HERE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M12 2.5v3.2M12 18.3v3.2M2.5 12h3.2M18.3 12h3.2" stroke="currentColor" stroke-width="1.4"/></svg>`;

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

/** `onToggle` hears the map unfold and fold, however it was asked to. */
export function createFieldMap(root: HTMLElement, source: MapSource, onToggle?: (open: boolean) => void): FieldMap {
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
  sheet.innerHTML = /* html */ `
    <canvas class="field-map-view"></canvas>
    <svg class="field-map-here-arrow" viewBox="-14 -14 28 28" aria-hidden="true"><circle r="13" fill="rgba(246,238,219,0.82)"/><path d="M0 -11 7 7 0 3 -7 7Z" fill="#b8452c" stroke="#6e2a1a" stroke-width="1.2" stroke-linejoin="round"/></svg>
    <div class="field-map-here"><span class="here-file"></span><span class="here-area"></span></div>
    <div class="field-map-tools">
      <button type="button" class="map-tool map-center" aria-label="Center on where you stand" title="Where am I">${HERE_ICON}</button>
      <button type="button" class="map-tool map-close" aria-label="Fold the map" title="Fold (Esc)">×</button>
    </div>`;
  root.append(button, sheet);
  const canvas = sheet.querySelector("canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const hereFile = sheet.querySelector(".here-file") as HTMLElement;
  const hereArea = sheet.querySelector(".here-area") as HTMLElement;
  const logo = logoImage();
  logo.addEventListener("load", () => {
    if (isOpen) draw();
  });
  const arrow = sheet.querySelector(".field-map-here-arrow") as SVGElement;

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
    painting = paintPaper(source.stood(), source.placeAt, source.places());
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
    const r = paper?.reach ?? 670;
    const hx = Math.max(0, r - canvas.clientWidth / (2 * view.zoom));
    const hz = Math.max(0, r - canvas.clientHeight / (2 * view.zoom));
    view.x = Math.max(-hx, Math.min(hx, view.x));
    view.z = Math.max(-hz, Math.min(hz, view.z));
  }

  /**
   * You are here: a vermilion arrow in a paper halo, pointing the way the
   * person looks. It is its own element, moved by a transform, so walking with
   * the map open never redraws the sheet. Out in the wilds past the sheet it
   * waits at the edge nearest them, above the place cartouche.
   */
  function placeArrow(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const x = Math.max(22, Math.min(w - 22, (person.x - view.x) * view.zoom + w / 2));
    const y = Math.max(22, Math.min(h - 76, (person.z - view.z) * view.zoom + h / 2));
    arrow.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(-person.yaw * 180) / Math.PI}deg)`;
  }

  function draw(): void {
    const t0 = performance.now();
    const { w, h, dpr } = size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER_TONE;
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
    ctx.strokeStyle = "rgba(112,72,38,0.9)";
    for (const trail of stood.trails) {
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

    // Trees: a dab of green, browning with its file's vitality, inked round on a little trunk.
    ctx.lineWidth = 0.8;
    for (const tree of stood.trees) {
      const x = sx(tree.x);
      const y = sy(tree.z);
      if (!visible(x, y, 8)) continue;
      const r = (1.9 + hash(tree.x, tree.z) * 0.8) * grow;
      ctx.strokeStyle = "rgba(74,60,44,0.75)";
      ctx.beginPath();
      ctx.moveTo(x, y + r * 0.5);
      ctx.lineTo(x, y + r * 1.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = mixHex("#b29d74", "#6f9450", Math.max(0, Math.min(1, tree.vitality)));
      ctx.fill();
      ctx.stroke();
      // A lighter touch where the sun falls on the crown, as a brush leaves it.
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(236,240,196,0.45)";
      ctx.fill();
    }

    // Names keep off the drawn marks and each other.
    const taken: [number, number, number, number][] = [[w - 120, 0, w, 64], [0, h - 40, 150, h], [w - 80, h - 110, w, h]];
    const cartouche = cartoucheOf(ctx, source.places().name, w < 520);
    taken.push(cartouche.box);
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

    // Names stay one size at any zoom; where two would collide, the larger area's wins, and a name steps aside from a mark.
    labelCount = 0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const nameSize = w < 520 ? 15 : 17;
    for (const l of [...paper.areaLabels].sort((a, b) => b.cells - a.cells)) {
      // The repository's root is the whole sheet: the title names it.
      if (l.area.depth === 0 || !visible(sx(l.x), sy(l.z), 0)) continue;
      const parent = l.area.path.split("/").slice(0, -1).join(" / ").toUpperCase();
      ctx.font = `italic 600 ${nameSize}px ${SERIF}`;
      const nameW = ctx.measureText(l.area.name).width;
      ctx.font = `600 9px ${SERIF}`;
      const parentW = parent === "" ? 0 : ctx.measureText(parent).width + parent.length * 1.8;
      const half = Math.max(nameW, parentW) / 2 + 4;
      const boxAt = (x: number, y: number): [number, number, number, number] => [x - half, y - (parent === "" ? 11 : 21), x + half, y + 12];
      // A name sits wholly on the sheet or not at all.
      const fits = ([x0, y0, x1, y1]: [number, number, number, number]): boolean => x0 > 4 && y0 > 4 && x1 < w - 4 && y1 < h - 4 && free(x0, y0, x1, y1);
      const spot = NUDGES.map(([dx, dy]) => [sx(l.x) + dx, sy(l.z) + dy] as const).find(([cx, cy]) => fits(boxAt(cx, cy)));
      if (spot === undefined) continue;
      const [x, y] = spot;
      taken.push(boxAt(x, y));
      labelCount++;
      ctx.strokeStyle = "rgba(239,228,200,0.88)";
      ctx.lineWidth = 4;
      if (parent !== "") {
        ctx.font = `600 9px ${SERIF}`;
        ctx.letterSpacing = "1.8px";
        ctx.strokeText(parent, x, y - 12);
        ctx.fillStyle = "rgba(74,60,44,0.78)";
        ctx.fillText(parent, x, y - 12);
        ctx.letterSpacing = "0px";
      }
      ctx.font = `italic 600 ${nameSize}px ${SERIF}`;
      ctx.strokeText(l.area.name, x, y + 2);
      ctx.fillStyle = INK;
      ctx.fillText(l.area.name, x, y + 2);
    }
    // Buildings and landmarks name themselves once the map is close enough to read them.
    if (view.zoom > view.fit * 1.6) {
      ctx.font = `italic 12px ${SERIF}`;
      const marks = [...stood.landmarks.map((l) => ({ ...l, below: 15 })), ...stood.buildings.map((b) => ({ ...b, below: 13 }))];
      for (const m of marks) {
        const x = sx(m.x);
        const y = sy(m.z) + m.below * grow + 6;
        const half = ctx.measureText(m.name).width / 2 + 3;
        const box: [number, number, number, number] = [x - half, y - 8, x + half, y + 8];
        if (!visible(x, y, 0) || !free(...box)) continue;
        taken.push(box);
        ctx.strokeStyle = "rgba(239,228,200,0.9)";
        ctx.lineWidth = 3.5;
        ctx.strokeText(m.name, x, y);
        ctx.fillStyle = "rgba(74,60,44,0.92)";
        ctx.fillText(m.name, x, y);
      }
    }

    drawCartouche(ctx, logo, cartouche);
    placeArrow();

    // A compass rose and a scale, inked in the lower corners: a ring, four long points half-shaded from the
    // light, four short ones between, and north named above.
    ctx.save();
    ctx.translate(w - 44, h - 66);
    ctx.strokeStyle = INK;
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
      const half = long ? 3.4 : 2.4;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(side * half, -half);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fillStyle = side < 0 ? INK : "#f6eedb";
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.rotate(Math.PI / 4);
    }
    ctx.restore();
    ctx.font = `italic 600 12px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.fillStyle = INK;
    ctx.fillText("N", w - 44, h - 92);
    const meters = [50, 100, 200, 500].find((m) => m * view.zoom > 60) ?? 500;
    const bar = meters * view.zoom;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(20, h - 26);
    ctx.lineTo(20, h - 22);
    ctx.lineTo(20 + bar, h - 22);
    ctx.lineTo(20 + bar, h - 26);
    ctx.stroke();
    ctx.font = `italic 11px ${SERIF}`;
    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    // The scale's words sit over its bar, clear of the place cartouche on a narrow sheet.
    ctx.fillText(`${meters} m`, 20, h - 34);
    timing.drawMs = performance.now() - t0;
  }

  function fitView(): void {
    const { w, h } = size();
    view.fit = Math.min(w, h) / ((paper?.reach ?? 670) * 2);
    // A phone opens close enough to read the names around the person; a wide screen shows it all.
    const close = Math.min(w, h) < 560;
    view.zoom = close ? view.fit * 2.2 : view.fit;
    view.x = close ? person.x : 0;
    view.z = close ? person.z : 0;
    clampView();
  }

  function setOpen(on: boolean): void {
    if (on === isOpen) return;
    isOpen = on;
    sheet.classList.toggle("open", on);
    button.setAttribute("aria-expanded", String(on));
    onToggle?.(on);
    if (on) {
      fitView();
      draw();
    }
  }

  button.addEventListener("click", () => setOpen(!isOpen));
  (sheet.querySelector(".map-close") as HTMLElement).addEventListener("click", () => setOpen(false));
  (sheet.querySelector(".map-center") as HTMLElement).addEventListener("click", () => {
    view.x = person.x;
    view.z = person.z;
    view.zoom = Math.max(view.zoom, view.fit * 2.2);
    clampView();
    draw();
  });
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
        hereFile.hidden = place.file === null;
        hereArea.textContent = place.area.depth < 0 ? place.area.name : place.area.depth === 0 ? source.places().name : place.area.path.split("/").join(" / ");
      }
      // Walking with the map open moves the arrow a fraction of a pixel a frame: a few redraws a second keep up.
      if (isOpen && moved) placeArrow();
    },
    show(on) {
      shown = on;
      if (on && stale) startPainting();
      button.classList.toggle("on", on);
      if (!on) setOpen(false);
    },
    state: () => ({ open: isOpen, zoom: view.zoom, paintMs: Math.round(timing.paintMs), longestStepMs: +timing.longestStepMs.toFixed(1), drawMs: +timing.drawMs.toFixed(1), labels: labelCount }),
  };
}
