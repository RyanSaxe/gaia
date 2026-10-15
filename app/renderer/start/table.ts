// The traveller's map table, in 3D (`table-scene.ts`): the worlds walked
// before lie on the sheet as pictures of their field maps, and a line at the
// sheet's foot waits for an address, written in ink from a text field no one
// sees. Touching a card chooses its world: the card lifts, rises toward the
// person and becomes the wait's sheet, while the table falls out of focus
// behind it. A world with no picture to show, as one whose code has changed
// since its map was drawn, lies as a card of the wait's bare sheet, with a
// tally in pencil of the commits since the person last opened it when its
// code has moved on (`tally.ts`). A folder or an address gets a fresh card of plain paper, laid
// on the sheet and risen the same way, and so does a world opened with no
// start. The table stays behind the wait until the world shows. Over the
// canvas lie only clear hit areas for the cards, the line and the folder's
// words, so a pointer, a finger and the keyboard all reach them.
//
// The table draws a frame only when something changes: the hour, the
// writing, a card moving. Once the wait lifts it lets go of its renderer,
// textures and geometry.

import type { StartChoice, StartOffer } from "../../world-service/protocol.ts";
import { RECENT_KEPT } from "../../world-service/recent.ts";
import { SHEET_LOGO } from "../brand/logo.ts";
import { DECKLE_MASK } from "../immersive/map-styles.ts";
import { REFUSALS, type StartPage, askFolder, placeOf } from "./choice.ts";
import type { Writing } from "./table-ink.ts";
import { tableLayout } from "./table-layout.ts";
import { drawTally } from "./tally.ts";
import { LAY_S, LIFT_S, RISE_S, type Rect, type Sheet, type TableScene, createTableScene } from "./table-scene.ts";

/** How long the darker stroke takes to run along the line, and an answer to be written in, seconds. */
const READING_S = 1.2;
const ANSWER_S = 0.7;
/** A view narrower than this, over its height, is a phone's: the sheet stands upright. */
const UPRIGHT = 0.8;
/** How long a chosen map takes to lift and rise into the wait's sheet, ms. */
export const CHOSEN_MS = (LIFT_S + RISE_S) * 1000;
/** How long the table takes to come in when shown, ms (start.css, `.start`). */
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
  /** Where the wait's sheet lies on the page: a chosen card ends there. */
  readonly sheet: () => DOMRect;
  /** A card is chosen: its picture, its land's shape (width over depth), which the wait's sheet takes as its own, and the commit it pictures. */
  readonly chosen?: (picture: string, aspect: number, commit: string | undefined) => void;
  /** The wait's sheet as it is painted now, in its shape: a fresh card's face, so it rises into the sheet as the sheet. */
  readonly face?: () => HTMLCanvasElement;
  /** Pencils on the wait's sheet what a chosen card had pencilled on its face (`WaitView.pencil`). */
  readonly pencil?: (draw: (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void) => void;
  /** The chosen card has become the wait's sheet: the sheet shows in its place, and the wait may paint on. */
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
  /** Whether the chosen card has been drawn at its end, in the wait's sheet's place, and whether it has become that sheet. */
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
        // Drawn once exactly at its end, so the frame before the sheet takes its place is the sheet's own.
        arrived = true;
        moving = true;
      } else if (!landed) {
        // The card lies where the wait's sheet is, drawn as the page draws it: in this one frame the sheet shows in its
        // place and the card goes, the table behind them.
        landed = true;
        veil.dataset.table = "behind";
        scene.withdraw(0);
        options.landed?.();
      }
    }
    scene.render();
    if (moving) draw();
  }
  /** The wait's sheet on the canvas, and how dark the veil has it. */
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
    const [logo, deckle, ...pictures] = await Promise.all([decoded(SHEET_LOGO), decoded(DECKLE_MASK.slice(5, -2)), ...recent.map((r) => (r.picture === undefined ? null : decoded(r.picture).catch(() => null)))]);
    const w = Math.max(1, root.clientWidth);
    const h = Math.max(1, root.clientHeight);
    phone = w / h < UPRIGHT;
    // A world with no picture to show, as one whose code has changed since, lies as a card of the wait's own bare sheet,
    // in the sheet's shape, so it rises into the sheet as the sheet does for a fresh card, and its map is drawn there.
    const bare = pictures.includes(null) ? (options.face?.() ?? null) : null;
    // One whose code has moved on since the person last opened it has the commits since tallied on it.
    const tallies = recent.map((r) => (r.commitsSince === undefined ? null : tallyOf(r.commitsSince, r.root)));
    const faces = recent.map((_, i) => pictures[i] ?? (bare === null ? null : tallied(bare, tallies[i] ?? null)));
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
          const picture = pictures[i];
          if (r.picture !== undefined && picture !== null && picture !== undefined) options.chosen?.(r.picture, picture.naturalWidth / Math.max(1, picture.naturalHeight), r.commit);
          const tally = tallies[i];
          if (tally !== null && tally !== undefined) options.pencil?.(tally);
          lift(i, performance.now());
          choose(placeOf(r));
        });
        return b;
      }),
    );
    placeHits();
  }

  /** The tally of `commits` drawn on a card's face, the same strokes for the same world. */
  type Pencilled = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
  const tallyOf = (commits: number | null, root: string): Pencilled => (c, x, y, w, h) => drawTally(c, x, y, w, h, commits, root);
  /** The bare face with `pencilled` drawn on a copy of it, or the bare face itself with nothing to draw. */
  function tallied(bare: HTMLCanvasElement, pencilled: Pencilled | null): HTMLCanvasElement {
    if (pencilled === null) return bare;
    const face = document.createElement("canvas");
    face.width = bare.width;
    face.height = bare.height;
    const c = face.getContext("2d") as CanvasRenderingContext2D;
    c.drawImage(bare, 0, 0);
    pencilled(c, 0, 0, face.width, face.height);
    return face;
  }

  /** Card `index` lifts from `at` and rises into the wait's sheet. */
  function lift(index: number, at: number): void {
    chosen = { index, at };
    root.classList.add("choosing");
    draw();
  }
  /**
   * A world with no card of its own gets a fresh one, in the shape the wait's sheet has and with that sheet's face,
   * laid on the sheet `after` ms from now and risen.
   */
  function liftFresh(after = 0): void {
    if (scene === null || chosen !== null) return;
    const s = options.sheet();
    lift(scene.fresh(s.width / Math.max(1, s.height), options.face?.() ?? null), performance.now() + after + LAY_S * 1000);
  }
  /** Shows the table once its first frame is drawn, so it comes in whole, in front of the wait. */
  function show(): void {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        root.classList.add("shown");
        if (veil.dataset.table !== "behind") veil.dataset.table = "front";
      }),
    );
  }

  // A phone turned on its side, or a window made narrow, lays the table out again.
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
      const same = scene !== null && recent.length === shown.length && recent.every((r, i) => r.root === shown[i]?.root && r.picture === shown[i]?.picture);
      shown = recent;
      chosen = null;
      arrived = false;
      landed = false;
      readingFrom = null;
      root.classList.remove("choosing");
      // Offered again on the same table, as when a place is refused, a card that had risen is back and in front.
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
      // The page passes the hour every frame; the table draws again only when its light has changed.
      if (scene?.hour(h) === true) draw();
    },
    leave() {
      if (leaving) return;
      settle = null;
      leaving = true;
      input.blur();
      root.classList.add("choosing");
      // A chosen card is already on its way. A folder, an address, or a world opened with no start gets a fresh card,
      // on the table as it is or, opened with no start, on an empty one built for it.
      if (scene !== null) liftFresh();
      else
        void build([]).then(() => {
          if (scene === null) return;
          scene.choose(null, 0);
          write(writing);
          draw();
          show();
          // Once the empty table has come in (start.css), so the card is laid on a table already there.
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
