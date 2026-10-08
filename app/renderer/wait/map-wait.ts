// The map paints itself: the wait is the field map's sheet, in the direction
// the map shows (`ink.ts`), lying on its creased paper. While the code is
// read, light moves over the empty sheet (leaf-light by day, the lantern's
// pool at night). As soon as the land is divided, a pen draws the land's edge
// and then each area's border, and the wild's wood is brushed in past the
// edge; each area washes in with the color of the land Jev judged for it as
// its judgments settle; while the world bakes, the washes dry; then the map
// folds away and the paper dissolves into the world, as a jump on the map
// does.
//
// Each area's wash is its own small canvas over its own ground (its land
// less its subdirectories'), painted in idle moments once its land is judged
// and shown by a CSS opacity transition, and each border is an SVG path
// drawn by a CSS transition of its dash: nothing here redraws per frame, so
// a busy page thread never stalls it.

import type { Outline } from "@gaia/terrain";
import { WAIT_INK } from "./ink.ts";
import type { WaitView } from "./wait.ts";

/** How the map paints itself, ms: the land's edge, each border's pen stroke and the most the pen staggers over all of them, a wash coming in, the least time between two washes, and the paper folding away. */
const PACE = { edgeMs: 1500, penMs: 1300, penSpreadMs: 2100, washMs: 1300, washGapMs: 70, dryMs: 700, foldMs: 1100 };

const SVG = "http://www.w3.org/2000/svg";
const parentOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
const idle = (step: () => void): void => {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(step, { timeout: 200 });
  else window.setTimeout(step, 16);
};

interface Area {
  readonly path: string;
  readonly depth: number;
  readonly rings: readonly (readonly number[])[];
  /** Its middle, for the order washes come in when they settle together. */
  readonly x: number;
  readonly z: number;
  /** When its border is drawn, ms after the land arrived. */
  readonly inkedAt: number;
  /** The land judged for its ground, once it is. */
  land: string | null;
  /** Its wash, once painted; null for an area the wait has no color for, which stays bare paper. */
  canvas: HTMLCanvasElement | null | undefined;
  shown: boolean;
}

/** A ring as an SVG path through the middles of its edges, bending at its corners, as a pen draws it. */
function pathOf(rings: readonly (readonly number[])[], wobble: number): string {
  let d = "";
  for (const ring of rings) {
    const count = ring.length / 2;
    if (count < 3) continue;
    const at = (k: number): [number, number] => {
      const i = ((k % count) + count) % count;
      const j = wobble * (hash(i, count) - 0.5);
      return [(ring[i * 2] as number) + j, (ring[i * 2 + 1] as number) - j];
    };
    const f = (v: number): string => v.toFixed(1);
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

export function createMapWait(veil: HTMLElement): WaitView {
  veil.innerHTML = /* html */ `
    <div class="wait-paper"></div>
    <div class="wait-sheet">
      <div class="wait-body"><canvas class="wait-sheet-paper"></canvas><div class="wait-washes"></div><canvas class="wait-brush"></canvas><svg class="wait-ink" xmlns="${SVG}"></svg></div>
      <div class="wait-fold"></div>
    </div>
    <div class="wait-dapple"></div>
    <div class="wait-lantern"></div>`;
  veil.style.setProperty("--wet", WAIT_INK.wet.toFixed(2));
  veil.style.setProperty("--dry", WAIT_INK.dry.toFixed(2));
  const sheet = veil.querySelector(".wait-sheet") as HTMLElement;
  sheet.style.setProperty("--deckle", WAIT_INK.deckle);
  const washes = veil.querySelector(".wait-washes") as HTMLElement;
  const ink = veil.querySelector(".wait-ink") as SVGSVGElement;
  const brush = veil.querySelector(".wait-brush") as HTMLCanvasElement;
  const sideOf = (): number => sheet.clientWidth || Math.min(window.innerWidth * 0.94, window.innerHeight * 0.9, 980);
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  // The sheet's paper, painted once at its size, as the map's paper is painted.
  const paper = veil.querySelector(".wait-sheet-paper") as HTMLCanvasElement;
  paper.width = paper.height = Math.max(1, Math.round(sideOf() * dpr));
  WAIT_INK.paper(paper.getContext("2d") as CanvasRenderingContext2D, paper.width, paper.height);

  let areas: Area[] = [];
  let landAt = 0;
  let reach = 1;
  /** Areas whose land is judged and whose things have all settled, waiting for their turn to wash in. */
  const queue: Area[] = [];
  /** What has settled, by area: kept until the land arrives if it comes first. */
  const settled = new Map<string, string>();
  let everything = false;
  let lastShown = 0;
  let pump = 0;
  let painting = 0;
  let resolveShown: (() => void) | null = null;
  const allShown = new Promise<void>((r) => (resolveShown = r));

  /** Paints one area's wash onto its own canvas, over its own ground only, in the color of its land. */
  function paintWash(a: Area): void {
    const rgb = a.land === null ? null : WAIT_INK.wash(a.path, a.land);
    if (rgb === null) {
      a.canvas = null;
      return;
    }
    const side = sideOf();
    const px = (side * dpr) / (reach * 2);
    // Its own ground: its outline less its subdirectories', so no wash lies under another.
    const holes = areas.filter((c) => c.depth === a.depth + 1 && parentOf(c.path) === a.path);
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const ring of a.rings) {
      for (let k = 0; k < ring.length; k += 2) {
        x0 = Math.min(x0, ring[k] as number);
        x1 = Math.max(x1, ring[k] as number);
        z0 = Math.min(z0, ring[k + 1] as number);
        z1 = Math.max(z1, ring[k + 1] as number);
      }
    }
    if (!Number.isFinite(x0)) {
      a.canvas = null;
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.className = "wash";
    canvas.width = Math.max(1, Math.ceil((x1 - x0) * px));
    canvas.height = Math.max(1, Math.ceil((z1 - z0) * px));
    canvas.style.left = `${((x0 + reach) / (reach * 2)) * 100}%`;
    canvas.style.top = `${((z0 + reach) / (reach * 2)) * 100}%`;
    canvas.style.width = `${((x1 - x0) / (reach * 2)) * 100}%`;
    canvas.style.height = `${((z1 - z0) / (reach * 2)) * 100}%`;
    canvas.style.transformOrigin = `${(((a.x - x0) / Math.max(1e-6, x1 - x0)) * 100).toFixed(1)}% ${(((a.z - z0) / Math.max(1e-6, z1 - z0)) * 100).toFixed(1)}%`;
    const g = canvas.getContext("2d") as CanvasRenderingContext2D;
    g.setTransform(px, 0, 0, px, -x0 * px, -z0 * px);
    const path = new Path2D(pathOf([...a.rings, ...holes.flatMap((h) => h.rings)], 0));
    g.fillStyle = `rgb(${rgb.join(",")})`;
    g.fill(path, "evenodd");
    // Pigment pools at the rim as it dries: soft strokes of a deeper tone, kept inside its ground.
    g.save();
    g.clip(path, "evenodd");
    const rim = rgb.map((c) => Math.round(c * 0.6)).join(",");
    const scale = (side * dpr) / 2048 / px;
    for (const [width, alpha] of WAIT_INK.pool) {
      g.lineWidth = Math.max(0.5 / px, width * scale * 1.6);
      g.strokeStyle = `rgba(${rim},${alpha})`;
      g.stroke(path);
    }
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-atop";
    // Brushwork, as the map lays its washes: broad strokes, each a little warmer or cooler, lighter or darker.
    const sheetPx = side * dpr;
    const brushScale = sheetPx / 2048;
    const strokes = Math.round((WAIT_INK.strokes * canvas.width * canvas.height) / sheetPx ** 2);
    const seed = hash(a.x, a.z) * 1000;
    g.lineCap = "round";
    for (let k = 0; k < strokes; k++) {
      const x = hash(k, 71 + seed) * canvas.width;
      const y = hash(71 + seed, k) * canvas.height;
      const angle = -0.5 + (hash(k, 72 + seed) - 0.5) * 0.9;
      const len = (50 + hash(k, 73 + seed) * 120) * brushScale;
      const tone = hash(k, 74 + seed);
      g.strokeStyle = tone < 0.3 ? "rgba(255,236,170,0.09)" : tone < 0.55 ? "rgba(70,110,120,0.07)" : tone < 0.8 ? "rgba(255,255,240,0.08)" : "rgba(70,56,30,0.07)";
      g.lineWidth = (12 + hash(k, 75 + seed) * 22) * brushScale;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(angle) * len * 0.5, y + Math.sin(angle) * len * 0.5, x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      g.stroke();
    }
    // Granulation: pigment settles unevenly into the paper's tooth, in specks of a fixed size on the sheet and a few broad blooms.
    for (const [cells, strength, grainSeed] of [[Math.max(8, Math.round(canvas.width / 5)), 0.09, 3.1], [Math.max(4, Math.round(canvas.width / 60)), 0.1, 9.7]] as const) {
      g.globalAlpha = strength;
      g.drawImage(WAIT_INK.grain(cells, grainSeed + a.depth), 0, 0, canvas.width, canvas.height);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    washes.append(canvas);
    a.canvas = canvas;
  }

  /** Paints the settled areas' washes a few at a time while the page is idle. */
  function paintSome(deadline?: IdleDeadline): void {
    painting = 0;
    const left = (): number => deadline?.timeRemaining() ?? 4;
    do {
      const next = queue.find((a) => a.canvas === undefined);
      if (next === undefined) break;
      paintWash(next);
    } while (left() > 3);
    if (queue.some((a) => a.canvas === undefined)) schedulePaint();
    schedulePump();
  }
  function schedulePaint(): void {
    if (painting !== 0) return;
    painting = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(paintSome, { timeout: 120 }) : window.setTimeout(() => paintSome(), 16);
  }

  /** Shows the next settled area once its border is drawn and its wash painted, and not sooner than the last one's gap. */
  function showNext(): void {
    pump = 0;
    const now = performance.now();
    const due = queue.findIndex((a) => a.canvas !== undefined && now - landAt >= a.inkedAt);
    if (due >= 0 && now - lastShown >= PACE.washGapMs) {
      const [a] = queue.splice(due, 1) as [Area];
      a.shown = true;
      lastShown = now;
      a.canvas?.classList.add("shown");
    }
    if (everything && queue.length === 0 && areas.every((a) => a.shown)) {
      resolveShown?.();
      return;
    }
    if (queue.length > 0) schedulePump();
  }
  function schedulePump(): void {
    if (pump === 0 && queue.length > 0) pump = window.setTimeout(showNext, PACE.washGapMs);
  }

  /** Areas whose things and land are judged: each joins the queue to wash in with its land's color. */
  function settle(lands: Readonly<Record<string, string>>): void {
    for (const [path, land] of Object.entries(lands)) {
      if (settled.has(path)) continue;
      settled.set(path, land);
      const a = areas.find((o) => o.path === path);
      if (a === undefined || a.shown || queue.includes(a)) continue;
      a.land = land;
      queue.push(a);
    }
    schedulePaint();
    schedulePump();
  }

  /** The land is divided: a pen draws its edge, then every area's border, from the middle outward, and the wild is brushed in. */
  function land(name: string, size: number, outlines: readonly Outline[]): void {
    void name;
    landAt = performance.now();
    reach = size / 2 + WAIT_INK.margin;
    const order = outlines
      .map((o) => {
        const rings = o.rings.map((r) => WAIT_INK.ease(r));
        let x = 0;
        let z = 0;
        let n = 0;
        for (const ring of rings) for (let k = 0; k < ring.length; k += 2, n++) [x, z] = [x + (ring[k] as number), z + (ring[k + 1] as number)];
        return { o, rings, x: x / Math.max(1, n), z: z / Math.max(1, n) };
      })
      .sort((a, b) => a.o.depth - b.o.depth || Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const bordered = order.filter((e) => e.o.depth > 0);
    const step = Math.min(90, PACE.penSpreadMs / Math.max(1, bordered.length));
    ink.setAttribute("viewBox", `${-reach} ${-reach} ${reach * 2} ${reach * 2}`);
    // Meters per CSS pixel on this sheet, for the pen's widths.
    const perPixel = (reach * 2) / sideOf();
    const hand = WAIT_INK.border;
    const pen = (d: string, color: string, width: number, delayMs: number, durationMs: number): void => {
      const line = document.createElementNS(SVG, "path");
      line.setAttribute("d", d);
      line.setAttribute("pathLength", "1");
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", (width * perPixel).toFixed(2));
      line.style.transitionDuration = `${durationMs}ms`;
      line.style.transitionDelay = `${Math.round(delayMs)}ms`;
      ink.append(line);
    };
    // The land's rounded edge first, which the wild's wash then meets.
    let d = "";
    for (let k = 0; k <= 240; k++) {
      const a = (k / 240) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r = size / 2 / Math.pow(Math.abs(c) ** 4 + Math.abs(s) ** 4, 0.25);
      d += `${k === 0 ? "M" : "L"}${(c * r).toFixed(1)} ${(s * r).toFixed(1)}`;
    }
    pen(`${d}Z`, hand.line, hand.width * 1.15, 0, PACE.edgeMs);
    areas = order.map(({ o, rings, x, z }) => {
      const k = bordered.findIndex((e) => e.o === o);
      const inkedAt = o.depth === 0 ? PACE.edgeMs * 0.8 : PACE.edgeMs * 0.5 + k * step + PACE.penMs * 0.75;
      if (o.depth > 0) {
        const path = pathOf(rings, 0);
        const delay = PACE.edgeMs * 0.5 + k * step;
        // Top-level borders a little heavier than those within them; a hedgerow's leaves under its line.
        const weight = o.depth === 1 ? 1.25 : 0.9;
        if (hand.under !== null) pen(path, hand.under, hand.underWidth * weight, delay, PACE.penMs);
        pen(path, hand.line, hand.width * weight, delay, PACE.penMs);
      }
      return { path: o.path, depth: o.depth, rings, x, z, inkedAt, land: null, canvas: undefined, shown: false };
    });
    // The wild past the land's edge, as the map paints it, brushed in after the edge.
    idle(() => {
      brush.width = brush.height = Math.round(sideOf() * dpr);
      WAIT_INK.wild(brush.getContext("2d") as CanvasRenderingContext2D, size, reach);
    });
    // A frame later, so the pen strokes start from nothing.
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add("inked")));
    const known = Object.fromEntries(settled);
    settled.clear();
    settle(known);
  }

  return {
    opening(o) {
      if (o.stage === "land") land(o.name, o.size, o.areas);
      else if (o.stage === "asking") settle(o.settled);
    },
    baking(lands) {
      everything = true;
      // Whatever has not settled settles now: from the middle outward, as the pen went.
      settle(lands);
      // An area with no judged land stays bare paper.
      for (const a of areas) {
        if (a.shown || queue.includes(a)) continue;
        a.canvas = null;
        queue.push(a);
      }
      sheet.classList.add("drying");
      if (areas.length === 0) resolveShown?.();
      schedulePump();
    },
    night(n) {
      veil.style.setProperty("--night", n.toFixed(2));
    },
    async lift() {
      if (areas.length > 0) await allShown;
      await wait(PACE.dryMs);
      sheet.classList.add("folding");
      veil.classList.add("lifted");
      await wait(PACE.foldMs);
      // Nothing of the wait keeps animating, or holds its canvases, under the world.
      veil.replaceChildren();
    },
  };
}
