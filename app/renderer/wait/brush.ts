// The wait's wordless sign that the map is still being drawn: a round
// watercolor brush held over the sheet, with its shadow. It goes to an area
// with a question out to Jev, touches down (its shadow meets its tip), leaves
// a damp dab that dries, hovers and moves on; brisk while answers flow, about
// half as quick in a lull, never still and never saying how much is left. An
// area with a question out takes a pass of clear water first: the paper
// darkens a touch and a soft sheen moves on it until its color drops in. By
// day the brush's shadow falls from the window; at night from the lantern.
//
// Everything that moves is a transform or opacity animation (the Web
// Animations API), so it runs on the compositor while the page bakes; the
// page's thread only picks the next spot every second or two.

const SVG = "http://www.w3.org/2000/svg";

/** An area of the land as the wait holds it: its outline in meters, whether its wash is in, and its own ground's path. */
export interface BrushArea {
  readonly path: string;
  readonly depth: number;
  readonly rings: readonly (readonly number[])[];
  /** Its own ground, its subdirectories' cut out, as an SVG path in meters. */
  readonly ground: string;
  shown: boolean;
}

export interface WaitBrush {
  /** The areas with a question out now; each call is one more message from the judging, so answers set the pace. */
  asking(paths: readonly string[], answered: number): void;
  /** The world bakes now: the brush lifts away and the water dries. */
  baking(): void;
  /** How dark it is, 0 by day to 1 at night: the brush's shadow follows the light. */
  night(n: number): void;
}

/** The brush, lying along +x from its tip at the origin; its shadow is the same silhouette sheared away from the light. */
const BRUSH = `
  <path d="M27 -3.3 L82 -2.1 Q96 -2.6 108 -2.2 Q113 0 108 2.2 Q96 2.6 82 2.1 L27 3.3Z" fill="#7a2f1d"/>
  <path d="M28 -2.2 L82 -1.3 Q96 -1.7 107 -1.4" stroke="rgba(255,214,190,.42)" stroke-width=".8" fill="none"/>
  <path d="M16 -3.5 H27.5 V3.5 H16Z" fill="#b69652"/><path d="M16.2 -3.3 H27.3 V-1.4 H16.2Z" fill="#e2c987"/><path d="M19 -3.5V3.5M24.5 -3.5V3.5" stroke="rgba(80,60,20,.45)" stroke-width=".6"/>
  <path d="M0 0 Q4 -3.4 16.4 -3.5 L16.4 3.5 Q4 3.4 0 0Z" fill="#4a3424"/>
  <path d="M0 0 Q2.6 -1.7 7 -2.2 L7 2.2 Q2.6 1.7 0 0Z" fill="#5d7a48"/>`;
const BRUSH_SHADOW = `<path d="M0 0 Q4 -3.4 16 -3.5 L27 -3.4 L82 -2.2 Q100 -2.6 109 -2 Q113 0 109 2 Q100 2.6 82 2.2 L27 3.4 L16 3.5 Q4 3.4 0 0Z"/>`;
/** The brush's tilt over the sheet, degrees, and how far its shadow leans away with height. */
const ANGLE = 36;
const TILT = 0.42;
/** How long an area counts as being worked on after its question is last seen out, ms. */
const HOLD_MS = 2500;
/** Cells a side of the raster that finds each area's deep spots, where the brush goes. */
const GRID = 160;

const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
let seq = 1;
const rnd = (): number => hash(seq++, 17.3);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/** Fades an element out and removes it. */
function fadeAway(e: Element, ms: number, delay = 0): void {
  const a = e.animate([{ opacity: getComputedStyle(e).opacity }, { opacity: 0 }], { duration: ms, delay, easing: "ease-in-out", fill: "forwards" });
  a.onfinish = () => e.remove();
}

/**
 * The brush over `body` (the wait's sheet), for the land's `areas`, `reach`
 * meters from its middle to the sheet's edge; `side` is the sheet's width in
 * pixels.
 */
export function createWaitBrush(body: HTMLElement, areas: readonly BrushArea[], reach: number, side: () => number): WaitBrush {
  const water = document.createElementNS(SVG, "svg");
  water.setAttribute("class", "wait-water");
  water.setAttribute("viewBox", `${-reach} ${-reach} ${reach * 2} ${reach * 2}`);
  const air = document.createElement("div");
  air.className = "wait-air";
  body.append(water, air);

  // Each area's deep spots, found in an idle moment on a small raster of the land: where the brush goes down.
  const spots = new Map<string, [number, number][]>();
  const findSpots = (): void => {
    const c = document.createElement("canvas");
    c.width = c.height = GRID;
    const g = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    g.setTransform(GRID / (reach * 2), 0, 0, GRID / (reach * 2), GRID / 2, GRID / 2);
    const own = areas.filter((a) => a.depth > 0);
    own.forEach((a, k) => {
      g.fillStyle = `rgb(${(k + 1) & 255},${((k + 1) >> 8) & 255},0)`;
      g.fill(new Path2D(a.ground), "evenodd");
    });
    const px = g.getImageData(0, 0, GRID, GRID).data;
    const id = (i: number, j: number): number => (i < 0 || j < 0 || i >= GRID || j >= GRID ? 0 : (px[(j * GRID + i) * 4] as number) + ((px[(j * GRID + i) * 4 + 1] as number) << 8));
    for (let j = 2; j < GRID - 2; j += 2) {
      for (let i = 2; i < GRID - 2; i += 2) {
        const k = id(i, j);
        if (k === 0 || id(i - 2, j) !== k || id(i + 2, j) !== k || id(i, j - 2) !== k || id(i, j + 2) !== k) continue;
        const a = own[k - 1];
        if (a === undefined) continue;
        const list = spots.get(a.path) ?? [];
        list.push([(i + 0.5) / GRID, (j + 0.5) / GRID]);
        spots.set(a.path, list);
      }
    }
  };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(findSpots, { timeout: 500 });
  else window.setTimeout(findSpots, 30);

  // ---------- the brush ----------
  const root = document.createElement("div");
  root.className = "wait-tool";
  const inner = document.createElement("div");
  inner.className = "wait-tool-in";
  const shadowWrap = document.createElement("div");
  shadowWrap.className = "wait-tool-shadow";
  shadowWrap.innerHTML = `<svg viewBox="-10 -40 200 90">${BRUSH_SHADOW}</svg>`;
  inner.append(shadowWrap);
  inner.insertAdjacentHTML("beforeend", `<svg class="wait-tool-body" viewBox="-10 -40 200 90">${BRUSH}</svg>`);
  root.append(inner);
  air.append(root);
  const len = (): number => side() * 0.3;
  inner.style.transform = `rotate(${ANGLE}deg) scale(${(len() / 112).toFixed(4)})`;
  const pos = { x: side() * 0.86, y: side() * 0.9, h: 1 };
  let nightness = 0;
  const rad = (ANGLE * Math.PI) / 180;
  /** The light on the sheet: from the window at the upper left by day, from the lantern low on the right at night. */
  const lightAt = (x: number, y: number): [number, number] => {
    if (nightness < 0.5) return [0.72, 0.62];
    const s = side();
    const dx = x - s * 0.6;
    const dy = y - s * 0.66;
    const d = Math.max(s * 0.12, Math.hypot(dx, dy));
    return [dx / d, dy / d];
  };
  /** The shadow's transform in the brush's own axes, for its tip `h` (a share of its length) above the paper. */
  const shear = (x: number, y: number, h: number): string => {
    const [gx, gy] = lightAt(x, y);
    const lx = gx * Math.cos(rad) + gy * Math.sin(rad);
    const ly = -gx * Math.sin(rad) + gy * Math.cos(rad);
    // The lantern hangs close, so its shadows lie nearer the brush than the window's.
    const reachOf = nightness < 0.5 ? 1 : 0.4;
    const lift = (3 + h * 16) * reachOf;
    const t = TILT * reachOf;
    return `matrix(${(1 + t * lx).toFixed(3)}, ${(t * ly).toFixed(3)}, 0, 1, ${(lift * lx).toFixed(2)}, ${(lift * ly).toFixed(2)})`;
  };
  const place = (x: number, y: number): string => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  let move: Animation | null = null;
  let shade: Animation | null = null;
  const settle = (): void => {
    root.style.transform = place(pos.x, pos.y);
    shadowWrap.style.transform = shear(pos.x, pos.y, pos.h);
  };
  settle();
  const glide = (x: number, y: number, ms: number, arc: number): Promise<void> => {
    const { x: x0, y: y0, h: h0 } = pos;
    const mx = (x0 + x) / 2 - (y - y0) * arc;
    const my = (y0 + y) / 2 + (x - x0) * arc;
    move?.cancel();
    shade?.cancel();
    const easing = "cubic-bezier(.45,.05,.35,1)";
    move = root.animate([{ transform: place(x0, y0) }, { transform: place(mx, my) }, { transform: place(x, y) }], { duration: ms, easing, fill: "forwards" });
    shade = shadowWrap.animate([{ transform: shear(x0, y0, h0) }, { transform: shear(mx, my, 1.25) }, { transform: shear(x, y, 1) }], { duration: ms, easing, fill: "forwards" });
    Object.assign(pos, { x, y, h: 1 });
    return move.finished.then(settle, () => undefined);
  };
  const dab = (ms: number): Promise<void> => {
    shade?.cancel();
    shade = shadowWrap.animate([{ transform: shear(pos.x, pos.y, 1) }, { transform: shear(pos.x, pos.y, 0), offset: 0.45 }, { transform: shear(pos.x, pos.y, 0), offset: 0.55 }, { transform: shear(pos.x, pos.y, 1) }], { duration: ms, easing: "ease-in-out", fill: "forwards" });
    const t = inner.style.transform;
    return inner.animate([{ transform: t }, { transform: `${t} scale(.975)`, offset: 0.5 }, { transform: t }], { duration: ms, easing: "ease-in-out" }).finished.then(settle, () => undefined);
  };
  const hover = (ms: number): Promise<void> => {
    const s = side();
    const dx = (rnd() - 0.5) * s * 0.045;
    const dy = (rnd() - 0.5) * s * 0.045;
    move?.cancel();
    move = root.animate([{ transform: place(pos.x, pos.y) }, { transform: place(pos.x + dx, pos.y + dy) }, { transform: place(pos.x, pos.y) }], { duration: ms, easing: "ease-in-out" });
    return move.finished.then(settle, () => undefined);
  };
  /** A damp dab where the brush touched, drying away. */
  const mark = (x: number, y: number): void => {
    const m = document.createElement("div");
    m.className = "wait-dab";
    m.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${Math.round(rnd() * 180)}deg)`;
    air.prepend(m);
    m.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 0.6, offset: 0.5 }, { opacity: 0 }], { duration: 7000, easing: "ease-out", fill: "forwards" }).onfinish = () => m.remove();
  };

  // ---------- what is being worked on, and how quickly answers come ----------
  const lastOut = new Map<string, number>();
  const answers: number[] = [];
  let lastAnswered = -1;
  let baking = false;
  const hot = (): BrushArea[] => {
    const now = performance.now();
    return areas.filter((a) => a.depth > 0 && !a.shown && now - (lastOut.get(a.path) ?? -Infinity) < HOLD_MS);
  };
  /** Answers a second over the last three seconds. */
  const rate = (): number => {
    const now = performance.now();
    while (answers.length > 0 && now - (answers[0] as number) > 3000) answers.shift();
    return answers.length / 3;
  };
  const pace = (): number => clamp(0.55 + rate() * 0.22, 0.55, 1.5);

  // ---------- clear water where a question is out ----------
  const wet = new Map<string, SVGGElement>();
  function syncWater(): void {
    const now = new Set(hot().map((a) => a.path));
    for (const a of areas) {
      const has = wet.get(a.path);
      if (now.has(a.path) && has === undefined) {
        const g = document.createElementNS(SVG, "g");
        g.setAttribute("class", "wet");
        g.innerHTML = `<path d="${a.ground}" fill-rule="evenodd"/><path class="wet-sheen" d="${a.ground}" fill-rule="evenodd"/>`;
        (g.lastElementChild as SVGElement).style.animationDelay = `${-(rnd() * 7).toFixed(1)}s`;
        water.append(g);
        wet.set(a.path, g);
        g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2600, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });
      } else if (!now.has(a.path) && has !== undefined) {
        wet.delete(a.path);
        // Drops into its wash when it settles; dries slowly when it only lost its question for now.
        fadeAway(has, a.shown ? 1800 : 5200, a.shown ? 400 : 0);
      }
    }
  }
  const waterLoop = window.setInterval(() => {
    if (baking) window.clearInterval(waterLoop);
    syncWater();
  }, 900);

  // ---------- the brush's round: go where a question is out, dab, hover, go on ----------
  let at: string | null = null;
  function nextSpot(): [number, number] | null {
    const pool = hot();
    const from = pool.length > 0 ? pool : areas.filter((a) => a.depth > 0 && !a.shown);
    const usable = from.filter((a) => (spots.get(a.path)?.length ?? 0) > 0);
    if (usable.length === 0) return null;
    const a = usable[Math.floor(rnd() * usable.length)] as BrushArea;
    const b = usable[Math.floor(rnd() * usable.length)] as BrushArea;
    // Prefer staying close: the nearer of two picks.
    const here = spots.get(at ?? "")?.[0];
    const near = (x: BrushArea): number => (here === undefined ? 0 : Math.hypot((spots.get(x.path)?.[0]?.[0] ?? 0) - here[0], (spots.get(x.path)?.[0]?.[1] ?? 0) - here[1]));
    const area = near(a) <= near(b) ? a : b;
    at = area.path;
    const list = spots.get(area.path) as [number, number][];
    return list[Math.floor(rnd() * list.length)] as [number, number];
  }
  let alive = true;
  async function round(): Promise<void> {
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1800, fill: "forwards" });
    while (alive) {
      const next = nextSpot();
      if (next === null) {
        await wait(800);
        continue;
      }
      const s = side();
      const tx = next[0] * s;
      const ty = next[1] * s;
      const d = Math.hypot(tx - pos.x, ty - pos.y) / s;
      await glide(tx, ty, (900 + d * 2600) / pace(), (rnd() - 0.5) * 0.35);
      if (!alive) return;
      const dabs = 1 + Math.floor(rnd() * (rate() > 1 ? 3 : 2));
      for (let k = 0; k < dabs && alive; k++) {
        await dab(620 / Math.sqrt(pace()));
        mark(tx + (rnd() - 0.5) * s * 0.012, ty + (rnd() - 0.5) * s * 0.012);
      }
      await hover((900 + rnd() * 1400) / pace());
    }
  }
  let started = false;

  return {
    asking(paths, answered) {
      if (baking) return;
      const now = performance.now();
      for (const p of paths) lastOut.set(p, now);
      if (lastAnswered >= 0 && answered > lastAnswered) for (let k = lastAnswered; k < answered; k++) answers.push(now);
      lastAnswered = answered;
      syncWater();
      if (!started && paths.length > 0) {
        started = true;
        void round();
      }
    },
    baking() {
      baking = true;
      alive = false;
      fadeAway(root, 1600);
      for (const g of wet.values()) fadeAway(g, 1800);
      wet.clear();
    },
    night(n) {
      nightness = n;
      air.classList.toggle("night", n >= 0.5);
      settle();
    },
  };
}
