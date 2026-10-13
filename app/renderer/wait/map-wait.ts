// The map paints itself: the wait is the field map's own sheet, painted as
// the world is opened (docs/design-system.md, "The field sheet"), on its
// paper, with its torn edge and, after dark, its lantern. A world chosen on
// the start rises into it as its picture, which stays as the sheet's paint
// until the world's own covers it. As soon as the land is divided, a pen
// draws every area's border. Each file's health is washed in once it is
// settled, whenever that is, spreading over the ground around it as the map
// spreads it (`settling.ts`), so the sheet never shows a color it later
// changes. Each area's name is lettered in the map's survey capitals once its
// last answer about its looks is in, before its wash if that comes later.
// While the world bakes, the pen draws each building's and landmark's mark at
// its laid-out place, one by one. Once the
// world stands, its relief is drawn in with the same hand: the hills, ponds,
// contours and trees wash in over each area's own ground, from the middle
// outward as the pen went over the borders, while the pen draws each river
// from its source to its mouth and each trail along its way. Then the paper
// folds away into the world, as a jump on the map does.
//
// Between those, a pencil shows what Jev is doing to the code, file by file:
// a file is sketched round while its area's looks are asked, hatched once
// its links are read, cross-hatched once Jev has read it for its quality,
// and circled again when Jev reads closer around it; each area is surveyed
// with short hachures inside its border as the folder pass reaches it. The
// pencil lies over the paper and fades under each file's wash as it comes.
// Answers come in bursts, but every stroke is drawn at a hand's pace, one
// after another (`pace.ts`), so the sheet keeps moving all the time Jev is
// at work and never shows anything before it has happened.
//
// The washes are painted by the field map's own painter (`wash.ts`) in the
// page's idle time, a few milliseconds a step: each change is laid on a
// canvas over just the part of the sheet it touches, paper and all, shown by
// a CSS opacity transition over what was there, then copied into the sheet
// beneath it. Names and marks are small canvases revealed by transforms, and
// the borders, rivers and trails are SVG paths drawn by a transition of their
// dash, so nothing here redraws per frame and a busy page thread never stalls
// the sheet.

import { rand, seedOf } from "@gaia/schema";
import type { Outline } from "@gaia/terrain";
import type { LotPlace } from "@gaia/world";
import type { FilePatch } from "../../world-service/protocol.ts";
import type { StoodWorld } from "../terrain/lab.ts";
import { MARGIN, drawRivers, drawTrails, drawTrees, letterName, nearestAreas, paintRelief, riverCourse, riverStrokes, strokeContours } from "../immersive/field-map.ts";
import { CELL, type NameLand, canvasMeasure, nameLand, placeNames } from "../immersive/map-names.ts";
import { DECKLE_MASK, MAP_STYLE, dryness, healthColor, landWash } from "../immersive/map-styles.ts";
import { markScale, stampBuilding, stampLandmark } from "../immersive/marks.ts";
import { borderPath, easeRing, fadeMask, floatWash, layWash, PAPER, rimPoints, ringsPath, type WashArea, type WashSheet } from "../immersive/wash.ts";
import { layGround } from "../immersive/wild-ink.ts";
import { type Pace, type Pacer, pacer } from "./pace.ts";
import { type CellBox, type SettlingHealth, settlingHealth } from "./settling.ts";
import type { WaitView } from "./wait.ts";

/**
 * How the map paints itself, ms, as wait.css times it: the pen over one border and the most it staggers over all of
 * them; a wash coming in; a name being lettered; a mark coming in, the time between
 * two marks, at least and at most, and the most all the marks take; the relief's wash staggered over the areas, and
 * one area's coming in; the pen over the rivers and the trails, when it starts on each once the world stands, how
 * far it goes a millisecond in the sheet's pixels, the least and the most one line takes, and the time between two
 * lines; and the moment after the last thing arrived before the paper folds away, and the fold.
 */
const PACE = {
  penMs: 1300,
  penSpreadMs: 2100,
  washMs: 1400,
  nameMs: 900,
  markMs: 700,
  markGapMs: [200, 600],
  marksMs: 5000,
  relief: { spreadMs: 1000, ms: 800 },
  rivers: { startMs: 250, pxPerMs: 0.5, ms: [600, 2000], gapMs: 120 },
  trails: { startMs: 700, pxPerMs: 0.7, ms: [400, 1400], gapMs: 60 },
  restMs: 300,
  foldMs: 1100,
} as const;
/**
 * Each kind of stroke's pace (`pace.ts`): names, the pencil over a file, the survey of an area and a file's wash, each
 * at least this many ms apart when nothing presses, a burst spread over at most this long.
 */
const PACED: Readonly<Record<"name" | "pencil" | "survey" | "wash", Pace>> = {
  name: { everyMs: 450, spreadMs: [4000, 20000] },
  pencil: { everyMs: 90, spreadMs: [4000, 20000] },
  survey: { everyMs: 600, spreadMs: [4000, 20000] },
  wash: { everyMs: 250, spreadMs: [4000, 20000] },
};
/**
 * The pencil, in meters on the land: how long one stroke takes, ms; a file's sketch round its ground, as a share of
 * its radius; its hatching, this far apart; its closer reading's ring, as a share of its radius; and an area's survey,
 * a tick this long inside its border this often along it.
 */
const PENCIL = { ms: 520, round: 0.85, hatch: 3.2, closer: 0.45, survey: { every: 11, tick: 3 } } as const;
/** A file's pencil marks: sketched while its area is asked, hatched once its links are read, cross-hatched once read for itself, and ringed when Jev reads closer round it. */
type Mark = "sketch" | "hatch" | "cross" | "closer";

/** How far an area's relief wash reaches past its own ground, and how soft its edge is, in cells. */
const FEATHER = { reach: 2, soft: 0.8 } as const;
/** Paper pixels round a change that are painted again with it: as far as its wash bleeds, and a cell for the smoothing of its cells. */
const AROUND = 40;
/** The most a run of idle work may take, ms, and how much of an idle slot it leaves. */
const STEP_MS = 6;
const SPARE_MS = 2;

const STYLE = MAP_STYLE;
const SVG = "http://www.w3.org/2000/svg";
const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
/** Shows `el` by its CSS transition: a frame after it joins the page, so it starts from nothing. */
const show = (el: Element): void => void requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("shown")));

/** A ring of x, z pairs with every other point. */
function thin(ring: readonly number[]): number[] {
  if (ring.length < 24) return [...ring];
  const out: number[] = [];
  for (let k = 0; k < ring.length; k += 4) out.push(ring[k] as number, ring[k + 1] as number);
  return out;
}

/** The land as the sheet paints it, once divided. */
interface Land {
  readonly reach: number;
  /** How much wider than deep the land is (`LandOutline`). */
  readonly aspect?: number;
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

export function createMapWait(veil: HTMLElement, aspect: number): WaitView {
  veil.innerHTML = /* html */ `
    <div class="wait-paper"></div>
    <div class="wait-sheet">
      <div class="wait-body">
        <div class="wait-square">
          <canvas class="wait-ground"></canvas>
          <div class="wait-layers"></div>
          <svg class="wait-pencil" xmlns="${SVG}"></svg>
          <canvas class="wait-hedges"></canvas>
          <svg class="wait-ink" xmlns="${SVG}"></svg>
          <div class="wait-marks"></div>
          <div class="wait-names"></div>
        </div>
      </div>
    </div>
    <div class="wait-lantern"></div>`;
  const sheetEl = veil.querySelector(".wait-sheet") as HTMLElement;
  sheetEl.style.setProperty("--deckle", DECKLE_MASK);
  // The sheet opens in the land's shape, which `divide` gives it again, so the paper never changes shape as it fills.
  sheetEl.style.setProperty("--aspect", Math.max(1, aspect).toFixed(4));
  const ground = veil.querySelector(".wait-ground") as HTMLCanvasElement;
  const layers = veil.querySelector(".wait-layers") as HTMLElement;
  const hedges = veil.querySelector(".wait-hedges") as HTMLCanvasElement;
  const ink = veil.querySelector(".wait-ink") as SVGSVGElement;
  const pencilEl = veil.querySelector(".wait-pencil") as SVGSVGElement;
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

  // ---------- a map chosen on the start ----------
  /** The chosen world's picture, lying on the sheet as its paint, and the land shape it is in. */
  let chosen: { readonly el: HTMLImageElement; readonly aspect: number } | null = null;
  function choose(picture: string, aspect: number): void {
    chosen?.el.remove();
    // The sheet takes the chosen map's shape before anything comes in, so the map rises into a sheet of its own shape.
    sheetEl.style.setProperty("--aspect", Math.max(1, aspect).toFixed(4));
    const el = document.createElement("img");
    el.className = "wait-chosen";
    el.alt = "";
    el.src = picture;
    // Decoded now, while the card rises, so the sheet shows it the moment it takes the card's place.
    void el.decode().catch(() => undefined);
    // As wide as the square the sheet is drawn on, and as deep as the land and its margin, in its middle.
    el.style.top = `${((1 - 1 / Math.max(1, aspect)) * 50).toFixed(3)}%`;
    el.style.height = `${(100 / Math.max(1, aspect)).toFixed(3)}%`;
    ground.after(el);
    chosen = { el, aspect };
  }
  /** The sheet's paper as it is painted now, in the sheet's shape: the middle of the square it is drawn on. */
  function face(): HTMLCanvasElement {
    const shape = Math.max(1, Number.parseFloat(sheetEl.style.getPropertyValue("--aspect")) || 1);
    const h = Math.max(1, Math.round(device / shape));
    const c = document.createElement("canvas");
    c.width = device;
    c.height = h;
    (c.getContext("2d") as CanvasRenderingContext2D).drawImage(ground, 0, (device - h) / 2, device, h, 0, 0, device, h);
    return c;
  }

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

  // ---------- the pace: every stroke one after another, at a hand's pace ----------
  const names = pacer<string>(PACED.name);
  const strokes = pacer<{ readonly path: string; readonly mark: Mark }>(PACED.pencil);
  const surveys = pacer<string>(PACED.survey);
  const washesDue = pacer<readonly [string, number]>(PACED.wash);
  const pacers: readonly Pacer<unknown>[] = [names, strokes, surveys, washesDue];
  let ticking = 0;
  /** Draws whatever is due, and wakes again when the next stroke is. */
  function tick(): void {
    ticking = 0;
    const now = performance.now();
    for (const path of names.due(now)) letterNow(path);
    for (const { path, mark } of strokes.due(now)) drawMark(path, mark);
    for (const area of surveys.due(now)) survey(area);
    const due = washesDue.due(now);
    if (due.length > 0) settle(Object.fromEntries(due));
    const next = Math.min(...pacers.map((q) => q.next() ?? Infinity));
    if (Number.isFinite(next)) ticking = window.setTimeout(tick, Math.max(16, next - now));
    else for (const resolve of paced.splice(0)) resolve();
  }
  /** Something new is queued: draw from now. */
  const pace = (): void => {
    window.clearTimeout(ticking);
    ticking = window.setTimeout(tick, 0);
  };
  const paced: (() => void)[] = [];
  /** Resolves once every queued stroke has been drawn. */
  const allPaced = (): Promise<void> => (pacers.every((q) => q.size === 0) ? Promise.resolve() : new Promise((resolve) => paced.push(resolve)));

  // ---------- the pencil: what Jev is doing to the code ----------
  /** Each file's ground, each area's files, and each area's border as the pen eased it, in meters. */
  let patchOf = new Map<string, FilePatch>();
  let filesOf = new Map<string, string[]>();
  let ringsOf = new Map<string, readonly (readonly number[])[]>();
  /** How thick the pencil is, in meters: as thin as a hair on the sheet. */
  let lead = 0.5;
  /** Each file read so far: its last mark, and the slice of the pass it was last read in. */
  const reading = new Map<string, { mark: Mark; slice: number }>();
  const sketched = new Set<string>();
  const surveyed = new Set<string>();
  let slices = 0;
  /** Each file's pencil marks, until its own wash covers them; and the files washed already, never drawn over again. */
  const marksOf = new Map<string, SVGGElement>();
  const washedOver = new Set<string>();
  /** Each area's survey, until its ground's wash covers it. */
  const surveyOf = new Map<string, SVGGElement>();
  const pencilLand = (): SVGGElement | null => pencilEl.querySelector("g.land");

  /** An area is being asked about: each of its files is sketched round. */
  function asked(areas: readonly string[]): void {
    const now = performance.now();
    for (const area of areas) {
      if (sketched.has(area)) continue;
      sketched.add(area);
      strokes.add((filesOf.get(area) ?? []).map((path) => ({ path, mark: "sketch" as const })), now);
    }
    pace();
  }

  /**
   * A slice of the understanding pass read these files and areas. A file is first hatched (its links); read again in a
   * later pass it is cross-hatched (itself), and again, ringed (the closer reading Jev asked for). A slice reads what
   * the one before held a second time, so only a reading two slices after the last counts as another.
   */
  function read(files: readonly string[], areas: readonly string[]): void {
    slices++;
    const now = performance.now();
    const marks: { readonly path: string; readonly mark: Mark }[] = [];
    for (const path of files) {
      const r = reading.get(path);
      if (r === undefined) {
        reading.set(path, { mark: "hatch", slice: slices });
        marks.push({ path, mark: "hatch" });
        continue;
      }
      const next: Mark | null = r.mark === "hatch" ? "cross" : r.mark === "cross" ? "closer" : null;
      if (next !== null && slices - r.slice >= 2) {
        r.mark = next;
        marks.push({ path, mark: next });
      }
      r.slice = slices;
    }
    strokes.add(marks, now);
    surveys.add(
      areas.filter((a) => !surveyed.has(a) && (surveyed.add(a), true)),
      now,
    );
    pace();
  }

  /** One pencil mark over a file's ground, drawn as a stroke goes. */
  function drawMark(path: string, mark: Mark): void {
    const p = patchOf.get(path);
    const host = pencilLand();
    if (p === undefined || host === null || washedOver.has(path)) return;
    let g = marksOf.get(path);
    if (g === undefined) {
      g = document.createElementNS(SVG, "g");
      host.append(g);
      marksOf.set(path, g);
    }
    const r = rand(seedOf(`pencil:${mark}:${path}`));
    const f = (v: number): string => v.toFixed(2);
    let d = "";
    if (mark === "sketch" || mark === "closer") {
      // A loop round the ground, as a hand draws one: a little uneven, and running on past where it began.
      const radius = p.radius * (mark === "sketch" ? PENCIL.round : PENCIL.closer);
      const start = r.range(0, Math.PI * 2);
      const [a, b] = [r.range(0, Math.PI * 2), r.range(0, Math.PI * 2)];
      for (let k = 0; k <= 30; k++) {
        const t = start + (k / 30) * Math.PI * 2.12;
        const rr = radius * (1 + 0.05 * Math.sin(3 * t + a) + 0.03 * Math.sin(7 * t + b));
        d += `${k === 0 ? "M" : "L"}${f(p.x + Math.cos(t) * rr)} ${f(p.z + Math.sin(t) * rr)}`;
      }
    } else {
      // Parallel strokes across the ground, the cross-hatching the other way.
      const radius = p.radius * PENCIL.round;
      const angle = (mark === "hatch" ? 0.87 : -0.7) + r.range(-0.08, 0.08);
      const [dx, dz] = [Math.cos(angle), Math.sin(angle)];
      const n = Math.max(2, Math.min(9, Math.round((radius * 2) / PENCIL.hatch)));
      for (let k = 1; k <= n; k++) {
        const o = -radius + (k * 2 * radius) / (n + 1);
        const half = Math.sqrt(Math.max(0, radius * radius - o * o)) * 0.85;
        const [cx, cz] = [p.x - dz * o, p.z + dx * o];
        d += `M${f(cx - dx * half)} ${f(cz - dz * half)}L${f(cx + dx * half)} ${f(cz + dz * half)}`;
      }
    }
    const line = document.createElementNS(SVG, "path");
    line.setAttribute("d", d);
    line.setAttribute("pathLength", "1");
    line.setAttribute("stroke-width", f(lead));
    line.style.transitionDuration = `${PENCIL.ms}ms`;
    g.append(line);
    show(line);
  }

  /** An area reached by the folder pass: short hachures inside its border, all the way round. */
  function survey(area: string): void {
    const host = pencilLand();
    const rings = ringsOf.get(area);
    if (host === null || rings === undefined || rings.length === 0) return;
    let [cx, cz, m] = [0, 0, 0];
    for (const ring of rings) for (let q = 0; q < ring.length; q += 2, m++) [cx, cz] = [cx + (ring[q] as number), cz + (ring[q + 1] as number)];
    [cx, cz] = [cx / Math.max(1, m), cz / Math.max(1, m)];
    const f = (v: number): string => v.toFixed(2);
    let d = "";
    for (const ring of rings) {
      let along = PENCIL.survey.every / 2;
      for (let q = 2; q < ring.length; q += 2) {
        const [x0, z0, x1, z1] = [ring[q - 2] as number, ring[q - 1] as number, ring[q] as number, ring[q + 1] as number];
        along += Math.hypot(x1 - x0, z1 - z0);
        if (along < PENCIL.survey.every) continue;
        along = 0;
        const toward = Math.hypot(cx - x1, cz - z1);
        if (toward < PENCIL.survey.tick * 2) continue;
        const [ux, uz] = [(cx - x1) / toward, (cz - z1) / toward];
        d += `M${f(x1 + ux * 0.6)} ${f(z1 + uz * 0.6)}L${f(x1 + ux * (0.6 + PENCIL.survey.tick))} ${f(z1 + uz * (0.6 + PENCIL.survey.tick))}`;
      }
    }
    if (d === "") return;
    const line = document.createElementNS(SVG, "path");
    line.setAttribute("d", d);
    line.setAttribute("pathLength", "1");
    line.setAttribute("stroke-width", f(lead));
    line.style.transitionDuration = `${PENCIL.ms * 2}ms`;
    const g = document.createElementNS(SVG, "g");
    g.append(line);
    host.append(g);
    surveyOf.set(area, g);
    show(line);
  }

  /** The wash has come over these files' ground and these areas': their pencil fades under it. */
  function washOver(l: Land, cells: CellBox, grounds: readonly string[]): void {
    for (const [path, g] of marksOf) {
      const p = patchOf.get(path);
      if (p === undefined) continue;
      const i = Math.floor((p.x + l.reach) / CELL);
      const j = Math.floor((p.z + l.reach) / CELL);
      if (i < cells[0] || i > cells[2] || j < cells[1] || j > cells[3] || l.health.paint(j * l.n + i) < 0.5) continue;
      g.classList.add("washed");
      marksOf.delete(path);
      washedOver.add(path);
    }
    for (const area of grounds) surveyOf.get(area)?.classList.add("washed");
  }

  // ---------- the land is divided ----------
  function divide(size: number, aspect: number | undefined, outlines: readonly Outline[], patches: readonly FilePatch[], lots: readonly LotPlace[]): void {
    const reach = size / 2 + MARGIN;
    // The sheet opened in the shape the land was to have; a land of another shape reshapes it.
    const shape = Math.max(1, reach / (size / 2 / (aspect ?? 1) + MARGIN));
    sheetEl.style.setProperty("--aspect", shape.toFixed(4));
    // The chosen map stays as the sheet's paint, the world's own paint laid over it as it comes, unless the land has
    // grown into another shape since it was pictured.
    if (chosen !== null && Math.abs(chosen.aspect - shape) > 0.01) {
      chosen.el.classList.add("gone");
      chosen = null;
    }
    layPaper(reach);
    ink.setAttribute("viewBox", `${-reach} ${-reach} ${reach * 2} ${reach * 2}`);
    let rim = "";
    rimPoints({ size, ...(aspect === undefined ? {} : { aspect }) }, 3).forEach(([x, z], q) => (rim += `${q === 0 ? "M" : "L"}${x.toFixed(1)} ${z.toFixed(1)}`));
    rim += "Z";
    ink.innerHTML = `<defs><clipPath id="wait-land"><path d="${rim}"/></clipPath></defs><g clip-path="url(#wait-land)"></g>`;
    const pens = ink.lastElementChild as SVGGElement;
    const perPixel = (reach * 2) / side;
    // The pencil works on the same land, inside the same rim, as thin as the finest pen line.
    pencilEl.setAttribute("viewBox", `${-reach} ${-reach} ${reach * 2} ${reach * 2}`);
    pencilEl.innerHTML = `<g class="land" clip-path="url(#wait-land)"></g>`;
    lead = perPixel * 0.75;
    patchOf = new Map(patches.map((p) => [p.path, p]));
    filesOf = new Map();
    for (const p of patches) filesOf.set(p.area, [...(filesOf.get(p.area) ?? []), p.path]);

    ready = new Promise((resolve) =>
      work(
        (function* (): Generator<void> {
          // The outlines follow the lattice they were traced on, a point a meter: eased into a pen's line, and every
          // other point kept, still finer than a pixel on the sheet.
          const eased: (readonly (readonly number[])[])[] = [];
          // Each area's border as the field map draws it, never along the land's own edge.
          const borders: string[] = [];
          const edge = { size, ...(aspect === undefined ? {} : { aspect }) };
          for (const [i, o] of outlines.entries()) {
            eased.push(o.rings.map((r) => thin(easeRing(r))));
            borders.push(borderPath(o.rings, edge));
            if (i % 4 === 3) yield;
          }
          ringsOf = new Map(outlines.flatMap((o, i) => (o.depth > 0 ? [[o.path, eased[i] ?? []] as const] : [])));
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
            line.setAttribute("d", borders[i] ?? "");
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
          const named = yield* nameLand(outlines, size, reach, lots, aspect);
          const { at, n } = named;
          const nearest = nearestAreas(at, n);
          yield;
          const fade = yield* fadeMask(STYLE, aspect ?? 1);
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
          land = { reach, ...(aspect === undefined ? {} : { aspect }), device, k: device / PAPER, n, paths, lands: paths.map((p) => landWash(STYLE, p)), nearest, washes, fade, health, under: under.getContext("2d") as CanvasRenderingContext2D, names: null };
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
            h.stroke(new Path2D(borders[i] ?? ""));
            yield;
          }
          show(hedges);
          yield;

          // Every name's place, worked out once as the field map places them on its whole sheet, the same size as this
          // one, so a name lettered later never moves one lettered before it.
          land.names = yield* letterNames(named);
          names.add([...land.names.keys()].filter((p) => namesWaiting.has(p)), performance.now());
          namesWaiting.clear();
          pace();
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
      washOver(l, box, grounds);
    }
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
    const sheet: WashSheet = { reach: l.reach, half: l.reach - MARGIN, ...(l.aspect === undefined ? {} : { aspect: l.aspect }), n: l.n, cell: CELL, nearest: l.nearest, areas: [...l.washes], fade: l.fade };
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
  /** When the last name was lettered, and the names asked for so far. */
  let lastName = 0;
  const lettering = new Set<string>();
  /** An area's last answer is in: its name is lettered in its turn, at the pace names are lettered. */
  function letter(path: string): void {
    if (lettering.has(path)) return;
    lettering.add(path);
    names.add([path], performance.now());
    pace();
  }
  function letterNow(path: string): void {
    if (land?.names === null || land?.names === undefined) {
      namesWaiting.add(path);
      return;
    }
    const el = land.names.get(path);
    if (el === undefined || el.dataset.due !== undefined) return;
    el.dataset.due = "";
    namesEl.append(el);
    show(el);
    lastName = performance.now();
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
      const zoom = side / (l.reach * 2);
      // The pen sets out over the rivers and the trails at once, while the relief is painted out of sight.
      const pens = penLines(l, stood, zoom);
      const pensDone = wait(pens.ms);
      layers.append(pens.svg);
      show(pens.svg);
      // Over the washes as they finally lie, so the relief comes in over exactly what is there.
      await allPaced();
      await allWashed();
      const sx = (x: number): number => (x + l.reach) * zoom;
      const sheetOf = (from: CanvasImageSource): CanvasRenderingContext2D => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = l.device;
        const c = canvas.getContext("2d") as CanvasRenderingContext2D;
        c.drawImage(from, 0, 0);
        return c;
      };
      // The relief washes in over each area's own ground, from the middle outward, under the pen's lines: each area as
      // soon as it is cut, at its time from the first.
      const washes: HTMLCanvasElement[] = [];
      let first = 0;
      const lay = (layer: HTMLCanvasElement, share: number): void => {
        if (washes.length === 0) first = performance.now();
        washes.push(layer);
        layer.style.transitionDuration = `${PACE.relief.ms}ms`;
        layer.style.transitionDelay = `${Math.max(0, Math.round(first + share * PACE.relief.spreadMs - performance.now()))}ms`;
        layers.insertBefore(layer, pens.svg);
        show(layer);
      };
      const whole = await new Promise<HTMLCanvasElement>((resolve) =>
        work(
          (function* (): Generator<void> {
            // What washes in over the areas: the hills and the ponds, the contours over them and the trees. And the
            // whole relief as the field map draws it, the rivers and the trails too, laid over once it is all in.
            const lands = sheetOf(ground);
            const contours = yield* paintRelief(lands, stood.terrain, STYLE, l.reach, l.device);
            const whole = sheetOf(lands.canvas);
            whole.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawRivers(whole, stood.terrain.streams, sx, sx, zoom);
            yield;
            for (const c of [lands, whole]) {
              c.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (side / 2), dpr * (side / 2));
              strokeContours(c, contours, zoom, STYLE);
              c.setTransform(dpr, 0, 0, dpr, 0, 0);
              yield;
            }
            drawTrails(whole, stood.ways, sx, sx, zoom, 1, STYLE);
            for (const c of [lands, whole]) drawTrees(c, stood.trees, sx, sx, zoom, 1, STYLE, () => true);
            yield;
            yield* reliefWashes(l, lands.canvas, lay);
            resolve(whole.canvas);
          })(),
        ),
      );
      await Promise.all([wait(first + PACE.relief.spreadMs + PACE.relief.ms - performance.now()), pensDone]);
      // Then the sheet keeps the field map's own drawing of all of it, in the frame the washes and the pen's lines go:
      // the same but for where a line crosses a tree.
      groundCtx.drawImage(whole, 0, 0);
      for (const layer of [...washes, pens.svg]) layer.remove();
    })();
  }

  /**
   * The relief over each area's own ground, as the cells divide the sheet, feathered a little past it so neighbors
   * coming in overlap softly: each a layer handed to `lay` as it is cut, nearest the middle first, with its share of
   * the way out. Every pixel is wholly inside one area's layer, so once all are in the sheet is the relief exactly.
   */
  function* reliefWashes(l: Land, from: HTMLCanvasElement, lay: (layer: HTMLCanvasElement, share: number) => void): Generator<void> {
    const { n, nearest } = l;
    const cellPx = (CELL * l.device) / (l.reach * 2);
    const boxes = new Map<number, { i0: number; j0: number; i1: number; j1: number; x: number; z: number; m: number }>();
    for (let c = 0; c < n * n; c++) {
      const a = nearest[c] as number;
      if (a < 0) continue;
      const [i, j] = [c % n, Math.floor(c / n)];
      const b = boxes.get(a);
      if (b === undefined) boxes.set(a, { i0: i, j0: j, i1: i, j1: j, x: i, z: j, m: 1 });
      else Object.assign(b, { i0: Math.min(b.i0, i), j0: Math.min(b.j0, j), i1: Math.max(b.i1, i), j1: Math.max(b.j1, j), x: b.x + i, z: b.z + j, m: b.m + 1 });
    }
    yield;
    const pad = Math.ceil(FEATHER.reach + FEATHER.soft * 3);
    const order = [...boxes].sort(([, a], [, b]) => Math.hypot(a.x / a.m - n / 2, a.z / a.m - n / 2) - Math.hypot(b.x / b.m - n / 2, b.z / b.m - n / 2));
    for (const [q, [a, b]] of order.entries()) {
      const [i0, j0, i1, j1] = [Math.max(0, b.i0 - pad), Math.max(0, b.j0 - pad), Math.min(n - 1, b.i1 + pad), Math.min(n - 1, b.j1 + pad)];
      const [cols, rows] = [i1 - i0 + 1, j1 - j0 + 1];
      // Its own cells, and the same reached a little farther, a pixel a cell.
      const own = new ImageData(cols, rows);
      const reached = new ImageData(cols, rows);
      const r = FEATHER.reach;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (nearest[j * n + i] !== a) continue;
          own.data[((j - j0) * cols + (i - i0)) * 4 + 3] = 255;
          for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (di * di + dj * dj <= r * r && i + di >= i0 && i + di <= i1 && j + dj >= j0 && j + dj <= j1) reached.data[((j + dj - j0) * cols + (i + di - i0)) * 4 + 3] = 255;
        }
      }
      // The reach softened into a feather a pixel a cell, where a blur is cheap, and its own ground whole.
      const [cells, soft] = [document.createElement("canvas"), document.createElement("canvas")];
      cells.width = soft.width = cols;
      cells.height = soft.height = rows;
      (cells.getContext("2d") as CanvasRenderingContext2D).putImageData(reached, 0, 0);
      const sc = soft.getContext("2d") as CanvasRenderingContext2D;
      sc.filter = `blur(${FEATHER.soft}px)`;
      sc.drawImage(cells, 0, 0);
      (cells.getContext("2d") as CanvasRenderingContext2D).putImageData(own, 0, 0);
      // In whole pixels of the sheet, so the layer lies on it exactly: the feather drawn smooth, its own ground
      // whole over it, then the relief cut to the two.
      const [x0, y0] = [Math.floor(i0 * cellPx), Math.floor(j0 * cellPx)];
      const [x1, y1] = [Math.min(l.device, Math.ceil((i1 + 1) * cellPx)), Math.min(l.device, Math.ceil((j1 + 1) * cellPx))];
      const layer = document.createElement("canvas");
      layer.width = x1 - x0;
      layer.height = y1 - y0;
      const c = layer.getContext("2d") as CanvasRenderingContext2D;
      const [ox, oy, w, h] = [i0 * cellPx - x0, j0 * cellPx - y0, cols * cellPx, rows * cellPx];
      c.drawImage(soft, ox, oy, w, h);
      c.imageSmoothingEnabled = false;
      c.drawImage(cells, ox, oy, w, h);
      c.globalCompositeOperation = "source-in";
      c.drawImage(from, x0, y0, layer.width, layer.height, 0, 0, layer.width, layer.height);
      layer.className = "wait-layer";
      layer.style.left = `${(x0 / l.device) * 100}%`;
      layer.style.top = `${(y0 / l.device) * 100}%`;
      layer.style.width = `${(layer.width / l.device) * 100}%`;
      layer.style.height = `${(layer.height / l.device) * 100}%`;
      lay(layer, q / Math.max(1, order.length - 1));
      yield;
    }
  }

  /**
   * The pen's lines over the relief: each river from its source to its mouth in the field map's bank, water and
   * glint, the longest first, then each trail along its way in its dots, at the pen's pace; with how long the pen
   * takes over them all.
   */
  function penLines(l: Land, stood: StoodWorld, zoom: number): { readonly svg: SVGSVGElement; readonly ms: number } {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "wait-pens");
    svg.setAttribute("viewBox", `${-l.reach} ${-l.reach} ${l.reach * 2} ${l.reach * 2}`);
    const f = (v: number): string => v.toFixed(2);
    /** A line's length on the sheet, and how long the pen takes over it. */
    const timed = (points: readonly (readonly [number, number])[], pace: { readonly pxPerMs: number; readonly ms: readonly [number, number] }): number => {
      let length = 0;
      for (let k = 1; k < points.length; k++) length += Math.hypot((points[k] as [number, number])[0] - (points[k - 1] as [number, number])[0], (points[k] as [number, number])[1] - (points[k - 1] as [number, number])[1]);
      return Math.max(pace.ms[0], Math.min(pace.ms[1], (length * zoom) / pace.pxPerMs));
    };
    const pen = (d: string, stroke: string, width: number, ms: number, delay: number, extra = ""): string =>
      `<path class="pen" d="${d}" pathLength="1" stroke="${stroke}" stroke-width="${f(width / zoom)}" style="transition-duration:${Math.round(ms)}ms;transition-delay:${Math.round(delay)}ms"${extra}/>`;
    let end = 0;
    let html = "";
    // Rivers, as `drawRivers` draws them: the same course and the same three strokes.
    const streams = [...stood.terrain.streams].filter((s) => s.stations.length > 1).sort((a, b) => b.stations.length - a.stations.length);
    streams.forEach((stream, q) => {
      const st = stream.stations;
      const d = riverCourse(st, (x, z) => [x, z]);
      const ms = timed(
        st.map((s) => [s.x, s.z] as const),
        PACE.rivers,
      );
      const delay = PACE.rivers.startMs + q * PACE.rivers.gapMs;
      end = Math.max(end, delay + ms);
      for (const stroke of riverStrokes(st, zoom)) html += pen(d, stroke.color, stroke.width, ms, delay);
    });
    // Trails, as `drawTrails` dots them, shown through a mask the pen draws along each.
    const stride = Math.max(2, Math.round(3 / zoom)) * 2;
    let dots = "";
    let reveal = "";
    stood.ways.forEach((trail, q) => {
      const p = trail.points;
      const points: [number, number][] = [];
      for (let k = 0; k < p.length; k += stride) points.push([p[k] as number, p[k + 1] as number]);
      if (points.length < 2) return;
      const d = points.map(([x, z], k) => `${k === 0 ? "M" : "L"}${f(x)} ${f(z)}`).join("");
      const width = 1.9 + trail.style.width * 0.35;
      const ms = timed(points, PACE.trails);
      const delay = PACE.trails.startMs + q * PACE.trails.gapMs;
      end = Math.max(end, delay + ms);
      dots += `<path d="${d}" fill="none" stroke="${STYLE.trail}" stroke-width="${f(width / zoom)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${f(0.1 / zoom)} ${f(5.5 / zoom)}"/>`;
      reveal += pen(d, "#fff", width * 4, ms, delay);
    });
    const box = `x="${-l.reach}" y="${-l.reach}" width="${l.reach * 2}" height="${l.reach * 2}"`;
    svg.innerHTML = `<defs><mask id="wait-trails" maskUnits="userSpaceOnUse" ${box}>${reveal}</mask></defs>${html}<g mask="url(#wait-trails)">${dots}</g>`;
    return { svg, ms: end };
  }

  return {
    opening(o) {
      if (o.stage === "land") divide(o.size, o.aspect, o.areas, o.patches, o.lots);
      else if (o.stage === "health") {
        washesDue.add(Object.entries(o.vitality), performance.now());
        pace();
      } else if (o.stage === "asking") {
        asked(o.asking);
        for (const path of Object.keys(o.settled)) letter(path);
      } else if (o.stage === "understood") read(o.files, o.areas);
    },
    baking(health) {
      // The world is ready to bake: whatever is still queued is drawn quickly now, so the pace never holds it back.
      const now = performance.now();
      washesDue.add(Object.entries(health), now);
      for (const q of pacers) q.flush(now);
      pace();
      // Every area is settled now: each name not yet lettered is, the largest area's first.
      void ready.then(() => {
        for (const path of land?.names?.keys() ?? []) letter(path);
        names.flush(performance.now());
        pace();
      });
    },
    chosen: choose,
    face,
    marks: drawMarks,
    stood: relief,
    night(n) {
      veil.style.setProperty("--night", n.toFixed(2));
    },
    async lift() {
      await ready;
      await Promise.all([marksDrawn, reliefShown, allPaced()]);
      // And every name asked for written: the last is lettered over as long as the pen takes over a name.
      await wait(Math.max(0, lastName + PACE.nameMs - performance.now()));
      await wait(PACE.restMs);
      sheetEl.classList.add("folding");
      veil.classList.add("lifted");
      await wait(PACE.foldMs);
      // Nothing of the wait keeps animating, or holds its canvases, under the world.
      veil.replaceChildren();
    },
    sheet: () => sheetEl.getBoundingClientRect(),
  };
}
