// The minimap: a torn scrap of the field map at the lower left, showing the
// land around the person as the map paints it, north up, with the traveller
// at its middle and the area's name lettered on the paper at its foot. It is
// not the whole land: it is the local one, about 170 m across. Crossing into
// another area, the old name fades as the new one is written; standing still
// writes the file underfoot beneath it. A tap on it unfolds the field map out
// of it. Walking up to a thing, a vermilion pencil ring is drawn round it on
// the scrap with its name in the traveller's hand, and on arrival the scrap
// grows into the thing's sketch page (`sketch.ts`).
//
// Cheap by construction: its canvas holds a window of the land half again
// wider than the scrap, drawn from the field map's painted paper, and slides
// under the scrap by a transform as the person walks; it is drawn again only
// when the person nears the window's edge, or the paper is painted afresh.

import type { Place } from "@gaia/terrain";
import { onTap } from "../lab.ts";
import type { Heading, StoodWorld } from "../terrain/lab.ts";
import { type FieldMap, drawLand } from "./field-map.ts";
import { DECKLE_MASK, TRAVELLER_SVG } from "./map-styles.ts";

export interface Minimap {
  /** Follows the person: where they stand and look, how long they have stood still (seconds), and the frame's time. */
  frame(x: number, z: number, yaw: number, place: Place, still: number, dt: number): void;
  /** Whether the scrap shows; either way the area the person stands in is written afresh. */
  show(on: boolean): void;
  /** The thing the person is walking up to, ringed on the scrap, or null. */
  heading(thing: Heading | null): void;
  /** The scrap itself: a thing's sketch page grows out of it. */
  readonly element: HTMLElement;
  /** What the scrap shows, for scripted checks. */
  state(): { readonly area: string | null; readonly underfoot: string | null; readonly marked: string | null; readonly redraws: number };
}

/** The painted window's side, CSS pixels, and how many meters it shows: the local land. */
const SIDE = 216;
const METERS = 170;
const SCALE = SIDE / METERS;
/** The canvas holds this much more than the window, so it can slide under the scrap. */
const WINDOW = 1.8;
/** How long a person must stay in a new area before its name is written, seconds: a border walked along never flickers. */
const SETTLE = 1.2;
/** Standing still this long, seconds, writes the file underfoot. */
const PAUSE = 1.1;

/** The parent directories of a path, for the small line over its name: "packages / render". */
const parentOf = (path: string): string => path.split("/").slice(0, -1).join(" / ");

const el = (tag: string, cls: string, parent: HTMLElement, html = ""): HTMLElement => {
  const node = document.createElement(tag);
  node.className = cls;
  if (html !== "") node.innerHTML = html;
  parent.append(node);
  return node;
};

export function createMinimap(root: HTMLElement, map: FieldMap, stood: () => StoodWorld): Minimap {
  const scrap = el("div", "minimap", root);
  scrap.setAttribute("role", "button");
  scrap.setAttribute("tabindex", "0");
  scrap.setAttribute("aria-label", "Unfold the map");
  scrap.style.setProperty("--deckle", DECKLE_MASK);
  const sheet = el("div", "minimap-sheet", scrap);
  const canvas = el("canvas", "minimap-land", sheet) as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const mark = el("div", "minimap-mark", sheet, `<svg viewBox="-24 -24 48 48" aria-hidden="true"><path pathLength="1" d="M-1 -15C9 -16 16 -8 15 1S6 15 -2 14S-16 6 -15 -3S-9 -13 3 -15"/></svg><span></span>`);
  const markName = mark.querySelector("span") as HTMLElement;
  const markRing = mark.querySelector("svg") as SVGSVGElement;
  el("div", "minimap-here", sheet, TRAVELLER_SVG);
  const steps = sheet.querySelector(".traveller-steps") as SVGGElement;
  const band = el("div", "minimap-band", scrap);
  band.setAttribute("aria-live", "polite");
  const names = [el("div", "minimap-name", band), el("div", "minimap-name", band)];
  const underfoot = el("div", "minimap-underfoot", band);

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const span = SIDE * WINDOW;
  canvas.width = canvas.height = Math.round(span * dpr);
  canvas.style.width = canvas.style.height = `${span}px`;
  /** Where the canvas's window is centered, meters; NaN until it is first drawn. */
  const anchor = { x: Number.NaN, z: Number.NaN };
  const person = { x: 0, z: 0, yaw: 0 };
  let redraws = 0;
  /** A redraw waiting for the page's idle time. */
  let idle = 0;
  let shown = false;
  let marked: Heading | null = null;

  function redraw(): void {
    const paper = map.paper();
    if (idle !== 0) window.cancelIdleCallback(idle);
    idle = 0;
    if (paper === null) return;
    anchor.x = person.x;
    anchor.z = person.z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = paper.style.paper;
    ctx.fillRect(0, 0, span, span);
    drawLand(ctx, span, span, paper, stood(), { x: anchor.x, z: anchor.z, zoom: SCALE }, 0.85, 0.6);
    redraws++;
    slide();
  }
  /** What the scrap shows now, so a frame that would change nothing a person can see touches nothing. */
  const last = { slide: "", steps: "", mark: "" };
  /** Slides the window under the scrap so the person stays at its middle, and the ring with what they are walking to. */
  function slide(): void {
    // A quarter of a pixel is too little to see, and moving no more often than that keeps the page still most frames.
    const q = (v: number): string => (Math.round(v * 4) / 4).toFixed(2);
    const dx = (person.x - anchor.x) * SCALE;
    const dz = (person.z - anchor.z) * SCALE;
    const moved = `translate(${q(SIDE / 2 - span / 2 - dx)}px, ${q(SIDE / 2 - span / 2 - dz)}px)`;
    if (moved !== last.slide) canvas.style.transform = last.slide = moved;
    const turned = `rotate(${Math.round((-person.yaw * 180) / Math.PI / 2) * 2})`;
    if (turned !== last.steps) steps.setAttribute("transform", (last.steps = turned));
    if (marked !== null) {
      // Out past the scrap's edge, the ring waits at the edge toward the thing.
      const inset = 16;
      const mx = Math.max(inset, Math.min(SIDE - inset, SIDE / 2 + (marked.x - person.x) * SCALE));
      const my = Math.max(inset, Math.min(SIDE - inset, SIDE / 2 + (marked.z - person.z) * SCALE));
      const at = `translate(${q(mx)}px, ${q(my)}px)`;
      if (at !== last.mark) mark.style.transform = last.mark = at;
      mark.classList.toggle("left", mx > SIDE * 0.62);
    }
  }
  map.onPainted(() => {
    if (shown) redraw();
  });

  // The field map unfolds out of the scrap and folds back into it.
  map.unfoldsFrom(() => {
    if (!shown) return null;
    const layer = root.getBoundingClientRect();
    const r = sheet.getBoundingClientRect();
    return { rect: new DOMRect(r.left - layer.left, r.top - layer.top, r.width, r.height), scale: SCALE };
  });
  // A tap on the scrap unfolds the map; on a thing's page, it does nothing (the page's own "more" is there).
  const unfold = (): void => {
    if (!scrap.classList.contains("page")) map.open(true);
  };
  onTap(scrap, unfold);
  scrap.addEventListener("keydown", (e) => {
    if (e.code === "Enter" || e.code === "Space") unfold();
  });

  // ---------- the area's name, written afresh on crossing into another ----------
  let current = 0;
  let announced: string | null = null;
  let candidate: string | null = null;
  let held = 0;
  let underKey = "";
  function write(place: Place): void {
    const next = names[1 - current] as HTMLElement;
    const parent = place.area.depth > 1 ? parentOf(place.area.path) : "";
    next.innerHTML = `${parent === "" ? "" : `<span class="minimap-parent"></span>`}<span class="minimap-area"></span>`;
    if (parent !== "") (next.querySelector(".minimap-parent") as HTMLElement).textContent = parent;
    (next.querySelector(".minimap-area") as HTMLElement).textContent = place.area.name;
    (names[current] as HTMLElement).classList.remove("on");
    next.classList.add("on");
    current = 1 - current;
  }

  return {
    element: scrap,
    frame(x, z, yaw, place, still, dt) {
      person.x = x;
      person.z = z;
      person.yaw = yaw;
      if (!shown) return;
      // The window is drawn again only as the person nears its edge: in the page's idle time once they are halfway
      // there, and at once only if no idle moment came before they reached it.
      const margin = (span - SIDE) / 2 / SCALE;
      const off = Math.max(Math.abs(x - anchor.x), Math.abs(z - anchor.z));
      if (!(off < margin * 0.85)) redraw();
      else {
        if (off > margin * 0.45 && idle === 0) idle = window.requestIdleCallback(() => ((idle = 0), redraw()), { timeout: 2000 });
        slide();
      }
      const key = `${place.area.depth}:${place.area.path}`;
      if (key === announced) {
        candidate = null;
        held = 0;
      } else if (key === candidate || announced === null) {
        held += dt;
        if (held >= SETTLE || announced === null) {
          write(place);
          announced = key;
          candidate = null;
        }
      } else {
        candidate = key;
        held = 0;
      }
      const pausing = still >= PAUSE && key === announced && place.file !== null;
      if (pausing) {
        const nextKey = place.file?.path ?? "";
        if (nextKey !== underKey) {
          underKey = nextKey;
          underfoot.textContent = place.file?.name ?? "";
        }
      }
      underfoot.classList.toggle("on", pausing);
    },
    show(on) {
      shown = on;
      scrap.classList.toggle("on", on);
      announced = null;
      candidate = null;
      if (on) redraw();
    },
    heading(thing) {
      marked = thing;
      mark.classList.remove("on");
      if (thing === null) return;
      markName.textContent = thing.name;
      const r = Math.max(9, Math.min(26, thing.reach * SCALE + 6));
      markRing.style.width = markRing.style.height = `${(r * 2 * 48) / 30}px`;
      slide();
      // A frame later, so the pencil draws the ring from nothing.
      requestAnimationFrame(() => requestAnimationFrame(() => mark.classList.toggle("on", marked === thing)));
    },
    state: () => ({
      area: (names[current] as HTMLElement).querySelector(".minimap-area")?.textContent ?? null,
      underfoot: underfoot.classList.contains("on") ? underfoot.textContent : null,
      marked: mark.classList.contains("on") ? markName.textContent : null,
      redraws,
    }),
  };
}
