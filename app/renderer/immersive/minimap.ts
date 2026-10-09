// The minimap: a torn scrap of the field map at the lower right, about 156 px
// square, showing the land around the person as the map paints it, turned
// with them so the way they face is always up. The traveller stands a little
// below its middle, so more of the way ahead shows. It is the local land,
// about 130 m across, not the whole. Its paint thins out over 6 px into 4 px
// of bare paper at its torn edge, and it carries no north: the compass in the
// top right corner points north (`compass.ts`). After 2.5 s in a new area the
// old name fades and the new one is lettered across the land, as the field
// map letters areas; in the wild the old name fades and nothing is written.
// A tap on its land unfolds the field map out of it. A tap on its outer edge
// tucks it down past the screen's foot, leaving its top 50 px (the name and a
// band of turning land), and a tap on what shows brings it back. Walking up
// to a thing, a vermilion pencil ring is drawn round it with its name in the
// traveller's hand.
//
// Cheap by construction: its canvas holds a window of the land wide enough to
// cover the scrap at any heading with room to walk, drawn from the field map's
// painted paper. One transform turns it about the traveller and slides it as
// they walk, so a frame touches one style at most; it is drawn again only when
// the person nears the window's edge, or the paper is painted afresh.

import type { Place, PlaceArea, WorldPlaces } from "@gaia/terrain";
import { onTap } from "../lab.ts";
import type { Heading, StoodWorld } from "../terrain/lab.ts";
import { type FieldMap, drawLand } from "./field-map.ts";
import { nameTails } from "./map-names.ts";
import { DECKLE_MASK, TRAVELLER_SVG } from "./map-styles.ts";

export interface Minimap {
  /** Follows the person: where they stand and the way they face, and the frame's time. */
  frame(x: number, z: number, yaw: number, place: Place, dt: number): void;
  /** Whether the scrap shows; either way the area the person stands in is written afresh. */
  show(on: boolean): void;
  /** Tucks the scrap below the screen's foot, or brings it back, as a tap on its edge does. */
  tuck(on: boolean): void;
  /** The thing the person is walking up to, ringed on the scrap, or null. */
  heading(thing: Heading | null): void;
  /** What the scrap shows, for scripted checks, and how long its window last took to draw, ms. */
  state(): { readonly area: string | null; readonly marked: string | null; readonly tucked: boolean; readonly redraws: number; readonly redrawMs: number };
}

/** The scrap's side, CSS pixels, and how many meters of land it shows. */
const SIDE = 156;
const METERS = 130;
const SCALE = SIDE / METERS;
/** Where the traveller stands on the scrap, as fractions of its side: a little low, so more of the way ahead shows. */
const HERE = { x: 0.5, y: 0.6 } as const;
/** The paint thins out over `fade` px into `bare` px of bare paper at the torn edge. */
const EDGE = { bare: 4, fade: 6 } as const;
/** A tap within `edge` px of the scrap's edge, or up to `past` px beyond it, tucks it; px. */
const TAP = { edge: 16, past: 6 } as const;
/** How long a person must stay in a new area before its name is written, seconds: a border walked along never flickers. */
const SETTLE = 2.5;
/** The farthest the scrap reaches from the traveller, px: the window must cover this much round them at any heading. */
const REACH = Math.ceil(Math.hypot(Math.max(HERE.x, 1 - HERE.x) * SIDE, Math.max(HERE.y, 1 - HERE.y) * SIDE));
/** How far the person may walk from where the window was drawn before it must be drawn again, px. */
const SLACK = 90;
/** The area's name in the field map's lettering for areas: at most its size, smaller for a long name, never below legible; px. */
const NAME = { size: 13.5, least: 9.5, spacing: 0.17, room: SIDE - 32 } as const;
const SERIF = `"Iowan Old Style", Georgia, "Times New Roman", serif`;

/**
 * Which area the minimap letters as the person walks. The first place is
 * lettered at once; after that a new area only once the person has stayed in
 * it `settle` seconds, so a border walked along never flickers a name. The
 * wild stands for no directory, so after the same pause it letters nothing.
 * `next` returns the area to letter whenever that changes (null for none),
 * and undefined when it does not.
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
 * What a tap at (x, y) does, in px from the scrap's top left: on its outer
 * 16 px or up to 6 px past its torn edge it tucks the scrap away, and on its
 * land it unfolds the field map; farther off, nothing.
 */
export function tapOn(x: number, y: number, side = SIDE): "tuck" | "unfold" | null {
  const inward = Math.min(x, y, side - x, side - y);
  if (inward < -TAP.past) return null;
  return inward < TAP.edge ? "tuck" : "unfold";
}

/** Smooth noise between 0 and 1 over a grid of unit cells, the same on every run. */
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
 * Where the paint lies on the scrap, as a mask: full inside, thinning out
 * unevenly over `EDGE.fade` px into `EDGE.bare` px of bare paper at the edge,
 * as a wash does where it dries into dry paper, its corners rounded.
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

export function createMinimap(root: HTMLElement, map: FieldMap, stood: () => StoodWorld, places: () => WorldPlaces): Minimap {
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
  // Taps land on a layer reaching a little past the torn edge, so a finger finds the edge easily.
  const touch = el("div", "minimap-touch", scrap);
  touch.setAttribute("role", "button");
  touch.setAttribute("tabindex", "0");
  touch.setAttribute("aria-label", "Unfold the map");

  const span = 2 * (REACH + SLACK);
  canvas.width = canvas.height = Math.round(span * dpr);
  canvas.style.width = canvas.style.height = `${span}px`;
  /** Where the canvas's window is centered, meters; NaN until it is first drawn. */
  const anchor = { x: Number.NaN, z: Number.NaN };
  const person = { x: 0, z: 0, yaw: 0 };
  let redraws = 0;
  let redrawMs = 0;
  /** A redraw waiting for the page's idle time. */
  let idle = 0;
  let shown = false;
  let tucked = false;
  let marked: Heading | null = null;

  function redraw(): void {
    const paper = map.paper();
    if (idle !== 0) window.cancelIdleCallback(idle);
    idle = 0;
    if (paper === null) return;
    const t0 = performance.now();
    anchor.x = person.x;
    anchor.z = person.z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = paper.style.paper;
    ctx.fillRect(0, 0, span, span);
    drawLand(ctx, span, span, paper, stood(), { x: anchor.x, z: anchor.z, zoom: SCALE }, 0.85);
    redraws++;
    redrawMs = performance.now() - t0;
    place();
  }
  /** What the scrap shows now, so a frame that would change nothing a person can see touches nothing. */
  const last = { land: "", mark: "" };
  /** Turns and slides the window under the scrap so the traveller stays put and the way they face is up; moves the ring with what they walk to. */
  function place(): void {
    // A quarter of a pixel and a twentieth of a degree are too little to see, and moving no more often than that
    // keeps the page still most frames of a straight walk.
    const q = (v: number): string => (Math.round(v * 4) / 4).toFixed(2);
    const degrees = ((((person.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const ox = span / 2 + (person.x - anchor.x) * SCALE;
    const oz = span / 2 + (person.z - anchor.z) * SCALE;
    const land = `translate(${HERE.x * SIDE}px, ${HERE.y * SIDE}px) rotate(${(Math.round(degrees * 20) / 20).toFixed(2)}deg) translate(${q(-ox)}px, ${q(-oz)}px)`;
    if (land !== last.land) canvas.style.transform = last.land = land;
    if (marked !== null) {
      // The thing turns with the land; out past the scrap's edge, the ring waits at the edge toward it.
      const c = Math.cos(person.yaw);
      const s = Math.sin(person.yaw);
      const rx = (marked.x - person.x) * SCALE;
      const rz = (marked.z - person.z) * SCALE;
      const inset = 16;
      const mx = Math.max(inset, Math.min(SIDE - inset, HERE.x * SIDE + rx * c - rz * s));
      const my = Math.max(inset, Math.min(SIDE - inset, HERE.y * SIDE + rx * s + rz * c));
      const at = `translate(${q(mx)}px, ${q(my)}px)`;
      if (at !== last.mark) mark.style.transform = last.mark = at;
      mark.classList.toggle("left", mx > SIDE * 0.62);
    }
  }
  map.onPainted(() => {
    if (shown) redraw();
  });

  // The field map unfolds out of the scrap, turning from the way the person faces to north, and folds back into it.
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
    else if (does === "unfold") map.open(true);
  });
  touch.addEventListener("keydown", (e) => {
    if (e.code !== "Enter" && e.code !== "Space") return;
    if (tucked) tuck(false);
    else map.open(true);
  });

  // ---------- the area's name, lettered afresh on crossing into another ----------
  const namer = createNamer();
  let current = 0;
  /** The folders lettered above each repeated name, as the field map letters them, worked out once a world. */
  let tails: { of: WorldPlaces; above: Map<string, string> } | null = null;
  const measure = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  /** The largest size, up to the map's own, at which `label` in widely spaced capitals fits across the land. */
  function fitted(label: string): number {
    measure.font = `600 ${NAME.size}px ${SERIF}`;
    measure.letterSpacing = `${(NAME.size * NAME.spacing).toFixed(2)}px`;
    const width = measure.measureText(label).width;
    return Math.max(NAME.least, Math.min(NAME.size, (NAME.size * NAME.room) / Math.max(1, width)));
  }
  /** Fades the name lettered now, and letters `area`'s in its place; nothing for none. */
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
      // The window is drawn again only as the person nears its edge: in the page's idle time once they are halfway
      // there, and at once only if no idle moment came before they reached it.
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
      markName.textContent = thing.name;
      const r = Math.max(9, Math.min(26, thing.reach * SCALE + 6));
      markRing.style.width = markRing.style.height = `${(r * 2 * 48) / 30}px`;
      place();
      // A frame later, so the pencil draws the ring from nothing.
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
