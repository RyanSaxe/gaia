// The map paints itself: the wait is the field map's own sheet, painted as
// the world is opened (docs/design-system.md, "The field sheet"), on its
// paper, with its torn edge and, after dark, its lantern. As soon as the land
// is divided, a pen draws every area's border. Each file's health is washed
// in once it is settled, whenever that is, spreading over the ground around
// it as the map spreads it (`settling.ts`), so the sheet never shows a color
// it later changes. Each area's name is lettered in the map's survey capitals
// once its last answer is in. While the world bakes, the pen draws each
// building's and landmark's mark at its laid-out place, one by one; once the
// world stands, its hill shade, water, contours, trails and trees come in;
// then the paper folds away into the world, as a jump on the map does.
// Nothing else moves: a lull is a still map.
//
// The washes are painted by the field map's own painter (`wash.ts`) in the
// page's idle time, a few milliseconds a step: each change is laid on a
// canvas over just the part of the sheet it touches, paper and all, shown by
// a CSS opacity transition over what was there, then copied into the sheet
// beneath it. Names and marks are small canvases revealed by transforms, and
// the borders are SVG paths drawn by a transition of their dash, so nothing
// here redraws per frame and a busy page thread never stalls the sheet.

import type { Outline } from "@gaia/terrain";
import type { LotPlace } from "@gaia/world";
import type { FilePatch } from "../../world-service/protocol.ts";
import type { StoodWorld } from "../terrain/lab.ts";
import { MARGIN, drawRivers, drawTrails, drawTrees, letterName, nearestAreas, paintRelief, strokeContours } from "../immersive/field-map.ts";
import { CELL, type NameLand, canvasMeasure, nameLand, placeNames } from "../immersive/map-names.ts";
import { DECKLE_MASK, MAP_STYLE, dryness, healthColor, landWash } from "../immersive/map-styles.ts";
import { markScale, stampBuilding, stampLandmark } from "../immersive/marks.ts";
import { PAPER, type WashArea, type WashSheet, easeRing, fadeMask, floatWash, layWash, ringsPath } from "../immersive/wash.ts";
import { layGround } from "../immersive/wild-ink.ts";
import { type CellBox, type SettlingHealth, settlingHealth } from "./settling.ts";
import type { WaitView } from "./wait.ts";

/**
 * How the map paints itself, ms, as wait.css times it: the pen over one border and the most it staggers over all of
 * them; a wash coming in; a name being lettered, and the least time between two; a mark coming in, the time between
 * two marks, at least and at most, and the most all the marks take; the relief coming in, and its second layer's
 * start after the first; and the moment after the last thing arrived before the paper folds away, and the fold.
 */
const PACE = { penMs: 1300, penSpreadMs: 2100, washMs: 1400, nameMs: 900, nameGapMs: 120, markMs: 700, markGapMs: [200, 600], marksMs: 5000, reliefMs: 1400, reliefGapMs: 300, restMs: 300, foldMs: 1100 } as const;
/** Paper pixels round a change that are painted again with it: as far as its wash bleeds, and a cell for the smoothing of its cells. */
const AROUND = 40;
/** The most a run of idle work may take, ms, and how much of an idle slot it leaves. */
const STEP_MS = 6;
const SPARE_MS = 2;

const STYLE = MAP_STYLE;
const SVG = "http://www.w3.org/2000/svg";
const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
/** Shows `el` by its CSS transition: a frame after it joins the page, so it starts from nothing. */
const show = (el: Element): void => void requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("shown")));

/** A ring of x, z pairs with every other point. */
function thin(ring: readonly number[]): number[] {
  if (ring.length < 24) return [...ring];
  const out: number[] = [];
  for (let k = 0; k < ring.length; k += 4) out.push(ring[k] as number, ring[k + 1] as number);
  return out;
}

/** A ring as an SVG path through the middles of its edges, bending at its corners, as a pen draws it. */
function pathOf(rings: readonly (readonly number[])[]): string {
  let d = "";
  const f = (v: number): string => v.toFixed(1);
  for (const ring of rings) {
    const count = ring.length / 2;
    if (count < 3) continue;
    const at = (k: number): [number, number] => {
      const i = ((k % count) + count) % count;
      return [ring[i * 2] as number, ring[i * 2 + 1] as number];
    };
    const [ax, ay] = at(0);
    let [bx, by] = at(1);
    d += `M${f((ax + bx) / 2)} ${f((ay + by) / 2)}`;
    for (let k = 1; k <= count; k++) {
      const [cx, cy] = at(k + 1);
      d += `Q${f(bx)} ${f(by)} ${f((bx + cx) / 2)} ${f((by + cy) / 2)}`;
      [bx, by] = [cx, cy];
    }
    d += "Z";
  }
  return d;
}

/** The land as the sheet paints it, once divided. */
interface Land {
  readonly reach: number;
  /** The canvases' side in their own pixels, and how many of them a sheet's pixel takes. */
  readonly device: number;
  readonly k: number;
  readonly n: number;
  /** Each area's path in the order every raster here indexes them, and its land's healthy wash. */
  readonly paths: readonly string[];
  readonly lands: readonly (readonly [number, number, number])[];
  readonly nearest: Int16Array;
  /** Each area's wash as it dries: its pigment pools at its rim once its own ground's health is known. */
  readonly washes: WashArea[];
  readonly fade: HTMLCanvasElement;
  readonly health: SettlingHealth;
  /** The cells, each in its color with as much paint as is settled, a pixel a cell. */
  readonly under: CanvasRenderingContext2D;
  /** Each area's name, lettered where it goes and waiting to be shown, by its path, once they are placed. */
  names: ReadonlyMap<string, HTMLElement> | null;
}

export function createMapWait(veil: HTMLElement): WaitView {
  veil.innerHTML = /* html */ `
    <div class="wait-paper"></div>
    <div class="wait-sheet">
      <div class="wait-body">
        <canvas class="wait-ground"></canvas>
        <div class="wait-layers"></div>
        <canvas class="wait-hedges"></canvas>
        <svg class="wait-ink" xmlns="${SVG}"></svg>
        <div class="wait-marks"></div>
        <div class="wait-names"></div>
      </div>
    </div>
    <div class="wait-lantern"></div>`;
  const sheetEl = veil.querySelector(".wait-sheet") as HTMLElement;
  sheetEl.style.setProperty("--deckle", DECKLE_MASK);
  const ground = veil.querySelector(".wait-ground") as HTMLCanvasElement;
  const layers = veil.querySelector(".wait-layers") as HTMLElement;
  const hedges = veil.querySelector(".wait-hedges") as HTMLCanvasElement;
  const ink = veil.querySelector(".wait-ink") as SVGSVGElement;
  const marksEl = veil.querySelector(".wait-marks") as HTMLElement;
  const namesEl = veil.querySelector(".wait-names") as HTMLElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const side = sheetEl.clientWidth || Math.min(window.innerWidth * 0.94, window.innerHeight * 0.9, 980);
  const device = Math.max(1, Math.round(side * dpr));
  /** A place on the sheet `v` pixels in, as a share of the sheet, so it holds if the sheet's size changes, and `off` pixels from it. */
  const placed = (v: number, off: number): string => `calc(${((v / side) * 100).toFixed(3)}% + ${off.toFixed(1)}px)`;

  // ---------- idle work: one queue of steps, a few milliseconds of the page's idle time at a time ----------
  const jobs: Generator<void>[] = [];
  let idleHandle = 0;
  const work = (job: Generator<void>): void => {
    jobs.push(job);
    schedule();
  };
  /** Runs `f` once the work asked for before it has run. */
  const afterWork = (f: () => void): void =>
    work(
      (function* (): Generator<void> {
        f();
        yield;
      })(),
    );
  function schedule(): void {
    if (idleHandle !== 0 || jobs.length === 0) return;
    idleHandle = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(run, { timeout: 250 }) : window.setTimeout(() => run(), 16);
  }
  function run(deadline?: IdleDeadline): void {
    idleHandle = 0;
    const t0 = performance.now();
    const budget = Math.min(STEP_MS, (deadline?.timeRemaining() ?? STEP_MS) - SPARE_MS);
    do {
      const job = jobs[0];
      if (job === undefined) break;
      if (job.next().done === true) jobs.shift();
    } while (performance.now() - t0 < budget);
    schedule();
  }

  // The sheet's paper, anchored as the map's is, laid once the land's scale is known; a clean copy stays to lay
  // each change on.
  const paper = document.createElement("canvas");
  paper.width = paper.height = device;
  ground.width = ground.height = device;
  const groundCtx = ground.getContext("2d") as CanvasRenderingContext2D;
  const layPaper = (reach: number): void => {
    layGround(paper.getContext("2d") as CanvasRenderingContext2D, STYLE, device / 2, device / 2, device / (2 * reach), device, device);
    groundCtx.drawImage(paper, 0, 0);
  };
  // Until the land comes, the sheet is the paper Gaia's own land would be painted on.
  layPaper(560);

  let land: Land | null = null;
  /** What came before the land was ready to take it. */
  const namesWaiting = new Set<string>();
  let marksWaiting: Pick<StoodWorld, "buildings" | "landmarks"> | null = null;
  let stoodWaiting: StoodWorld | null = null;
  /** Layers shown and not yet copied into the sheet beneath. */
  let showing = 0;
  /** What lift waits for: the land's own work, every mark drawn, and the relief come in. */
  let ready: Promise<void> = Promise.resolve();
  let marksDrawn: Promise<void> = Promise.resolve();
  let reliefShown: Promise<void> = Promise.resolve();

  // ---------- the land is divided ----------
  function divide(size: number, outlines: readonly Outline[], patches: readonly FilePatch[], lots: readonly LotPlace[]): void {
    const reach = size / 2 + MARGIN;
    const half = size / 2;
    layPaper(reach);
    ink.setAttribute("viewBox", `${-reach} ${-reach} ${reach * 2} ${reach * 2}`);
    let rim = "";
    for (let q = 0; q <= 180; q++) {
      const a = (q / 180) * Math.PI * 2;
      const d = (half - 3) / Math.pow(Math.abs(Math.cos(a)) ** 4 + Math.abs(Math.sin(a)) ** 4, 0.25);
      rim += `${q === 0 ? "M" : "L"}${(Math.cos(a) * d).toFixed(1)} ${(Math.sin(a) * d).toFixed(1)}`;
    }
    rim += "Z";
    ink.innerHTML = `<defs><clipPath id="wait-land"><path d="${rim}"/></clipPath></defs><g clip-path="url(#wait-land)"></g>`;
    const pens = ink.lastElementChild as SVGGElement;
    const perPixel = (reach * 2) / side;

    ready = new Promise((resolve) =>
      work(
        (function* (): Generator<void> {
          // The outlines follow the lattice they were traced on, a point a meter: eased into a pen's line, and every
          // other point kept, still finer than a pixel on the sheet.
          const eased: (readonly (readonly number[])[])[] = [];
          for (const [i, o] of outlines.entries()) {
            eased.push(o.rings.map((r) => thin(easeRing(r))));
            if (i % 4 === 3) yield;
          }
          // The pen draws every area's border from the middle outward, keeping inside the land as the map's
          // hedgerows do.
          const order = outlines
            .map((o, i) => {
              let x = 0;
              let z = 0;
              let m = 0;
              for (const ring of eased[i] ?? []) for (let q = 0; q < ring.length; q += 2, m++) [x, z] = [x + (ring[q] as number), z + (ring[q + 1] as number)];
              return { o, i, d: Math.hypot(x / Math.max(1, m), z / Math.max(1, m)) };
            })
            .filter((e) => e.o.depth > 0)
            .sort((a, b) => a.o.depth - b.o.depth || a.d - b.d);
          const step = Math.min(90, PACE.penSpreadMs / Math.max(1, order.length));
          const lines: SVGPathElement[] = [];
          for (const [q, { o, i }] of order.entries()) {
            const line = document.createElementNS(SVG, "path");
            line.setAttribute("d", pathOf(eased[i] ?? []));
            line.setAttribute("pathLength", "1");
            line.setAttribute("stroke-width", ((o.depth === 1 ? 1.3 : 1) * perPixel).toFixed(2));
            line.style.transitionDuration = `${PACE.penMs}ms`;
            line.style.transitionDelay = `${Math.round(q * step)}ms`;
            lines.push(line);
            if (q % 8 === 7) yield;
          }
          pens.append(...lines);
          show(sheetEl);
          yield;

          // Each cell's area, from the outlines as traced (`nameLand`, as the field map rasters them for its names), and
          // past the areas the nearest one, as the field map samples the land.
          const named = yield* nameLand(outlines, size, reach, lots);
          const { at, n } = named;
          const nearest = nearestAreas(at, n);
          yield;
          const fade = yield* fadeMask(STYLE);
          const paths = outlines.map((o) => o.path);
          const health = yield* settlingHealth(
            { n, cell: CELL, reach, nearest, areas: paths },
            patches.map((p) => ({ path: p.path, area: p.area, x: p.x, z: p.z, reach: p.radius, size: p.radius * p.radius })),
            STYLE.spread,
          );
          const toPaper = (v: number): number => ((v + reach) * PAPER) / (reach * 2);
          const washes: WashArea[] = [];
          for (const [i, o] of outlines.entries()) {
            washes.push({ path: ringsPath(eased[i] ?? [], toPaper), depth: o.depth, pool: null, dry: 0 });
            if (i % 4 === 3) yield;
          }
          const under = document.createElement("canvas");
          under.width = under.height = n;
          // The health come in so far washes in now, while the hedgerows and the names are made ready.
          land = { reach, device, k: device / PAPER, n, paths, lands: paths.map((p) => landWash(STYLE, p)), nearest, washes, fade, health, under: under.getContext("2d") as CanvasRenderingContext2D, names: null };
          settle({});
          yield;

          // The hedgerow under each border, a soft band of leaves, comes in as the pen goes: so soft that it is
          // painted at the sheet's own size in CSS pixels, a border a step.
          const hedgeSide = Math.round(side);
          hedges.width = hedges.height = hedgeSide;
          const h = hedges.getContext("2d") as CanvasRenderingContext2D;
          const scale = hedgeSide / (reach * 2);
          h.setTransform(scale, 0, 0, scale, hedgeSide / 2, hedgeSide / 2);
          h.clip(new Path2D(rim));
          h.lineJoin = h.lineCap = "round";
          h.strokeStyle = "rgba(52,80,40,0.16)";
          for (const { o, i } of order) {
            h.lineWidth = (o.depth === 1 ? 3.2 * 1.35 : 3.2) / scale;
            h.stroke(ringsPath(eased[i] ?? [], (v) => v));
            yield;
          }
          show(hedges);
          yield;

          // Every name's place, worked out once as the field map places them on its whole sheet, the same size as this
          // one, so a name lettered later never moves one lettered before it.
          land.names = yield* letterNames(named);
          for (const path of [...land.names.keys()].filter((p) => namesWaiting.has(p))) letter(path);
          namesWaiting.clear();
          if (marksWaiting !== null) drawMarks(marksWaiting);
          if (stoodWaiting !== null) relief(stoodWaiting);
          resolve();
        })(),
      ),
    );
  }

  /**
   * Each area's name lettered on its own canvas where `placeNames` puts it, the place the field map letters it in,
   * waiting to be shown: no name is left out, none covers another, and each keeps off the marks to come and the
   * rose's corner.
   */
  function* letterNames(named: NameLand): Generator<void, Map<string, HTMLElement>> {
    const out = new Map<string, HTMLElement>();
    const placing = yield* placeNames(named, side, canvasMeasure(document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D));
    const zoom = side / (named.reach * 2);
    // A sheet smaller than names are placed for letters them smaller, as the field map does.
    const shrink = Math.min(1, zoom / placing.scale);
    for (const p of placing.places) {
      // The lettering on its own canvas, level, turned by its wrapper to the way the area runs and written along it.
      const pad = 6;
      const w = p.halfW * 2 + pad * 2;
      const h = p.top + 12 + pad * 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const c = canvas.getContext("2d") as CanvasRenderingContext2D;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      letterName(c, { ...p.label, angle: 0 }, w / 2, p.top + pad, p.size, STYLE);
      const el = document.createElement("div");
      el.className = "wait-name";
      el.style.left = placed((p.x + named.reach) * zoom, -w / 2);
      el.style.top = placed((p.z + named.reach) * zoom, -p.top - pad);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.transformOrigin = `${w / 2}px ${p.top + pad}px`;
      el.style.transform = `rotate(${p.label.angle.toFixed(4)}rad)${shrink < 1 ? ` scale(${shrink.toFixed(4)})` : ""}`;
      const slide = document.createElement("div");
      slide.className = "wait-reveal";
      slide.append(canvas);
      el.append(slide);
      out.set(p.label.area.path, el);
      yield;
    }
    return out;
  }

  // ---------- each file's health, as it settles ----------
  /** Health come in and not yet laid on the cells. */
  const healthIn: Record<string, number> = {};
  /** Whether a job is taking the health come in, and how many jobs are laying or painting it. */
  let settling = false;
  let laying = 0;
  function settle(vitality: Readonly<Record<string, number>>): void {
    Object.assign(healthIn, vitality);
    if (land === null || settling) return;
    settling = true;
    laying++;
    work(settleIn(land));
  }

  /** Lays the health come in on the cells, a few files a step, then paints the cells it touched and letters the names it was waiting on. */
  function* settleIn(l: Land): Generator<void> {
    let cells: CellBox | null = null;
    const grow = (more: CellBox | null): void => {
      if (more !== null) cells = cells === null ? more : [Math.min(cells[0], more[0]), Math.min(cells[1], more[1]), Math.max(cells[2], more[2]), Math.max(cells[3], more[3])];
    };
    const grounds: string[] = [];
    for (;;) {
      const files = Object.entries(healthIn).slice(0, 12);
      if (files.length === 0) break;
      for (const [path] of files) delete healthIn[path];
      const settled = l.health.settle(Object.fromEntries(files));
      grow(settled.cells);
      for (const path of settled.grounds) {
        grounds.push(path);
        const i = l.paths.indexOf(path);
        const g = l.health.ground(path);
        if (i < 0 || g === undefined) continue;
        l.washes[i] = { ...(l.washes[i] as WashArea), pool: healthColor(STYLE, l.lands[i] as [number, number, number], g), dry: dryness(g) };
      }
      yield;
    }
    // Health that comes in from here on is another job's.
    settling = false;
    const box = cells as CellBox | null;
    if (box !== null) {
      // The cells it touched, in their color with as much paint as is settled there, a band of rows a step.
      const [i0, j0, i1, j1] = box;
      for (let ja = j0; ja <= j1; ja += 32) {
        const jb = Math.min(j1, ja + 31);
        const img = l.under.createImageData(i1 - i0 + 1, jb - ja + 1);
        for (let j = ja; j <= jb; j++) {
          for (let i = i0; i <= i1; i++) {
            const c = j * l.n + i;
            const rgb = healthColor(STYLE, l.lands[l.nearest[c] as number] ?? [0, 0, 0], l.health.vitality(c));
            img.data.set([rgb[0], rgb[1], rgb[2], Math.round(255 * l.health.paint(c))], ((j - ja) * (i1 - i0 + 1) + (i - i0)) * 4);
          }
        }
        l.under.putImageData(img, i0, ja);
        yield;
      }
      yield* paintLayer(l, box);
    }
    // A name asked for waits for its own ground's wash.
    for (const path of grounds) if (namesAsked.delete(path)) letter(path);
    laying--;
    washedIfDone();
  }

  /** Resolves once every change asked for so far has been painted and has come in. */
  const washed: (() => void)[] = [];
  const quiet = (): boolean => showing === 0 && laying === 0 && Object.keys(healthIn).length === 0;
  const allWashed = (): Promise<void> => (quiet() ? Promise.resolve() : new Promise((resolve) => washed.push(resolve)));
  const washedIfDone = (): void => {
    if (quiet()) for (const resolve of washed.splice(0)) resolve();
  };

  /**
   * Paints one change: the paper and the wash over the part of the sheet it touches, opaque, as the field map paints
   * them. It comes in over what was there, and is then copied into the sheet beneath.
   */
  function* paintLayer(l: Land, cells: CellBox): Generator<void> {
    const scale = PAPER / (l.reach * 2);
    const x0 = Math.max(0, cells[0] * CELL * scale - AROUND);
    const y0 = Math.max(0, cells[1] * CELL * scale - AROUND);
    const x1 = Math.min(PAPER, (cells[2] + 1) * CELL * scale + AROUND);
    const y1 = Math.min(PAPER, (cells[3] + 1) * CELL * scale + AROUND);
    const rx = Math.floor(x0 * l.k);
    const ry = Math.floor(y0 * l.k);
    const rw = Math.min(l.device, Math.ceil(x1 * l.k)) - rx;
    const rh = Math.min(l.device, Math.ceil(y1 * l.k)) - ry;
    // The wash is laid a little wider than the layer, so its bleed at the layer's edge matches what lies beside it.
    const bleed = Math.ceil(STYLE.bleedPx * l.k * 3);
    const scratch = document.createElement("canvas");
    scratch.width = rw + bleed * 2;
    scratch.height = rh + bleed * 2;
    const s = scratch.getContext("2d") as CanvasRenderingContext2D;
    s.setTransform(l.k, 0, 0, l.k, bleed - rx, bleed - ry);
    // What the areas' rims are as this change starts: one settling while it is painted waits for its own layer.
    const sheet: WashSheet = { reach: l.reach, half: l.reach - MARGIN, n: l.n, cell: CELL, nearest: l.nearest, areas: [...l.washes], fade: l.fade };
    yield* layWash(s, l.under.canvas, sheet, STYLE, [x0 - bleed / l.k, y0 - bleed / l.k, x1 + bleed / l.k, y1 + bleed / l.k]);
    const layer = document.createElement("canvas");
    layer.width = rw;
    layer.height = rh;
    const c = layer.getContext("2d") as CanvasRenderingContext2D;
    c.drawImage(paper, rx, ry, rw, rh, 0, 0, rw, rh);
    yield* floatWash(c, scratch, -bleed, -bleed, STYLE, l.k);
    layer.className = "wait-layer";
    layer.style.left = `${(rx / l.device) * 100}%`;
    layer.style.top = `${(ry / l.device) * 100}%`;
    layer.style.width = `${(rw / l.device) * 100}%`;
    layer.style.height = `${(rh / l.device) * 100}%`;
    layers.append(layer);
    showing++;
    show(layer);
    window.setTimeout(() => {
      groundCtx.drawImage(layer, rx, ry);
      layer.remove();
      showing--;
      washedIfDone();
    }, PACE.washMs + 150);
  }

  // ---------- names, as each area's last answer comes in ----------
  /** Names asked for whose ground's wash has yet to come in. */
  const namesAsked = new Set<string>();
  let lastName = 0;
  function letter(path: string): void {
    if (land?.names === null || land?.names === undefined) {
      namesWaiting.add(path);
      return;
    }
    const el = land.names.get(path);
    if (el === undefined || el.dataset.due !== undefined) return;
    if (land.health.ground(path) === undefined) {
      namesAsked.add(path);
      return;
    }
    el.dataset.due = "";
    // After the work already asked for, so a name never comes before the wash under it; names that settle together
    // are lettered one after another, as a pen would letter them.
    afterWork(() => {
      const at = Math.max(performance.now(), lastName + PACE.nameGapMs);
      lastName = at;
      window.setTimeout(() => {
        namesEl.append(el);
        show(el);
      }, at - performance.now());
    });
  }

  // ---------- marks, while the world bakes ----------
  function drawMarks(things: Pick<StoodWorld, "buildings" | "landmarks">): void {
    const l = land;
    if (l === null) {
      marksWaiting = things;
      return;
    }
    const zoom = side / (l.reach * 2);
    const s = markScale(zoom, 1);
    type Draw = (c: CanvasRenderingContext2D, x: number, y: number) => [number, number, number, number];
    const all: { readonly x: number; readonly z: number; readonly draw: Draw }[] = [
      ...things.landmarks.map((m) => ({ x: m.x, z: m.z, draw: ((c, x, y) => stampLandmark(c, x, y, s, m, m.vitality, m.name)) as Draw })),
      ...things.buildings.map((m) => ({ x: m.x, z: m.z, draw: ((c, x, y) => stampBuilding(c, x, y, s, m, m.vitality, m.name)) as Draw })),
    ];
    // From the middle outward, as the pen went over the borders.
    all.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const gap = Math.max(PACE.markGapMs[0], Math.min(PACE.markGapMs[1], PACE.marksMs / Math.max(1, all.length)));
    const start = performance.now();
    marksDrawn = new Promise((resolve) => {
      if (all.length === 0) resolve();
      work(
        (function* (): Generator<void> {
          for (const [q, m] of all.entries()) {
            // Each mark on its own canvas round its foot, as large as the tallest mark the map draws, then cut to it.
            const fx = 90 * s;
            const fy = 125 * s;
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(180 * s * dpr);
            canvas.height = Math.ceil(170 * s * dpr);
            const c = canvas.getContext("2d") as CanvasRenderingContext2D;
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
            const [bx0, by0, bx1, by1] = m.draw(c, fx, fy);
            const cx = Math.max(0, Math.floor(bx0 * dpr));
            const cy = Math.max(0, Math.floor(by0 * dpr));
            const crop = document.createElement("canvas");
            crop.width = Math.max(1, Math.min(canvas.width, Math.ceil(bx1 * dpr)) - cx);
            crop.height = Math.max(1, Math.min(canvas.height, Math.ceil(by1 * dpr)) - cy);
            (crop.getContext("2d") as CanvasRenderingContext2D).drawImage(canvas, cx, cy, crop.width, crop.height, 0, 0, crop.width, crop.height);
            crop.style.width = `${crop.width / dpr}px`;
            crop.style.height = `${crop.height / dpr}px`;
            const el = document.createElement("div");
            el.className = "wait-mark";
            el.style.left = placed((m.x + l.reach) * zoom, cx / dpr - fx);
            el.style.top = placed((m.z + l.reach) * zoom, cy / dpr - fy);
            el.style.width = crop.style.width;
            el.style.height = crop.style.height;
            const slide = document.createElement("div");
            slide.className = "wait-reveal";
            slide.append(crop);
            el.append(slide);
            const last = q === all.length - 1;
            window.setTimeout(
              () => {
                marksEl.append(el);
                show(el);
                if (last) window.setTimeout(resolve, PACE.markMs);
              },
              Math.max(0, start + q * gap - performance.now()),
            );
            yield;
          }
        })(),
      );
    });
  }

  // ---------- the relief, once the world stands ----------
  function relief(stood: StoodWorld): void {
    const l = land;
    if (l === null) {
      stoodWaiting = stood;
      return;
    }
    reliefShown = (async () => {
      // Over the washes as they finally lie, so the relief comes in over exactly what is there.
      await allWashed();
      const sheets: HTMLCanvasElement[] = [];
      await new Promise<void>((resolve) =>
        work(
          (function* (): Generator<void> {
            const zoom = side / (l.reach * 2);
            const sx = (x: number): number => (x + l.reach) * zoom;
            const sheetOf = (from: CanvasImageSource): CanvasRenderingContext2D => {
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = l.device;
              canvas.className = "wait-relief";
              const c = canvas.getContext("2d") as CanvasRenderingContext2D;
              c.drawImage(from, 0, 0);
              sheets.push(canvas);
              return c;
            };
            // The hills, the ponds and the rivers first; then the contours over them, the trails and the trees.
            const hills = sheetOf(ground);
            const contours = yield* paintRelief(hills, stood.terrain, STYLE, l.reach, l.device);
            hills.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawRivers(hills, stood.terrain.streams, sx, sx, zoom);
            yield;
            const lines = sheetOf(hills.canvas);
            lines.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (side / 2), dpr * (side / 2));
            strokeContours(lines, contours, zoom, STYLE);
            lines.setTransform(dpr, 0, 0, dpr, 0, 0);
            yield;
            drawTrails(lines, stood.ways, sx, sx, zoom, 1, STYLE);
            drawTrees(lines, stood.trees, sx, sx, zoom, 1, STYLE, () => true);
            resolve();
          })(),
        ),
      );
      for (const [q, canvas] of sheets.entries()) {
        layers.append(canvas);
        await frame();
        await frame();
        canvas.classList.add("shown");
        await wait(q === sheets.length - 1 ? PACE.reliefMs : PACE.reliefGapMs);
      }
    })();
  }

  return {
    opening(o) {
      if (o.stage === "land") divide(o.size, o.areas, o.patches, o.lots);
      else if (o.stage === "health") settle(o.vitality);
      else if (o.stage === "asking") for (const path of Object.keys(o.settled)) letter(path);
    },
    baking(health) {
      settle(health);
      // Every area is settled now: each name not yet lettered is, the largest area's first.
      void ready.then(() => {
        for (const path of land?.names?.keys() ?? []) letter(path);
      });
    },
    marks: drawMarks,
    stood: relief,
    night(n) {
      veil.style.setProperty("--night", n.toFixed(2));
    },
    async lift() {
      await ready;
      await Promise.all([marksDrawn, reliefShown]);
      // And every name asked for written: the last is lettered over as long as the pen takes over a name.
      await wait(Math.max(0, lastName + PACE.nameMs - performance.now()));
      await wait(PACE.restMs);
      sheetEl.classList.add("folding");
      veil.classList.add("lifted");
      await wait(PACE.foldMs);
      // Nothing of the wait keeps animating, or holds its canvases, under the world.
      veil.replaceChildren();
    },
  };
}
