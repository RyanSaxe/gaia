// On the start page's 3D map table (`table-scene.ts`), recent worlds lie on the
// sheet as cards, an address typed in a hidden field is drawn in ink on a line,
// and a chosen card rises into the wait's sheet while the table blurs behind it.
// Only clear hit areas lie over the canvas, so pointer, touch and keyboard reach
// the cards, the line and the folder text. The table renders a frame only when
// something changes, and releases its renderer, textures and geometry once the
// wait lifts.

import type { StartChoice, StartOffer } from "../../world-service/protocol.ts";
import { RECENT_KEPT } from "../../world-service/recent.ts";
import { SHEET_LOGO } from "../brand/logo.ts";
import { DECKLE_MASK } from "../immersive/map-styles.ts";
import { REFUSALS, type StartPage, askFolder, placeOf } from "./choice.ts";
import type { Writing } from "./table-ink.ts";
import { tableLayout } from "./table-layout.ts";
import { drawTally } from "./tally.ts";
import { LAY_S, LIFT_S, RISE_S, type Rect, type Sheet, type TableScene, createTableScene } from "./table-scene.ts";

/** Seconds for the darker stroke to run along the line, and for an answer to be written in. */
const READING_S = 1.2;
const ANSWER_S = 0.7;
/** A view whose width over height is below this is a phone's, and the sheet is laid out portrait. */
const UPRIGHT = 0.8;
/** How long a chosen card takes to lift and rise into the wait's sheet, in milliseconds. */
export const CHOSEN_MS = (LIFT_S + RISE_S) * 1000;
/** How long the table takes to fade in when shown, in milliseconds (start.css, `.start`). */
const SHOWN_MS = 900;

const decoded = async (src: string): Promise<HTMLImageElement> => {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
};

export interface TableOptions {
  /** The hour the world shows now. */
  readonly hour: number;
  /** The wait's sheet position on the page, where a chosen card ends. */
  readonly sheet: () => DOMRect;
  /** Called with the face of a chosen card that has a painting or a tally. The wait's sheet takes the face's aspect. */
  readonly chosen?: (face: HTMLImageElement | HTMLCanvasElement) => void;
  /** Returns the wait's sheet as currently painted, in its aspect, for a fresh card's face, so the card rises into the sheet looking like it. */
  readonly face?: () => HTMLCanvasElement;
  /** Called when the chosen card has become the wait's sheet. The sheet shows in its place, and the wait may resume painting. */
  readonly landed?: () => void;
}

export function createTable(veil: HTMLElement, options: TableOptions): StartPage {
  const root = document.createElement("div");
  root.className = "start start-table";
  root.innerHTML = /* html */ `
    <div class="table-hits">
      <div class="table-cards"></div>
      <form class="table-line" autocomplete="off">
        <label class="table-unseen" for="start-address">the address of a place on GitHub</label>
        <input id="start-address" name="address" type="text" spellcheck="false" autocapitalize="off" autocomplete="off">
      </form>
      <button type="button" class="table-folder">or open a folder on this computer</button>
    </div>
    <p class="table-unseen" aria-live="polite"></p>`;
  veil.append(root);
  const cardsEl = root.querySelector(".table-cards") as HTMLElement;
  const form = root.querySelector(".table-line") as HTMLFormElement;
  const input = root.querySelector("input") as HTMLInputElement;
  const folderEl = root.querySelector(".table-folder") as HTMLButtonElement;
  const said = root.querySelector("p.table-unseen") as HTMLElement;

  let scene: TableScene | null = null;
  let hour = options.hour;
  let shown: StartOffer["recent"] = [];
  let phone = false;
  let writing: Writing = { typed: "", reading: 0, answer: "", answered: 1 };
  /** When the darker stroke began to run, when an answer began to be written, and which card was chosen when. */
  let readingFrom: number | null = null;
  let answerFrom: number | null = null;
  let chosen: { readonly index: number; readonly at: number } | null = null;
  /** Whether the chosen card has been drawn at its end over the wait's sheet, and whether the sheet has replaced it. */
  let arrived = false;
  let landed = false;
  let leaving = false;
  let gone = false;

  let settle: ((place: StartChoice) => void) | null = null;
  const choose = (place: StartChoice): void => {
    const s = settle;
    settle = null;
    s?.(place);
  };

  // ---------- drawing, only when something changes ----------
  let frame = 0;
  const draw = (): void => {
    if (frame === 0 && scene !== null && !gone) frame = requestAnimationFrame(tick);
  };
  function tick(now: number): void {
    frame = 0;
    if (scene === null || gone) return;
    let moving = false;
    if (readingFrom !== null && writing.reading < 1) {
      const reading = Math.min(1, (now - readingFrom) / 1000 / READING_S);
      moving ||= reading < 1;
      write({ ...writing, reading });
    }
    if (answerFrom !== null) {
      const answered = Math.min(1, (now - answerFrom) / 1000 / ANSWER_S);
      if (answered >= 1) answerFrom = null;
      else moving = true;
      write({ ...writing, answered });
    }
    if (chosen !== null) {
      const t = (now - chosen.at) / 1000;
      scene.choose(chosen.index, Math.min(t, CHOSEN_MS / 1000), toSheet());
      if (t * 1000 < CHOSEN_MS) moving = true;
      else if (!arrived) {
        // Draws one frame exactly at the card's end, so the frame before the sheet replaces it already matches the sheet.
        arrived = true;
        moving = true;
      } else if (!landed) {
        // The card now lies where the wait's sheet is, drawn as the page draws the sheet. In this one frame the sheet shows
        // in its place, the card is withdrawn, and the table moves behind.
        landed = true;
        veil.dataset.table = "behind";
        scene.withdraw(0);
        options.landed?.();
      }
    }
    scene.render();
    if (moving) draw();
  }
  /** The wait's sheet rectangle relative to the canvas, and the veil's `--night`. */
  const toSheet = (): Sheet => {
    const s = options.sheet();
    const r = root.getBoundingClientRect();
    const night = Number.parseFloat(getComputedStyle(veil).getPropertyValue("--night"));
    return { x: s.left - r.left, y: s.top - r.top, w: s.width, h: s.height, night: Number.isFinite(night) ? night : 0 };
  };
  function write(next: Writing): void {
    writing = next;
    scene?.write(writing);
    placeHits();
  }

  // ---------- the hit areas over the canvas ----------
  const place = (el: HTMLElement, r: Rect): void => {
    el.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
    el.style.width = `${r.w.toFixed(1)}px`;
    el.style.height = `${r.h.toFixed(1)}px`;
  };
  function placeHits(): void {
    if (scene === null) return;
    const hits = scene.hits();
    [...cardsEl.children].forEach((el, i) => {
      const r = hits.cards[i];
      if (r !== undefined) place(el as HTMLElement, r);
    });
    place(form, hits.line);
    place(folderEl, hits.folder);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const address = input.value.trim();
    if (address === "" || settle === null) return;
    readingFrom = performance.now();
    answerFrom = null;
    write({ ...writing, typed: input.value, answer: "", reading: 0 });
    draw();
    choose({ address });
  });
  input.addEventListener("input", () => {
    readingFrom = null;
    answerFrom = null;
    write({ typed: input.value, reading: 0, answer: "", answered: 1 });
    draw();
  });
  folderEl.addEventListener("click", () => {
    void askFolder().then((f) => {
      if (f !== null) choose({ folder: f });
    });
  });

  // ---------- building the table for an offer ----------
  /** Builds the table for the worlds offered and readies it to draw. */
  async function build(recent: StartOffer["recent"]): Promise<void> {
    const [logo, deckle, ...paintings] = await Promise.all([decoded(SHEET_LOGO), decoded(DECKLE_MASK.slice(5, -2)), ...recent.map((r) => (r.painting === undefined ? null : decoded(r.painting).catch(() => null)))]);
    const w = Math.max(1, root.clientWidth);
    const h = Math.max(1, root.clientHeight);
    phone = w / h < UPRIGHT;
    // A world with no painting, such as one left before the person stopped anywhere in it, gets a card showing the wait's
    // bare sheet in the sheet's aspect, so it rises into the sheet as a fresh card does.
    const bare = paintings.includes(null) ? (options.face?.() ?? null) : null;
    // A world whose code has moved on since the person last opened it gets a tally of the commits since.
    const tallies = recent.map((r) => (r.commitsSince === undefined ? null : tallyOf(r.commitsSince, r.root)));
    const faces = recent.map((_, i) => {
      const painting = paintings[i] ?? null;
      const face = painting ?? bare;
      return face === null ? null : tallied(face, tallies[i] ?? null, painting !== null);
    });
    const next = createTableScene(tableLayout(phone, recent.length), recent.map((world, i) => ({ world, picture: faces[i] ?? null })), logo as HTMLImageElement, deckle as HTMLImageElement, { w, h, dpr: Math.min(window.devicePixelRatio || 1, 2) });
    next.canvas.className = "table-view";
    next.hour(hour);
    next.write(writing);
    await next.compile();
    if (gone) {
      next.dispose();
      return;
    }
    scene?.canvas.remove();
    scene?.dispose();
    scene = next;
    root.prepend(next.canvas);
    cardsEl.replaceChildren(
      ...recent.map((r, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "table-card";
        b.setAttribute("aria-label", r.name);
        b.addEventListener("click", () => {
          if (settle === null || chosen !== null) return;
          // A card with a painting or a tally becomes the wait's sheet face up, then flips to the sheet's bare paper for the
          // map. A bare card already shows the sheet.
          const face = faces[i];
          if (face !== null && face !== undefined && face !== bare) options.chosen?.(face);
          lift(i, performance.now());
          choose(placeOf(r));
        });
        return b;
      }),
    );
    placeHits();
  }

  /** Draws the tally of `commits` on a card's face, with the same strokes for the same world. On a painting, a paper-toned halo goes under it. */
  type Pencilled = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, onPaint?: boolean) => void;
  const tallyOf = (commits: number | null, root: string): Pencilled => (c, x, y, w, h, onPaint = false) => drawTally(c, x, y, w, h, commits, root, onPaint);
  /** Returns a copy of `face` with `pencilled` drawn on it, or `face` itself when there is nothing to draw. `onPaint` is true when the face is a painting. */
  function tallied<F extends HTMLCanvasElement | HTMLImageElement>(face: F, pencilled: Pencilled | null, onPaint: boolean): F | HTMLCanvasElement {
    if (pencilled === null) return face;
    const copy = document.createElement("canvas");
    copy.width = face instanceof HTMLImageElement ? face.naturalWidth : face.width;
    copy.height = face instanceof HTMLImageElement ? face.naturalHeight : face.height;
    const c = copy.getContext("2d") as CanvasRenderingContext2D;
    c.drawImage(face, 0, 0);
    pencilled(c, 0, 0, copy.width, copy.height, onPaint);
    return copy;
  }

  /** Starts card `index` lifting at time `at` and rising into the wait's sheet. */
  function lift(index: number, at: number): void {
    chosen = { index, at };
    root.classList.add("choosing");
    draw();
  }
  /**
   * Gives a world with no card a fresh one, in the wait's sheet's aspect and with that sheet's face. The card is laid on
   * the table's sheet `after` ms from now and then rises.
   */
  function liftFresh(after = 0): void {
    if (scene === null || chosen !== null) return;
    const s = options.sheet();
    lift(scene.fresh(s.width / Math.max(1, s.height), options.face?.() ?? null), performance.now() + after + LAY_S * 1000);
  }
  /** Shows the table once its first frame is drawn, so it fades in complete, in front of the wait. */
  function show(): void {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        root.classList.add("shown");
        if (veil.dataset.table !== "behind") veil.dataset.table = "front";
      }),
    );
  }

  // Rotating a phone or resizing a window across `UPRIGHT` rebuilds the table's layout.
  const resized = new ResizeObserver(() => {
    if (scene === null || gone) return;
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w === 0 || h === 0) return;
    if (w / h < UPRIGHT !== phone && chosen === null) {
      void build(shown).then(draw);
      return;
    }
    scene.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
    placeHits();
    draw();
  });
  resized.observe(root);

  return {
    offer(offer) {
      const recent = offer.recent.slice(0, RECENT_KEPT);
      const same = scene !== null && recent.length === shown.length && recent.every((r, i) => r.root === shown[i]?.root && r.painting === shown[i]?.painting && r.commitsSince === shown[i]?.commitsSince);
      shown = recent;
      chosen = null;
      arrived = false;
      landed = false;
      readingFrom = null;
      root.classList.remove("choosing");
      // On a new offer to the same table, such as after a refused address, a card that had risen returns and the table
      // moves in front.
      scene?.withdraw(1);
      if (veil.dataset.table === "behind") veil.dataset.table = "front";
      if (offer.refused !== undefined) {
        input.value = offer.refused.address;
        said.textContent = REFUSALS[offer.refused.why];
        answerFrom = performance.now();
        writing = { typed: offer.refused.address, reading: 0, answer: REFUSALS[offer.refused.why], answered: 0 };
        input.focus({ preventScroll: true });
      } else if (recent.length === 0) input.focus({ preventScroll: true });
      void (same ? Promise.resolve() : build(recent)).then(() => {
        if (scene === null) return;
        scene.choose(null, 0);
        write(writing);
        draw();
        show();
      });
      return new Promise((resolve) => (settle = resolve));
    },
    hour(h) {
      hour = h;
      // The page passes the hour every frame, and the table redraws only when its light has changed.
      if (scene?.hour(h) === true) draw();
    },
    leave() {
      if (leaving) return;
      settle = null;
      leaving = true;
      input.blur();
      root.classList.add("choosing");
      // A chosen card is already rising. A folder, an address, or a world opened without the start page gets a fresh card,
      // on the current table or, without the start page, on an empty table built for it.
      if (scene !== null) liftFresh();
      else
        void build([]).then(() => {
          if (scene === null) return;
          scene.choose(null, 0);
          write(writing);
          draw();
          show();
          // Waits for the empty table to fade in (start.css), so the card is laid on a visible table.
          liftFresh(SHOWN_MS);
        });
    },
    close() {
      gone = true;
      cancelAnimationFrame(frame);
      resized.disconnect();
      scene?.dispose();
      scene = null;
      root.remove();
      delete veil.dataset.table;
    },
  };
}
