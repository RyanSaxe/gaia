// The minimap is a 156 px scrap of the field map on the shut journal. It shows
// about 130 m of land around the person, rotated so the way they face is up,
// letters the area they are in and rings the thing they walk toward. Its canvas
// holds a window of the field map's paper wide enough for any heading, so most
// frames change only a CSS transform, and it redraws only when the person nears
// the window's edge or the paper repaints.

import type { Place, PlaceArea, WorldPlaces } from "@gaia/terrain";
import { onTap } from "../tap.ts";
import type { Heading, BakedWorld } from "../terrain/world.ts";
import { type FieldMap, drawLand } from "./field-map.ts";
import { nameBreaks, nameTails } from "./map-names.ts";
import { DECKLE_MASK, TRAVELLER_SVG } from "./map-styles.ts";

export interface Minimap {
  /** Moves the scrap with the person's position and heading. `dt` is the frame time in seconds. */
  frame(x: number, z: number, yaw: number, place: Place, dt: number): void;
  /** Shows or hides the scrap. Either way, the next frame letters the person's area again. */
  show(on: boolean): void;
  /** Tucks the scrap below the bottom of the screen or brings it back, as a tap on its edge does. */
  tuck(on: boolean): void;
  /** Sets the thing the person walks toward, which the scrap rings, or null for none. */
  heading(thing: Heading | null): void;
  /** What the scrap shows and how long its last window redraw took in ms, for scripted checks. */
  state(): { readonly area: string | null; readonly marked: string | null; readonly tucked: boolean; readonly redraws: number; readonly redrawMs: number };
}

/** The scrap's side in CSS pixels, and the meters of land across it. */
const SIDE = 156;
const METERS = 130;
const SCALE = SIDE / METERS;
/** The traveller's position on the scrap as fractions of its side. It sits below center so more of the land ahead shows. */
const HERE = { x: 0.5, y: 0.6 } as const;
/** The paint fades out over `fade` px, then leaves `bare` px of bare paper at the torn edge. */
const EDGE = { bare: 4, fade: 6 } as const;
/** A tap within `edge` px inside the scrap's edge, or up to `past` px outside it, tucks the scrap. */
const TAP = { edge: 16, past: 6 } as const;
/** Seconds a person must stay in a new area before its name is lettered, so walking along a border does not flicker names. */
const SETTLE = 2.5;
/** The distance in px from the traveller to the scrap's farthest corner. The window must cover this radius at any heading. */
const REACH = Math.ceil(Math.hypot(Math.max(HERE.x, 1 - HERE.x) * SIDE, Math.max(HERE.y, 1 - HERE.y) * SIDE));
/** How far in px the person may walk from the window's center before it must be drawn again. */
const SLACK = 90;
/** The area name's lettering in px, as the field map letters areas. A long name shrinks from `size` to fit `room`, but not below `least`. */
const NAME = { size: 13.5, least: 9.5, spacing: 0.17, room: SIDE - 32 } as const;
const SERIF = `"Iowan Old Style", Georgia, "Times New Roman", serif`;
/**
 * The ring and name of the thing the person walks toward stay `keep` px inside the torn edge, where the paint is
 * solid. So the name is at most `SIDE - 2 * keep`, 136 px, wide (lab.css). The name sits `gap` px from the ring, and
 * goes above it only if it clears the top `under` px, where the area's name is lettered.
 */
const MARK = { keep: EDGE.bare + EDGE.fade, gap: 3, under: 30 } as const;

/**
 * Chooses which area the minimap letters as the person walks. It letters the
 * first place at once. After that it letters a new area only once the person
 * has stayed in it `settle` seconds, so walking along a border does not
 * flicker names. The wild (depth below 0) represents no directory, so after
 * the same pause it letters nothing. `next` returns the area to letter when
 * that changes, null for none, and undefined when nothing changes.
 */
export function createNamer(settle = SETTLE): { next(area: PlaceArea, dt: number): PlaceArea | null | undefined; reset(): void } {
  let announced: string | null = null;
  let candidate: string | null = null;
  let held = 0;
  return {
    next(area, dt) {
      const key = `${area.depth}:${area.path}`;
      if (key === announced) {
        candidate = null;
        return undefined;
      }
      if (announced !== null) {
        if (key !== candidate) {
          candidate = key;
          held = 0;
          return undefined;
        }
        held += dt;
        if (held < settle) return undefined;
      }
      announced = key;
      candidate = null;
      return area.depth < 0 ? null : area;
    },
    reset() {
      announced = null;
      candidate = null;
    },
  };
}

/**
 * Returns what a tap at (x, y), in px from the scrap's top left, does. Within
 * `TAP.edge` px inside the edge or `TAP.past` px outside it, the tap tucks the
 * scrap. Farther in, it unfolds the field map. Farther out, it does nothing.
 */
export function tapOn(x: number, y: number, side = SIDE): "tuck" | "unfold" | null {
  const inward = Math.min(x, y, side - x, side - y);
  if (inward < -TAP.past) return null;
  return inward < TAP.edge ? "tuck" : "unfold";
}

/**
 * Places the ring, radius `r` px, around a thing at (x, y) on the scrap, and the thing's `w` by `h` px name. The ring
 * sits on the thing, or at the edge toward it when the thing is off the scrap. The name is centered above the ring,
 * or below it when there is no room above, and shifted sideways to stay on the paper. Both positions are px from the
 * scrap's top left, the name's by its top left corner.
 */
export function markAt(x: number, y: number, r: number, w: number, h: number, side = SIDE): { ring: [number, number]; name: [number, number] } {
  const within = (v: number, least: number, most: number): number => Math.max(least, Math.min(most, v));
  const rx = within(x, MARK.keep + r, side - MARK.keep - r);
  const ry = within(y, MARK.keep + r, side - MARK.keep - r);
  const above = ry - r - MARK.gap - h;
  const top = above >= MARK.under ? above : within(ry + r + MARK.gap, MARK.keep, side - MARK.keep - h);
  return { ring: [rx, ry], name: [within(rx - w / 2, MARK.keep, side - MARK.keep - w), top] };
}

/** Deterministic value noise from 0 to 1, smoothly interpolated over a grid of unit cells. */
function noise(x: number, y: number, seed: number): number {
  const at = (i: number, j: number): number => {
    const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x);
  const j = Math.floor(y);
  const u = x - i;
  const v = y - j;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  return (at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sv) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sv;
}

/**
 * Returns the scrap's paint mask as a CSS url. It is opaque inside, fades
 * over `EDGE.fade` px with noise along the edge, and leaves `EDGE.bare` px of
 * bare paper at the edge, with rounded corners.
 */
function paintMask(dpr: number): string {
  const n = Math.round(SIDE * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const image = ctx.createImageData(n, n);
  const round = EDGE.bare + EDGE.fade + 4;
  const smooth = (a: number, b: number, v: number): number => {
    const u = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      const x = (px + 0.5) / dpr;
      const y = (py + 0.5) / dpr;
      const dx = Math.min(x, SIDE - x);
      const dy = Math.min(y, SIDE - y);
      const d = dx < round && dy < round ? round - Math.hypot(round - dx, round - dy) : Math.min(dx, dy);
      const a = Math.atan2(y - SIDE / 2, x - SIDE / 2);
      const wander = 0.55 * Math.sin(a * 5 + 1.3) + 0.3 * Math.sin(a * 13 + 4.1) + 0.15 * Math.sin(a * 31 + 2.2);
      const blot = (noise(x / 8, y / 8, 3) - 0.5) * 4 + (noise(x / 2.5, y / 2.5, 4) - 0.5) * 0.4;
      image.data[(py * n + px) * 4 + 3] = Math.round(smooth(EDGE.bare, EDGE.bare + EDGE.fade, d + wander * 1.6 + blot) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return `url("${canvas.toDataURL()}")`;
}

const el = (tag: string, cls: string, parent: HTMLElement, html = ""): HTMLElement => {
  const node = document.createElement(tag);
  node.className = cls;
  if (html !== "") node.innerHTML = html;
  parent.append(node);
  return node;
};

export function createMinimap(root: HTMLElement, map: FieldMap, baked: () => BakedWorld, places: () => WorldPlaces, unfold: () => void = () => map.open(true)): Minimap {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scrap = el("div", "minimap", root);
  scrap.style.setProperty("--deckle", DECKLE_MASK);
  scrap.style.setProperty("--paint", paintMask(dpr));
  el("div", "minimap-paper", scrap);
  const face = el("div", "minimap-face", scrap);
  const sheet = el("div", "minimap-sheet", face);
  const canvas = el("canvas", "minimap-land", sheet) as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  el("div", "minimap-here", face, TRAVELLER_SVG);
  const band = el("div", "minimap-names", face);
  band.setAttribute("aria-live", "polite");
  const names = [el("div", "minimap-name", band), el("div", "minimap-name", band)];
  const mark = el("div", "minimap-mark", face, `<svg viewBox="-24 -24 48 48" aria-hidden="true"><path pathLength="1" d="M-1 -15C9 -16 16 -8 15 1S6 15 -2 14S-16 6 -15 -3S-9 -13 3 -15"/></svg><span></span>`);
  const markName = mark.querySelector("span") as HTMLElement;
  const markRing = mark.querySelector("svg") as SVGSVGElement;
  // Taps go to a layer that extends a little past the torn edge, so a finger hits the edge easily.
  const touch = el("div", "minimap-touch", scrap);
  touch.setAttribute("role", "button");
  touch.setAttribute("tabindex", "0");
  touch.setAttribute("aria-label", "Unfold the map");

  const span = 2 * (REACH + SLACK);
  canvas.width = canvas.height = Math.round(span * dpr);
  canvas.style.width = canvas.style.height = `${span}px`;
  /** The world position in meters at the window's center. NaN until the first draw. */
  const anchor = { x: Number.NaN, z: Number.NaN };
  const person = { x: 0, z: 0, yaw: 0 };
  let redraws = 0;
  let redrawMs = 0;
  /** The id of the idle callback waiting to redraw, or 0. */
  let idle = 0;
  let shown = false;
  let tucked = false;
  let marked: Heading | null = null;
  /** The ring's radius and the name's size in px, measured once per thing so walking never forces a layout. */
  const markSize = { r: 0, w: 0, h: 0 };

  function redraw(): void {
    const paper = map.paper();
    if (idle !== 0) window.cancelIdleCallback(idle);
    idle = 0;
    // The scrap shows bare paper until the field map paper is painted. Then lab.css fades the land in.
    canvas.classList.toggle("painted", paper !== null);
    if (paper === null) return;
    const t0 = performance.now();
    anchor.x = person.x;
    anchor.z = person.z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = paper.style.paper;
    ctx.fillRect(0, 0, span, span);
    drawLand(ctx, span, span, paper, baked(), { x: anchor.x, z: anchor.z, zoom: SCALE }, 0.85);
    redraws++;
    redrawMs = performance.now() - t0;
    place();
  }
  /** The last transforms written, so a frame that changes nothing visible writes no style. */
  const last = { land: "", mark: "", name: "" };
  /** Rotates and translates the window under the scrap so the traveller stays fixed and faces up, and moves the ring with the thing they walk toward. */
  function place(): void {
    // Rounds to a quarter pixel and a twentieth of a degree, which are too small to see. Most frames of a straight
    // walk then write no style.
    const q = (v: number): string => (Math.round(v * 4) / 4).toFixed(2);
    const degrees = ((((person.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const ox = span / 2 + (person.x - anchor.x) * SCALE;
    const oz = span / 2 + (person.z - anchor.z) * SCALE;
    const land = `translate(${HERE.x * SIDE}px, ${HERE.y * SIDE}px) rotate(${(Math.round(degrees * 20) / 20).toFixed(2)}deg) translate(${q(-ox)}px, ${q(-oz)}px)`;
    if (land !== last.land) canvas.style.transform = last.land = land;
    if (marked !== null) {
      // The thing rotates with the land. When it is off the scrap, `markAt` keeps the ring and name at the edge toward it.
      const c = Math.cos(person.yaw);
      const s = Math.sin(person.yaw);
      const rx = (marked.x - person.x) * SCALE;
      const rz = (marked.z - person.z) * SCALE;
      const { ring, name } = markAt(HERE.x * SIDE + rx * c - rz * s, HERE.y * SIDE + rx * s + rz * c, markSize.r, markSize.w, markSize.h);
      const at = `translate(${q(ring[0])}px, ${q(ring[1])}px)`;
      if (at !== last.mark) mark.style.transform = last.mark = at;
      const by = `translate(${q(name[0] - ring[0])}px, ${q(name[1] - ring[1])}px)`;
      if (by !== last.name) markName.style.transform = last.name = by;
    }
  }
  map.onPainted(() => {
    if (shown) redraw();
  });

  // The field map opens from the scrap's rect, rotating from the person's heading to north, and closes back into it.
  map.unfoldsFrom(() => {
    if (!shown) return null;
    const layer = root.getBoundingClientRect();
    const r = sheet.getBoundingClientRect();
    return { rect: new DOMRect(r.left - layer.left, r.top - layer.top, r.width, r.height), scale: SCALE, turn: person.yaw, at: [HERE.x, HERE.y] };
  });
  function tuck(on: boolean): void {
    tucked = on;
    scrap.classList.toggle("tucked", on);
    touch.setAttribute("aria-label", on ? "Bring the minimap back" : "Unfold the map");
  }
  onTap(touch, (e) => {
    if (tucked) {
      tuck(false);
      return;
    }
    const r = scrap.getBoundingClientRect();
    const does = tapOn(e.clientX - r.left, e.clientY - r.top);
    if (does === "tuck") tuck(true);
    else if (does === "unfold") unfold();
  });
  touch.addEventListener("keydown", (e) => {
    if (e.code !== "Enter" && e.code !== "Space") return;
    if (tucked) tuck(false);
    else unfold();
  });

  // ---------- the area name, lettered again on entering another area ----------
  const namer = createNamer();
  let current = 0;
  /** The parent folders lettered above each repeated area name, as on the field map, computed once per world. */
  let tails: { of: WorldPlaces; above: Map<string, string> } | null = null;
  const measure = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  /** The largest font size, from `NAME.least` to `NAME.size`, at which `label` in spaced capitals fits `NAME.room`. */
  function fitted(label: string): number {
    measure.font = `600 ${NAME.size}px ${SERIF}`;
    measure.letterSpacing = `${(NAME.size * NAME.spacing).toFixed(2)}px`;
    const width = measure.measureText(label).width;
    return Math.max(NAME.least, Math.min(NAME.size, (NAME.size * NAME.room) / Math.max(1, width)));
  }
  /** Fades out the current name and letters `area`'s in its place. Null letters nothing. */
  function write(area: PlaceArea | null): void {
    (names[current] as HTMLElement).classList.remove("on");
    if (area === null) return;
    const next = names[1 - current] as HTMLElement;
    const all = places();
    if (tails?.of !== all) tails = { of: all, above: nameTails(all.areas.filter((a) => a.depth > 0).map((a) => a.path)) };
    const above = tails.above.get(area.path) ?? "";
    next.innerHTML = `${above === "" ? "" : `<span class="minimap-above"></span>`}<span class="minimap-area"></span>`;
    if (above !== "") (next.querySelector(".minimap-above") as HTMLElement).textContent = above;
    const label = next.querySelector(".minimap-area") as HTMLElement;
    label.textContent = area.name;
    label.style.fontSize = `${fitted(area.name.toUpperCase()).toFixed(1)}px`;
    next.classList.add("on");
    current = 1 - current;
  }

  return {
    frame(x, z, yaw, at, dt) {
      person.x = x;
      person.z = z;
      person.yaw = yaw;
      if (!shown) return;
      // Redraws the window only as the person nears its edge. Past 45% of `SLACK` it redraws in idle time, and past
      // 85% it redraws at once.
      const off = Math.max(Math.abs(x - anchor.x), Math.abs(z - anchor.z)) * SCALE;
      if (!(off < SLACK * 0.85)) redraw();
      else {
        if (off > SLACK * 0.45 && idle === 0) idle = window.requestIdleCallback(() => ((idle = 0), redraw()), { timeout: 2000 });
        place();
      }
      const lettered = namer.next(at.area, dt);
      if (lettered !== undefined) write(lettered);
    },
    show(on) {
      shown = on;
      scrap.classList.toggle("on", on);
      namer.reset();
      if (on) redraw();
    },
    tuck,
    heading(thing) {
      marked = thing;
      mark.classList.remove("on");
      if (thing === null) return;
      markName.replaceChildren(...nameBreaks(thing.name).flatMap((piece, k) => (k === 0 ? [piece] : [document.createElement("wbr"), piece])));
      markSize.r = Math.max(9, Math.min(26, thing.reach * SCALE + 6));
      markSize.w = markName.offsetWidth;
      markSize.h = markName.offsetHeight;
      markRing.style.width = markRing.style.height = `${(markSize.r * 2 * 48) / 30}px`;
      place();
      // Waits two frames so the ring's draw transition starts from empty.
      requestAnimationFrame(() => requestAnimationFrame(() => mark.classList.toggle("on", marked === thing)));
    },
    state: () => {
      const lettered = names.find((n) => n.classList.contains("on"));
      return {
        area: lettered?.querySelector(".minimap-area")?.textContent ?? null,
        marked: mark.classList.contains("on") ? markName.textContent : null,
        tucked,
        redraws,
        redrawMs: +redrawMs.toFixed(1),
      };
    },
  };
}
