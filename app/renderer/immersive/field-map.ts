// The field map: a hand-drawn map of the world on warm paper, unfolded from
// a small map button. Each area (a directory) is a watercolor wash, its hue
// shared by every area under the same top-level directory, inside a thin
// ink border; hills are shaded, water is washed blue and inked at its edge,
// trails are dotted, and trees, buildings and landmarks are small drawn
// marks. A vermilion arrow says "you are here".
//
// The land (washes, hills, water, borders) is painted onto a paper canvas a
// few milliseconds at a time while the page is idle after each bake, so it
// never holds up a frame. Opening, panning and zooming redraw only the view of
// the paper and the marks and names over it, which stay one size at any zoom.

import { type Place, type PlaceArea, heightAt, waterDepthAt } from "@gaia/terrain";
import type { StoodWorld } from "../terrain/lab.ts";

export interface FieldMap {
  /** The world changed: the paper is painted again while the page is idle. */
  invalidate(): void;
  /** Unfolds or folds the map. */
  open(on: boolean): void;
  readonly isOpen: boolean;
  /** Follows the person; redraws only while the map is open. */
  frame(x: number, z: number, yaw: number, place: Place): void;
  /** Whether the map is the chosen way of finding one's way: shows its button. */
  show(on: boolean): void;
  /** What the map shows, for scripted checks: zoom in pixels per meter, the paper's painting time and its longest step, and names drawn. */
  state(): { readonly open: boolean; readonly zoom: number; readonly paintMs: number; readonly longestStepMs: number; readonly drawMs: number; readonly labels: number };
}

export interface MapSource {
  stood(): StoodWorld;
  placeAt(x: number, z: number): Place;
}

/** Paper size in pixels, and how far past the land the map shows of the wild, meters. */
const PAPER = 2048;
const MARGIN = 70;
/** Sample spacing of the areas, the hills and the water, meters. */
const AREA_CELL = 5;
const HILL_CELL = 5;
const WATER_CELL = 2.5;
/** While the map is open and the person walks, it redraws at most this often, ms. */
const FOLLOW_MS = 150;
/** Where an area's name may step to, in pixels, when its own spot is taken. */
const NUDGES: readonly (readonly [number, number])[] = [[0, 0], [0, 26], [0, -26], [34, 10], [-34, 10], [0, 48], [0, -48]];
/** The paper is painted in steps of a millisecond or two, as many as fit in the page's idle time with this much to spare, ms. */
const SPARE_MS = 2;
const SERIF = `"Iowan Old Style", Georgia, "Times New Roman", serif`;
const INK = "#4a3c2c";
const PAPER_TONE = "#efe4c8";
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
function* paintPaper(stood: StoodWorld, placeAt: (x: number, z: number) => Place): Generator<void, Paper> {
  const t = stood.terrain;
  const size = t.spec.size;
  const reach = size / 2 + MARGIN;
  const scale = PAPER / (reach * 2);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PAPER;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const px = (v: number): number => (v + reach) * scale;

  // Paper: a warm ground with a faint grain.
  ctx.fillStyle = PAPER_TONE;
  ctx.fillRect(0, 0, PAPER, PAPER);
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
    const base = WASHES[tops.indexOf(a.path.split("/")[0] ?? "") % WASHES.length] as string;
    const tone = (hash(a.path.length * 13.1, a.path.charCodeAt(a.path.length - 1)) - 0.5) * 0.56;
    return tone > 0 ? mixRgb(base, "#fbf5e6", tone) : mixRgb(base, "#5b5040", -tone * 0.5);
  });
  const small = document.createElement("canvas");
  small.width = small.height = n;
  const sctx = small.getContext("2d") as CanvasRenderingContext2D;
  const washes = sctx.createImageData(n, n);
  for (let c = 0; c < n * n; c++) {
    const rgb = washOf[at[c] as number];
    if (rgb === undefined) continue;
    washes.data.set([...rgb, 255], c * 4);
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

export function createFieldMap(root: HTMLElement, source: MapSource): FieldMap {
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
    <div class="field-map-title"><span>Field map</span></div>
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
    painting = paintPaper(source.stood(), source.placeAt);
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

  let lastDraw = 0;
  function draw(): void {
    const t0 = performance.now();
    lastDraw = t0;
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
    }

    // Names keep off the drawn marks and each other.
    const taken: [number, number, number, number][] = [[w - 120, 0, w, 64], [0, h - 40, 150, h], [w - 80, h - 110, w, h]];
    const free = (x0: number, y0: number, x1: number, y1: number): boolean => taken.every(([a, b, c, d]) => x1 < a || x0 > c || y1 < b || y0 > d);
    for (const m of [...stood.buildings, ...stood.landmarks]) {
      const x = sx(m.x);
      const y = sy(m.z);
      taken.push([x - 9 * grow, y - 16 * grow, x + 9 * grow, y + 10 * grow]);
    }

    // Buildings: a small house. Landmarks: a tower, a ring of stones or a great tree.
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = INK;
    for (const b of stood.buildings) {
      const x = sx(b.x);
      const y = sy(b.z);
      const s = 1.1 * grow;
      ctx.beginPath();
      ctx.moveTo(x - 6 * s, y + 5 * s);
      ctx.lineTo(x - 6 * s, y - 1.5 * s);
      ctx.lineTo(x, y - 7.5 * s);
      ctx.lineTo(x + 6 * s, y - 1.5 * s);
      ctx.lineTo(x + 6 * s, y + 5 * s);
      ctx.closePath();
      ctx.fillStyle = "#f6eedb";
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#9a5a3c";
      ctx.fillRect(x - 1.5 * s, y + 0.5 * s, 3 * s, 4.5 * s);
    }
    for (const l of stood.landmarks) {
      const x = sx(l.x);
      const y = sy(l.z);
      const s = 1.05 * grow;
      const kind = l.name.toLowerCase();
      ctx.fillStyle = "#f6eedb";
      ctx.beginPath();
      if (kind.includes("ring")) {
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          ctx.moveTo(x + Math.cos(a) * 7 * s + 2 * s, y + Math.sin(a) * 7 * s);
          ctx.arc(x + Math.cos(a) * 7 * s, y + Math.sin(a) * 7 * s, 2 * s, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
      } else if (kind.includes("oak") || kind.includes("willow") || kind.includes("tree")) {
        ctx.moveTo(x, y + 3 * s);
        ctx.lineTo(x, y + 10 * s);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y - 1.5 * s, 7 * s, 0, Math.PI * 2);
        ctx.fillStyle = "#7f9f5c";
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.rect(x - 3.5 * s, y - 9 * s, 7 * s, 17 * s);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        if (kind.includes("keep")) {
          for (const dx of [-3.5, -0.9, 1.7]) ctx.rect(x + dx * s, y - 11.5 * s, 1.8 * s, 2.5 * s);
        } else {
          ctx.moveTo(x - 4.8 * s, y - 9 * s);
          ctx.lineTo(x, y - 15 * s);
          ctx.lineTo(x + 4.8 * s, y - 9 * s);
          ctx.closePath();
        }
        ctx.fillStyle = "#9a5a3c";
        ctx.fill();
        ctx.stroke();
      }
    }

    // Names stay one size at any zoom; where two would collide, the larger area's wins, and a name steps aside from a mark.
    labelCount = 0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const nameSize = w < 520 ? 15 : 17;
    for (const l of [...paper.areaLabels].sort((a, b) => b.cells - a.cells)) {
      if (!visible(sx(l.x), sy(l.z), 0)) continue;
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

    // You are here: a vermilion arrow in a paper halo, pointing the way the person looks;
    // out in the wilds past the sheet, it waits at the sheet's edge nearest them.
    ctx.save();
    // The arrow keeps above the place cartouche at the sheet's foot.
    ctx.translate(Math.max(22, Math.min(w - 22, sx(person.x))), Math.max(22, Math.min(h - 76, sy(person.z))));
    ctx.rotate(-person.yaw);
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(246,238,219,0.82)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fillStyle = "#b8452c";
    ctx.fill();
    ctx.strokeStyle = "#6e2a1a";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // A compass rose and a scale, inked in the lower corners.
    ctx.save();
    ctx.translate(w - 40, h - 62);
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(0, -17);
      ctx.lineTo(3.2, -3.2);
      ctx.lineTo(0, 0);
      ctx.closePath();
      if (k === 0) ctx.fill();
      ctx.stroke();
      ctx.rotate(Math.PI / 2);
    }
    ctx.font = `italic 600 12px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.fillText("N", 0, -26);
    ctx.restore();
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
    ctx.fillText(`${meters} m`, 26 + bar, h - 24);
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
        hereArea.textContent = place.area.depth < 0 ? place.area.name : place.area.path.split("/").join(" / ");
      }
      // Walking with the map open moves the arrow a fraction of a pixel a frame: a few redraws a second keep up.
      if (isOpen && moved && performance.now() - lastDraw > FOLLOW_MS) draw();
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
