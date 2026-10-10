// The traveller's map table, in 3D (`table-scene.ts`): the worlds walked
// before lie on the sheet as pictures of their field maps, and a line at the
// sheet's foot waits for an address, written in ink from a text field no one
// sees. Touching a card chooses its world: the card lifts, rises toward the
// person and becomes the wait's sheet, while the table fades into the wait's
// paper. Over the canvas lie only clear hit areas for the cards, the line and
// the folder's words, so a pointer, a finger and the keyboard all reach them.
//
// The table draws a frame only when something changes: the hour, the
// writing, a card moving. Once it has given way to the wait it stops and
// lets go of its renderer, textures and geometry.

import type { StartChoice, StartOffer } from "../../world-service/protocol.ts";
import { RECENT_KEPT } from "../../world-service/recent.ts";
import { SHEET_LOGO } from "../brand/logo.ts";
import { REFUSALS, type StartPage, askFolder, placeOf } from "./choice.ts";
import type { Writing } from "./table-ink.ts";
import { tableLayout } from "./table-layout.ts";
import { LIFT_S, RISE_S, type Rect, type TableScene, createTableScene } from "./table-scene.ts";

/** How long the darker stroke takes to run along the line, and an answer to be written in, seconds. */
const READING_S = 1.2;
const ANSWER_S = 0.7;
/** A view narrower than this, over its height, is a phone's: the sheet stands upright. */
const UPRIGHT = 0.8;
/** How long a chosen map takes to lift and rise into the wait's sheet, ms. */
export const CHOSEN_MS = (LIFT_S + RISE_S) * 1000;

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
      else if (leaving) fadeOut();
    }
    scene.render();
    if (moving) draw();
  }
  /** The wait's sheet on the canvas. */
  const toSheet = (): Rect => {
    const s = options.sheet();
    const r = root.getBoundingClientRect();
    return { x: s.left - r.left, y: s.top - r.top, w: s.width, h: s.height };
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
    const [logo, ...pictures] = await Promise.all([decoded(SHEET_LOGO), ...recent.map((r) => (r.picture === undefined ? null : decoded(r.picture).catch(() => null)))]);
    const w = Math.max(1, root.clientWidth);
    const h = Math.max(1, root.clientHeight);
    phone = w / h < UPRIGHT;
    const next = createTableScene(tableLayout(phone, recent.length), recent.map((world, i) => ({ world, picture: pictures[i] ?? null })), logo as HTMLImageElement, { w, h, dpr: Math.min(window.devicePixelRatio || 1, 2) });
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
          chosen = { index: i, at: performance.now() };
          root.classList.add("choosing");
          draw();
          choose(placeOf(r));
        });
        return b;
      }),
    );
    placeHits();
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

  function fadeOut(): void {
    if (gone || root.classList.contains("leaving")) return;
    input.blur();
    root.classList.add("leaving");
    window.setTimeout(() => {
      gone = true;
      cancelAnimationFrame(frame);
      resized.disconnect();
      scene?.dispose();
      scene = null;
      root.remove();
    }, 1400);
  }

  return {
    offer(offer) {
      const recent = offer.recent.slice(0, RECENT_KEPT);
      const same = scene !== null && recent.length === shown.length && recent.every((r, i) => r.root === shown[i]?.root && r.picture === shown[i]?.picture);
      shown = recent;
      chosen = null;
      readingFrom = null;
      root.classList.remove("choosing");
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
        // Shown once its first frame is drawn, so it comes in whole.
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("shown")));
      });
      return new Promise((resolve) => (settle = resolve));
    },
    hour(h) {
      hour = h;
      if (scene === null) return;
      scene.hour(h);
      draw();
    },
    leave() {
      settle = null;
      leaving = true;
      // A chosen card finishes its rise into the wait's sheet first; otherwise the table dissolves into the wait now.
      if (chosen === null || performance.now() - chosen.at >= CHOSEN_MS) fadeOut();
    },
  };
}
