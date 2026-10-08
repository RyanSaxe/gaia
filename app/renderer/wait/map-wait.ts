// The map paints itself: the wait is the field map's paper. While the code
// is read, light moves over the empty sheet (leaf-light by day, the
// lantern's pool at night). As soon as the land is divided, a pen draws the
// land's edge and then each area's border; each area washes in with its
// watercolor as its judgments settle; while the world bakes, the washes dry;
// then the map folds away and the paper dissolves into the world, as a jump
// on the map does.
//
// Each area's wash is its own small canvas over its own ground (its land
// less its subdirectories'), painted in idle moments as soon as the land is
// known and shown by a CSS opacity transition, and each border is an SVG
// path drawn by a CSS transition of its dash: nothing here redraws per
// frame, so a busy page thread never stalls it.

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

interface Area {
  readonly path: string;
  readonly depth: number;
  readonly rings: readonly (readonly number[])[];
  /** Its middle, for the order washes come in when they settle together. */
  readonly x: number;
  readonly z: number;
  /** When its border is drawn, ms after the land arrived. */
  readonly inkedAt: number;
  canvas: HTMLCanvasElement | null;
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
    <div class="wait-paper"><canvas class="wait-fibres"></canvas><div class="wait-dapple"></div></div>
    <div class="wait-sheet"><div class="wait-washes"></div><canvas class="wait-brush"></canvas><svg class="wait-ink" xmlns="${SVG}"></svg></div>
    <div class="wait-lantern"></div>`;
  const sheet = veil.querySelector(".wait-sheet") as HTMLElement;
  const washes = veil.querySelector(".wait-washes") as HTMLElement;
  const ink = veil.querySelector(".wait-ink") as SVGSVGElement;
  const brush = veil.querySelector(".wait-brush") as HTMLCanvasElement;

  // The sheet's fibres, painted once at the size of the screen.
  const fibres = veil.querySelector(".wait-fibres") as HTMLCanvasElement;
  fibres.width = Math.max(1, Math.round(window.innerWidth));
  fibres.height = Math.max(1, Math.round(window.innerHeight));
  WAIT_INK.paper(fibres.getContext("2d") as CanvasRenderingContext2D, fibres.width, fibres.height);

  let areas: Area[] = [];
  let landAt = 0;
  let reach = 1;
  let tops: string[] = [];
  /** Areas whose judgments have settled, waiting for their turn to wash in. */
  const queue: Area[] = [];
  const settled = new Set<string>();
  let everything = false;
  let lastShown = 0;
  let pump = 0;
  let painting = 0;
  let resolveShown: (() => void) | null = null;
  const allShown = new Promise<void>((r) => (resolveShown = r));

  /** Paints one area's wash onto its own canvas, over its own ground only. */
  function paintWash(a: Area): void {
    const side = sheet.clientWidth || Math.min(window.innerWidth, window.innerHeight) * 0.9;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
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
    if (!Number.isFinite(x0)) return;
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
    const rgb = WAIT_INK.wash(a.path, a.depth, tops);
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
    // Granulation: pigment settles unevenly into the paper's tooth.
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-atop";
    // Specks of a fixed size on the sheet, whatever the area's size, and a few broad blooms.
    for (const [cells, strength, seed] of [[Math.max(8, Math.round(canvas.width / 5)), 0.09, 3.1], [Math.max(4, Math.round(canvas.width / 60)), 0.1, 9.7]] as const) {
      g.globalAlpha = strength;
      g.drawImage(WAIT_INK.grain(cells, seed + a.depth), 0, 0, canvas.width, canvas.height);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    washes.append(canvas);
    a.canvas = canvas;
  }

  /** Paints the washes a few at a time while the page is idle, settled areas first. */
  function paintSome(deadline?: IdleDeadline): void {
    painting = 0;
    const left = (): number => deadline?.timeRemaining() ?? 4;
    do {
      const next = queue.find((a) => a.canvas === null) ?? areas.find((a) => a.canvas === null);
      if (next === undefined) return;
      paintWash(next);
    } while (left() > 3);
    schedulePaint();
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
    const due = queue.findIndex((a) => a.canvas !== null && now - landAt >= a.inkedAt);
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

  function settle(paths: Iterable<string>): void {
    for (const path of paths) {
      if (settled.has(path)) continue;
      settled.add(path);
      const a = areas.find((o) => o.path === path);
      if (a !== undefined && !a.shown && !queue.includes(a)) queue.push(a);
    }
    schedulePaint();
    schedulePump();
  }

  /** The land is divided: a pen draws its edge, then every area's border, from the middle outward. */
  function land(name: string, size: number, outlines: readonly Outline[]): void {
    void name;
    landAt = performance.now();
    reach = size / 2 + Math.max(24, size * 0.05);
    tops = [...new Set(outlines.filter((o) => o.depth > 0).map((o) => o.path.split("/")[0] ?? ""))].sort();
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
    // The pen's width in meters: about a pixel and a third on this sheet, the edge a little heavier.
    const perPixel = (reach * 2) / (sheet.clientWidth || Math.min(window.innerWidth, window.innerHeight) * 0.88);
    // The land's rounded edge first.
    const edge = document.createElementNS(SVG, "path");
    let d = "";
    for (let k = 0; k <= 240; k++) {
      const a = (k / 240) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r = size / 2 / Math.pow(Math.abs(c) ** 4 + Math.abs(s) ** 4, 0.25);
      d += `${k === 0 ? "M" : "L"}${(c * r).toFixed(1)} ${(s * r).toFixed(1)}`;
    }
    edge.setAttribute("d", `${d}Z`);
    edge.setAttribute("pathLength", "1");
    edge.classList.add("edge");
    edge.setAttribute("stroke-width", (1.9 * perPixel).toFixed(2));
    edge.style.transitionDuration = `${PACE.edgeMs}ms`;
    ink.append(edge);
    areas = order.map(({ o, rings, x, z }) => {
      const k = bordered.findIndex((e) => e.o === o);
      const inkedAt = o.depth === 0 ? PACE.edgeMs * 0.8 : PACE.edgeMs * 0.5 + k * step + PACE.penMs * 0.75;
      if (o.depth > 0) {
        const pen = document.createElementNS(SVG, "path");
        pen.setAttribute("d", pathOf(rings, 0));
        pen.setAttribute("pathLength", "1");
        // Top-level borders are inked a little heavier than those within them.
        pen.setAttribute("stroke-width", ((o.depth === 1 ? 1.5 : 1.05) * perPixel).toFixed(2));
        if (o.depth > 1) pen.classList.add("inner");
        pen.style.transitionDuration = `${PACE.penMs}ms`;
        pen.style.transitionDelay = `${Math.round(PACE.edgeMs * 0.5 + k * step)}ms`;
        ink.append(pen);
      }
      return { path: o.path, depth: o.depth, rings, x, z, inkedAt, canvas: null, shown: false };
    });
    // Wild brush past the land's edge, as the map draws it, brushed in after the edge.
    const side = sheet.clientWidth || Math.min(window.innerWidth, window.innerHeight) * 0.9;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    brush.width = brush.height = Math.round(side * dpr);
    const g = brush.getContext("2d") as CanvasRenderingContext2D;
    const px = (v: number): number => ((v + reach) / (reach * 2)) * brush.width;
    const tuft = brush.width / 640;
    g.beginPath();
    for (let k = 0; k < 900; k++) {
      const x = -reach + hash(k, 7) * reach * 2;
      const z = -reach + hash(k, 8) * reach * 2;
      if (Math.abs(x) ** 4 + Math.abs(z) ** 4 < (size / 2 + 6) ** 4) continue;
      for (const lean of [-0.5, 0, 0.45]) {
        g.moveTo(px(x) + lean * 3 * tuft, px(z));
        g.lineTo(px(x) + lean * 6 * tuft, px(z) - (7 + hash(k, lean) * 4) * tuft);
      }
    }
    g.strokeStyle = "rgba(92,104,64,0.32)";
    g.lineWidth = 1.1 * tuft;
    g.lineCap = "round";
    g.stroke();
    // A frame later, so the pen strokes start from nothing.
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add("inked")));
    settle([...settled]);
    schedulePaint();
  }

  return {
    opening(o) {
      if (o.stage === "land") land(o.name, o.size, o.areas);
      else if (o.stage === "asking") settle(o.settled);
    },
    baking() {
      everything = true;
      // Whatever has not settled settles now: from the middle outward, as the pen went.
      settle(areas.map((a) => a.path));
      sheet.classList.add("drying");
      if (areas.length === 0) resolveShown?.();
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
