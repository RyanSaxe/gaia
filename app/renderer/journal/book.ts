// Draws the journal as a leather book with CSS 3D transforms. Shut, it sits in
// the lower left corner with the minimap on a slip on its cover. The left-hand
// page is always the back of the cover, so the cover shuts over the page being
// read, and only the open spread and a turning leaf exist in the DOM at once.

import "./journal.css";
import LEATHER from "./leather.webp";
import PAPER from "./paper.webp";
import { linesOf } from "./page.ts";
import { RIBBON_LIE, RIBBON_POSES, ribbonSvg, ribbonTransform } from "./ribbon.ts";
import { type Curl, angleOf, createCurl } from "./curl.ts";
import { swipes } from "./swipe.ts";
import { loadTitleFace } from "./title-face.ts";

/** The two pages a place in the book opens onto. */
export interface Spread {
  readonly left: HTMLElement;
  readonly right: HTMLElement;
}

/** The book's pages, addressed by place: "map" (the endpapers), "contents", or an entry's `of`. */
export interface BookPages {
  spread(at: string): Spread;
  /** The place a page turn forward (+1) or back (-1) reaches from `at`, or null past either end. */
  next(at: string, by: 1 | -1): string | null;
  /** Negative when `a` comes before `b` in the book. */
  order(a: string, b: string): number;
  /** The tabs on the fore-edge: each tab's name, the place it opens, and the first chapter of its part of the book. */
  tabs(): readonly { readonly name: string; readonly at: string; readonly from: string }[];
  /** Resolves once everything a place's spread needs, such as a file's text, has arrived, so its pages are drawn complete. */
  ready?(at: string): Promise<void>;
  /**
   * Resolves once a place's painting is done, or found to have nothing to paint, so a page never shows before its
   * painting. The book waits for it however long it takes.
   */
  painted?(at: string): Promise<void>;
  /**
   * Returns the faces a riffle from `from` toward `toward` shows. For face `k` of `of`, it returns a page of real code
   * from a file between the two, or null when no code has arrived yet.
   */
  passing?(from: string, toward: string): (k: number, of: number) => HTMLElement | null;
  /** A place's position in the book from 0 at the front to 1 at the back, which sets the thickness of the page edges. */
  fraction?(at: string): number;
}

export interface JournalBook {
  /** Moves the book from its corner and opens it at a place, the map by default. */
  open(at?: string): void;
  /** Turns to a place, forward or back, in one motion however far it is. */
  turnTo(at: string): void;
  /** Shuts the book over the open page and moves it back to its corner. */
  close(): void;
  readonly isOpen: boolean;
  /** The slip on the cover, which holds the minimap. */
  readonly slip: HTMLElement;
  /** Rebuilds the tabs and redraws the open spread after the pages' content changes. */
  refresh(): void;
  state(): { readonly open: boolean; readonly at: string | null; readonly turning: boolean };
}

/** A page's size in the book's own pixels, and how far the boards overhang the pages. */
export const PAGE = { w: 520, h: 660, overhang: 10 } as const;
/** The width of a page's outer fifth in the book's pixels. A click there turns the page, even over a map or a picture. */
const EDGE = PAGE.w / 5;
/**
 * The longest delay in ms before a page shows without its text, which only text that failed to arrive takes. There is
 * no limit for its painting, because a painting of a far place waits for that place's land, which waits while the
 * person travels.
 */
const TEXT_AT_MOST = 20000;
/** How many ms a turn to an adjacent page holds the lifted page while that page's painting finishes, before the book riffles instead. */
const BESIDE_MS = 1500;
/**
 * How far in degrees a leaf turns while its far side's painting is still
 * being made, and how many ms it takes to get there. The leaf lifts at once so
 * a tap gets a response, stops while the painting is out of sight, and
 * finishes turning once the painting is done.
 */
const HOLD = { forward: -64, back: -175, ms: 1600 } as const;
/** How many px a page must be dragged toward the spine before it counts as a drag rather than a tap. */
const DRAG = { start: 12 } as const;
/** How far the margins are raised toward the viewer in the book's pixels, above the 36 px a lifted page's edge rises (`liftMargins`). */
const MARGIN_LIFT = 40;
/** The journal's CSS perspective in journal.css, which the margins' scale compensates for. */
const MARGIN_PERSPECTIVE = 2400;
/** Durations in ms of a leaf turn, the cover's swing, and the book's move between its corner and the middle of the view. */
const TURN_MS = 720;
const COVER_MS = 900;
const TRAVEL_MS = 1050;
/**
 * How many ms after the cover starts to open a following riffle may start. Its first leaf, or the ribbon lifted
 * before it, then trails the cover all the way over instead of overtaking it.
 */
const COVER_LEAD = 420;
/** The shut book's tilt in its corner, in degrees. */
const CORNER_TILT = 6;
/** The shut book in its corner: its scale, which shows the minimap on the slip at 0.86 of its own size, and its margins in px from the screen's edges. */
const CORNER = { scale: 0.86, margin: { x: 12, y: 14 } } as const;
/** The share of the view's width and height the open book may fill. */
const FILL = { w: 0.94, h: 0.88 } as const;
/**
 * Timing in ms for lifting the ribbon across onto the page a riffle leaves: the swing over (`ms`), the reveal out of
 * the leaves (`drawn`), and the delay before the leaves start (`leaves`).
 */
const LIFT = { ms: 620, drawn: 320, leaves: 440 } as const;
/** How far the ribbon lies off the front of a leaf that carries it, in the book's pixels. */
const RIBBON_ON_LEAF = 0.3;
/**
 * Duration in ms and easing for a turning leaf that falls to the right when the book shuts. It is fast enough that the
 * bent leaf stays ahead of the cover (`.jb-cover`, 900 ms) from any angle short of lying on the left.
 */
const FALL = { ms: 420, ease: "cubic-bezier(0,0,.3,1)" } as const;
/** The z offset of a turning leaf's strips (`.jb-curl` in journal.css), which a ribbon on that leaf uses too. */
const CURL_Z = 1.3;
/** Where the ribbon lies from the open spread: on it, among the leaves before it, or among those after it. */
type RibbonSide = "here" | "before" | "after";

const el = (cls: string, parent?: HTMLElement): HTMLDivElement => {
  const e = document.createElement("div");
  e.className = cls;
  parent?.append(e);
  return e;
};

export function createJournalBook(layer: HTMLElement, pages: BookPages, onOpen: (open: boolean) => void): JournalBook {
  loadTitleFace();
  const root = el("journal", layer);
  // An SVG filter (`jp-brush`) that roughens the edges of the mark strokes down the gutter.
  root.insertAdjacentHTML(
    "beforeend",
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <filter id="jp-brush" x="-60%" y="-5%" width="220%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="7" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="0.7"/></filter>
    </svg>`,
  );
  root.style.setProperty("--leather", `url(${LEATHER})`);
  root.style.setProperty("--paper", `url(${PAPER})`);
  root.style.setProperty("--pw", `${PAGE.w}px`);
  root.style.setProperty("--ph", `${PAGE.h}px`);
  root.style.setProperty("--ov", `${PAGE.overhang}px`);
  root.style.setProperty("--edge", `${EDGE}px`);
  // While the book is open, `catcher` covers the world, and a tap anywhere outside the book shuts it.
  const catcher = el("journal-catch", root);
  const book = el("journal-book", root);
  const inner = el("jb-inner", book);
  el("jb-spine", inner);
  el("jb-board", inner);
  const blockRight = el("jb-block", inner);
  const right = el("jb-right", inner);
  const tabs = el("jb-tabs", inner);
  // The shadow a turning leaf casts on each page, and the strips it bends in (`curl.ts`).
  const shades = { right: el("jb-shade right", inner), left: el("jb-shade left", inner) };
  const curlHost = el("jb-curl", inner);
  const leaf = el("jb-leaf", inner);
  const leafFront = el("jb-face front", leaf);
  const leafBack = el("jb-face back", leaf);
  const cover = el("jb-cover", inner);
  const coverFront = el("jb-face front", cover);
  const coverBack = el("jb-face back", cover);
  el("jb-stitch", coverFront);
  const slip = el("jb-slip", coverFront);
  el("jb-strap", coverFront);
  const blockLeft = el("jb-block left", coverBack);
  const left = el("jb-left", coverBack);
  leaf.hidden = true;
  // A ribbon bookmark left at the page a riffle started from (`ribbon.ts`). A tap on it goes back there. It starts at
  // the map and is drawn once. Only its pose about the spine and how much of it shows change.
  const ribbon = el("jb-ribbon", inner);
  let marked = "map";
  {
    const drawn = ribbonSvg(RIBBON_LIE);
    ribbon.style.left = `${drawn.left}px`;
    ribbon.style.top = `${drawn.top}px`;
    ribbon.style.width = `${drawn.width}px`;
    ribbon.style.height = `${drawn.height}px`;
    ribbon.style.transformOrigin = `${-drawn.left}px 0`;
    ribbon.style.setProperty("--head", `${-PAGE.h / 2 - drawn.top}px`);
    ribbon.style.setProperty("--foot", `${PAGE.h / 2 - drawn.top}px`);
    for (const [name, pose] of Object.entries(RIBBON_POSES)) ribbon.style.setProperty(`--${name}`, ribbonTransform(pose));
    ribbon.innerHTML = drawn.svg;
    ribbon.dataset.side = "here";
  }

  let open = false;
  let at: string | null = null;
  let turning = false;
  let queued: string | null = null;

  // `put` finishes a page as soon as it is placed, before it can be seen. It ends on a whole line and Jev's marks are
  // painted beside their rows, so no page visibly changes.
  const put = (into: HTMLElement, page: HTMLElement | null): void => {
    into.replaceChildren(...(page === null ? [] : [page]));
    if (page !== null) finish(page);
  };
  function finish(page: HTMLElement): void {
    const body = page.querySelector<HTMLElement>(".jp-body");
    if (body === null) return;
    const bottom = body.clientHeight;
    /** A row's offset from the top of the page body, summed through the code or list that holds it. */
    const down = (e: HTMLElement): number => {
      let y = 0;
      for (let n: HTMLElement | null = e; n !== null && n !== body; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      return y;
    };
    const rows = [...body.querySelectorAll<HTMLElement>(".jp-line, .jp-row")];
    for (const row of rows) row.classList.toggle("jp-past", down(row) + row.offsetHeight > bottom);
    // A definition too long for its page gets a fold note where the page ends. The last row that fits is hidden to make room for it.
    const fold = body.querySelector<HTMLElement>(".jp-fold.after");
    if (fold !== null && rows.some((r) => r.classList.contains("jp-past"))) {
      const last = rows.filter((r) => !r.classList.contains("jp-past")).at(-1);
      if (last !== undefined) {
        last.classList.add("jp-past");
        const more = rows.filter((r) => r.classList.contains("jp-past") && r.classList.contains("jp-line")).length;
        fold.style.top = `${down(last)}px`;
        // A document's lines are paragraphs, so its fold says "read on" instead of a line count.
        fold.textContent = body.querySelector(".jp-code.prose") !== null ? "read on" : linesOf(more);
        fold.classList.add("shown");
      }
    }
    paintMarks(body);
  }
  /** Paints one gutter stroke for each run of lines a mark covers, and one beside each marked row. */
  function paintMarks(body: HTMLElement): void {
    for (const old of body.querySelectorAll(".jp-stroke")) old.remove();
    const shown = [...body.querySelectorAll<HTMLElement>(".jp-marked:not(.jp-past)")];
    const runs: HTMLElement[][] = [];
    for (const e of shown) {
      const last = runs[runs.length - 1]?.at(-1);
      const joins = last !== undefined && e.classList.contains("jp-line") && last.nextElementSibling === e && last.style.getPropertyValue("--mark") === e.style.getPropertyValue("--mark");
      if (joins) runs[runs.length - 1]?.push(e);
      else runs.push([e]);
    }
    for (const run of runs) {
      const first = run[0] as HTMLElement;
      const end = run[run.length - 1] as HTMLElement;
      const holder = first.parentElement as HTMLElement;
      const stroke = document.createElement("i");
      stroke.className = `jp-stroke ${first.classList.contains("jp-row") || first.classList.contains("jp-snippet") ? "row" : "line"}`;
      stroke.style.top = `${first.offsetTop + 3}px`;
      stroke.style.height = `${end.offsetTop + end.offsetHeight - first.offsetTop - 6}px`;
      stroke.style.background = first.style.getPropertyValue("--mark");
      holder.append(stroke);
    }
  }
  /** Where the ribbon lies from the spread open at `place`: on it, or among the leaves before or after it. */
  const sideOf = (place: string | null): RibbonSide =>
    place === null || pages.order(place, marked) === 0 ? "here" : pages.order(marked, place) < 0 ? "before" : "after";
  /** Rests the ribbon on its page's side, in journal.css's pose for that side. */
  function layRibbon(): void {
    const side = sideOf(at);
    if (ribbon.dataset.side !== side) rest(side);
  }
  /** Moves the ribbon to its rest pose on `side` without a transition. A leaf or the page over it hides the jump. */
  function rest(side: RibbonSide): void {
    ribbon.style.transition = "none";
    ribbon.style.transform = "";
    ribbon.style.removeProperty("--hid");
    ribbon.dataset.side = side;
    void ribbon.offsetWidth;
    ribbon.style.transition = "";
  }
  /** Poses the ribbon on the front of a leaf raised `z` and rotated `deg` about the spine, animated with `transition`. */
  function carry(z: number, deg: number, transition = "none"): void {
    ribbon.dataset.side = "carried";
    ribbon.style.transition = transition;
    ribbon.style.transform = ribbonTransform({ z, deg, off: RIBBON_ON_LEAF });
  }
  /**
   * Animates the ribbon out from the leaves on one side onto the open page, revealing it from the foot up as it
   * rises. Forward goes from the right-hand leaves onto the left-hand page, and back from the left-hand leaves onto
   * the right-hand page. It starts over the open page with only its head and tail showing, so it draws out on top of
   * that page rather than under it.
   */
  function liftAcross(forward: boolean): void {
    const [from, to] = forward ? ["here", "before"] : ["before", "here"];
    ribbon.dataset.side = "carried";
    ribbon.style.transition = "none";
    ribbon.style.transform = `var(--${from})`;
    ribbon.style.setProperty("--hid", "var(--foot)");
    void ribbon.offsetWidth;
    ribbon.style.transition = `transform ${LIFT.ms}ms cubic-bezier(.42,.05,.36,1), clip-path ${LIFT.drawn}ms cubic-bezier(.3,.1,.3,1)`;
    ribbon.style.transform = `var(--${to})`;
    ribbon.style.setProperty("--hid", "var(--head)");
  }
  /** Restarts the ribbon's sway animation when the book moves. */
  function sway(): void {
    ribbon.classList.remove("sway");
    void ribbon.offsetWidth;
    ribbon.classList.add("sway");
  }
  /**
   * The page edges on each side are as thick as the pages on that side, so near the front the left edge is thin and
   * the right thick, and they swap through the book. They stay within the boards' overhang. A riffle animates the
   * change over `ms`.
   */
  const EDGES = { least: 1.5, most: 9 } as const;
  function layDepth(place: string, ms = 0): void {
    const f = Math.max(0, Math.min(1, pages.fraction?.(place) ?? 0.5));
    const [l, r] = [EDGES.least + (EDGES.most - EDGES.least) * f, EDGES.least + (EDGES.most - EDGES.least) * (1 - f)];
    for (const [block, e, side] of [[blockRight, r, "right"], [blockLeft, l, "left"]] as const) {
      block.style.transition = ms > 0 ? `width ${ms}ms ease, left ${ms}ms ease, background-size ${ms}ms ease` : "none";
      block.style.width = `${PAGE.w + e}px`;
      const lines = `repeating-linear-gradient(90deg, #efe6cd 0 1px, #c4b593 1px 2px) ${side} top / ${e.toFixed(1)}px 100% no-repeat`;
      const head = "repeating-linear-gradient(0deg, #efe6cd 0 1px, #c4b593 1px 2px) left top / 100% 2px no-repeat, repeating-linear-gradient(0deg, #efe6cd 0 1px, #c4b593 1px 2px) left bottom / 100% 2px no-repeat";
      const fade = side === "right" ? "linear-gradient(90deg, #b9a983, #d9cdae 4%, #e5dabe)" : "linear-gradient(270deg, #b9a983, #d9cdae 4%, #e5dabe)";
      // A thick stack darkens toward its outer edge.
      const depth = `linear-gradient(${side === "right" ? 90 : 270}deg, rgba(0,0,0,0) calc(100% - ${e.toFixed(1)}px), rgba(70,50,25,${(0.04 + 0.022 * e).toFixed(3)}) 100%)`;
      block.style.background = `${depth}, ${lines}, ${head}, ${fade}`;
      const W = PAGE.w + e;
      block.style.clipPath = side === "right"
        ? `path("M0 2 C 10 0.6, 24 0, 44 0 L ${W} 0 L ${W} 664 L 44 664 C 24 664, 10 663.4, 0 662 Z")`
        : `path("M0 0 L ${W - 44} 0 C ${W - 24} 0, ${W - 10} 0.6, ${W} 2 L ${W} 662 C ${W - 10} 663.4, ${W - 24} 664, ${W - 44} 664 L 0 664 Z")`;
      if (side === "left") block.style.left = `${PAGE.overhang - e}px`;
    }
  }
  function markTabs(place: string): void {
    for (const t of tabs.children) t.classList.toggle("on", (t as HTMLElement).dataset.from !== undefined && within(place, (t as HTMLElement).dataset.from as string));
  }
  function show(place: string): void {
    layDepth(place);
    const s = pages.spread(place);
    put(left, s.left);
    put(right, s.right);
    at = place;
    markTabs(place);
    layEdges();
  }
  const after = (ms: number): Promise<void> => new Promise<void>((r) => window.setTimeout(r, ms));
  /** Resolves once a place's painting is done. */
  const painted = (place: string): Promise<void> => pages.painted?.(place) ?? Promise.resolve();
  /** Resolves once a place's code and painting have arrived, or, if the code never does, once the painting is done and `TEXT_AT_MOST` has passed. */
  const wholeAt = (place: string): Promise<void> => Promise.all([Promise.race([pages.ready?.(place), after(TEXT_AT_MOST)]), painted(place)]).then(() => undefined);
  /** Whether a promise settles within 40 ms. */
  const settledSoon = (p: Promise<void>): Promise<boolean> => Promise.race([p.then(() => true), after(40).then(() => false)]);
  /** Whether `place` lies in the part of the book from the tab at `chapter` to the next tab. */
  function within(place: string, chapter: string): boolean {
    const list = pages.tabs();
    const k = list.findIndex((t) => t.from === chapter);
    const next = list[k + 1];
    return pages.order(chapter, place) <= 0 && (next === undefined || pages.order(place, next.from) < 0);
  }

  // ---------- placement: in the corner, or open in the middle ----------

  /** The open book's transform and scale to fit the view, and the corner transform that puts the slip where the minimap is. */
  function poses(): { held: string; corner: string; scale: number } {
    const vw = layer.clientWidth || window.innerWidth;
    const vh = layer.clientHeight || window.innerHeight;
    const scale = Math.min((vw * FILL.w) / (PAGE.w * 2 + PAGE.overhang * 2), (vh * FILL.h) / (PAGE.h + PAGE.overhang * 2));
    // Places the slip's center, in the shut book's pixels from the book's center, in the lower left corner. The slip is
    // near the cover's outer edge, so the book extends off the screen's left and bottom.
    const slipX = -(26 + 92 - PAGE.w / 2);
    const slipY = 24 + 92 - PAGE.h / 2 - PAGE.overhang;
    const side = 156 * CORNER.scale;
    const mx = CORNER.margin.x + side / 2;
    const my = vh - CORNER.margin.y - side / 2;
    const k = (156 / 184) * CORNER.scale;
    const tilt = CORNER_TILT;
    const a = (tilt * Math.PI) / 180;
    const cx = mx - k * (slipX * Math.cos(a) - slipY * Math.sin(a));
    const cy = my - k * (slipX * Math.sin(a) + slipY * Math.cos(a));
    return {
      held: `translate(${vw / 2}px, ${vh / 2}px) rotateX(6deg) scale(${scale})`,
      corner: `translate(${cx}px, ${cy}px) rotateZ(${tilt}deg) scale(${k})`,
      scale,
    };
  }
  const closedShift = `translateX(${-(PAGE.w / 2 + PAGE.overhang / 2)}px)`;
  /** The outer margins that turn the pages, created with the click handling below. */
  const margins: HTMLElement[] = [];
  function place(isOpen: boolean): void {
    const p = poses();
    book.style.transform = isOpen ? p.held : p.corner;
    inner.style.transform = isOpen ? "translateX(0)" : closedShift;
    cover.classList.toggle("open", isOpen);
    liftMargins(p.scale);
  }
  /**
   * Raises the margins in front of a page lifted under the pointer and in front of the open cover, whose edges rise
   * about 36 of the book's pixels toward the viewer. Lower margins would flicker: a lifted page would cover its own
   * margin, the pointer would leave it, and the page would settle and show the margin again. The left margin, under
   * the cover, could not be reached at all. Raising them makes them look larger under the view's perspective
   * (`.journal` in journal.css), so each is scaled back about the spine by the same factor and covers the same edge.
   */
  function liftMargins(scale: number): void {
    const k = (MARGIN_PERSPECTIVE - MARGIN_LIFT * scale) / MARGIN_PERSPECTIVE;
    for (const m of margins) m.style.transform = `translateZ(${MARGIN_LIFT}px) scale(${k})`;
  }
  place(false);
  // A window resize moves the book without a transition. It animates between its corner and the middle only to open and shut.
  window.addEventListener("resize", () => {
    book.style.transition = "none";
    place(open);
  });

  // ---------- turning ----------

  function turnTo(target: string): void {
    if (!open || target === at) return;
    if (turning) {
      queued = target;
      return;
    }
    turning = true;
    const ready = wholeAt(target);
    const beside = at !== null && (pages.next(at, 1) === target || pages.next(at, -1) === target);
    void settledSoon(ready).then((now) => {
      // A far page is reached by a riffle, ready or not. An adjacent page turns as one leaf.
      if (at === null || !beside) return riffleTo(target, ready, now);
      if (now) return turnNow(target);
      // An adjacent page that is not ready lifts as it does under the pointer. The book riffles instead only if it takes longer than `BESIDE_MS`.
      const page = pages.order(at, target) < 0 ? right : cover;
      page.classList.add("lift");
      void Promise.race([ready.then(() => true), after(BESIDE_MS).then(() => false)]).then((came) => {
        page.classList.remove("lift");
        if (came) turnNow(target);
        else riffleTo(target, ready, false);
      });
    });
  }
  function turnNow(target: string): void {
    if (!open) {
      turning = false;
      return;
    }
    beginTurn(target).finish(0);
  }
  // ---------- riffling ----------

  /**
   * Riffle timing in ms and leaf counts: the gap between leaves at full pace (`gap`) and near the ends (`ends`), one
   * leaf's turn (`ms`), the most leaves turned before landing (`most`, or `whole` when the target is ready), and the
   * slower gap and turn while the target is still being built (`waiting`, `waitingMs`).
   */
  const RIFFLE = { gap: 55, ends: 140, ms: 560, most: 36, whole: 12, waiting: 300, waitingMs: 900 } as const;
  /** Four fixed SVG backgrounds of faint text lines, for faces a riffle shows without real code. */
  const GHOSTS = Array.from({ length: 4 }, (_, v) => {
    let seed = 17 + v * 101;
    const r = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const lines: string[] = [`<rect x="58" y="62" width="${150 + r() * 120}" height="9" rx="4.5" opacity="0.13"/>`];
    for (let y = 132; y < 610; y += 17) {
      if (r() < 0.12) continue;
      const indent = 92 + Math.floor(r() * 4) * 14;
      lines.push(`<rect x="${indent}" y="${y}" width="${40 + r() * (380 - indent)}" height="5" rx="2.5"/>`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="660" fill="#3a2f24" opacity="0.085">${lines.join("")}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  });
  const ghost = (k: number): HTMLElement => {
    const page = el("jp jp-ghost");
    page.style.backgroundImage = `${GHOSTS[k % GHOSTS.length]}, var(--paper)`;
    page.style.backgroundSize = "100% 100%, cover";
    return page;
  };
  /** Called when the book shuts during a turn or riffle, so its leaves fall shut with the cover. Null when none is running. */
  let shutUnderWay: (() => void) | null = null;
  /**
   * Animates leaves, or the ribbon, shut with the cover. Each is posed about the spine as `translateZ(z) rotateY(…)
   * translateZ(off)`. One lying on the left-hand leaves rides over with the cover at its height above the cover. One
   * in the air turns shut from its current angle over the cover's duration, so it stays ahead of the cover and
   * neither passes through it. The cover's heights open and shut are the ribbon's among its leaves (`RIBBON_POSES`).
   */
  function fallShut(each: readonly (readonly [HTMLElement, number, number])[]): void {
    const [opened, shut] = [RIBBON_POSES["before-open"].z, RIBBON_POSES["before-shut"].z];
    const poses = each.map(([e, z, off]) => {
      const deg = angleOf(e);
      const above = opened - (z - off);
      return deg < -170
        ? { e, from: `translateZ(${opened}px) rotateY(${deg}deg) translateZ(${above}px)`, to: `translateZ(${shut}px) rotateY(0deg) translateZ(${above}px)` }
        : { e, from: `translateZ(${z}px) rotateY(${deg}deg) translateZ(${off}px)`, to: `translateZ(${z}px) rotateY(0deg) translateZ(${off}px)` };
    });
    for (const p of poses) {
      p.e.style.transition = "none";
      p.e.style.transform = p.from;
    }
    void inner.offsetWidth;
    for (const p of poses) {
      p.e.style.transition = `transform ${COVER_MS}ms cubic-bezier(.45,.05,.3,1)`;
      p.e.style.transform = p.to;
    }
  }
  /**
   * Riffles toward a far page: many leaves turn in quick succession, several in the air at once, and the last carries
   * the target page once it is ready. While the target is still being built, the leaves keep turning more slowly.
   */
  function riffleTo(target: string, ready: Promise<void>, wholeNow: boolean): void {
    const from = at as string;
    const forward = pages.order(from, target) < 0;
    // A riffle leaves the ribbon at the page it started from, unless it is going back to the ribbon. If the ribbon lies
    // among the leaves on the side away from where that page will end up, it is first lifted across onto it.
    const home = target === marked;
    const lies = home ? null : sideOf(from);
    if (!home) marked = from;
    const lifts = lies === (forward ? "after" : "before");
    if (lifts) liftAcross(forward);
    let whole = wholeNow;
    void ready.then(() => (whole = true));
    let distance = 0;
    for (let p: string | null = from; p !== null && p !== target && distance < 400; distance++) p = pages.next(p, forward ? 1 : -1);
    const leaves = Math.max(2, Math.min(wholeNow ? RIFFLE.whole : RIFFLE.most, distance - 1));
    // Each face shows a page of code the riffle passes if that code has arrived, or faint lines of writing otherwise.
    const passing = pages.passing?.(from, target);
    const faces = 2 * leaves + 2;
    const face = (n: number): HTMLElement => passing?.(forward ? n : faces - n, faces) ?? ghost(n);
    const [start, end] = forward ? [0, -179.6] : [-179.6, 0];
    right.classList.remove("lift");
    cover.classList.remove("lift");
    const flying: { readonly leaf: HTMLElement; readonly z: number }[] = [];
    let k = 0;
    /** The z offset of the riffle leaf carrying the ribbon, or null. */
    let riding: number | null = null;
    const timers: number[] = [];
    const later = (f: () => void, ms: number): void => void timers.push(window.setTimeout(f, ms));
    /** Turns a leaf over, and the ribbon with it when `carries`. */
    const launch = (front: HTMLElement, back: HTMLElement, ms: number, carries = false): HTMLElement => {
      const l = el("jb-leaf jb-riffle", inner);
      put(el("jb-face front", l), front);
      put(el("jb-face back", l), back);
      const z = 1.2 + k * 0.02;
      const turn = (deg: number, transition: string): void => {
        l.style.transition = transition;
        l.style.transform = `translateZ(${z.toFixed(2)}px) rotateY(${deg}deg)`;
        if (carries) carry(z, deg, transition);
      };
      turn(start, "none");
      void l.offsetWidth;
      turn(end, `transform ${ms}ms cubic-bezier(.42,.05,.36,1)`);
      if (carries) riding = z;
      flying.push({ leaf: l, z });
      // Keeps only the 16 most recent leaves once they land.
      while (flying.length > 16) flying.shift()?.leaf.remove();
      k++;
      return l;
    };
    // The first leaf carries the open page, and the ribbon if it lies there, over a passing face. The page edges and
    // tabs update with the first leaf rather than with the ribbon's lift, so the lift has the main thread to itself.
    const first = (): void => {
      layDepth(target, 1800);
      markTabs(target);
      const lifted = (forward ? right : left).firstElementChild as HTMLElement;
      put(forward ? right : left, face(1));
      launch(forward ? lifted : face(0), forward ? face(0) : lifted, RIFFLE.ms, forward && lies === "here");
      later(step, RIFFLE.ends);
    };
    const land = (last: HTMLElement): void => {
      shutUnderWay = null;
      put(forward ? left : right, last.querySelector(forward ? ".back" : ".front")?.firstElementChild as HTMLElement);
      for (const f of flying) f.leaf.remove();
      at = target;
      markTabs(target);
      layEdges();
      turning = false;
      if (queued !== null) {
        const next = queued;
        queued = null;
        turnTo(next);
      }
    };
    // If the book shuts mid-riffle, the leaves fall shut with the cover, and so does the ribbon, from its leaf or
    // mid-lift. The book stays shut at the page the riffle left.
    shutUnderWay = (): void => {
      shutUnderWay = null;
      for (const t of timers) window.clearTimeout(t);
      queued = null;
      const falling: [HTMLElement, number, number][] = flying.map(({ leaf: l, z }) => [l, z, 0]);
      if (ribbon.dataset.side === "carried") falling.push(riding === null ? [ribbon, new DOMMatrixReadOnly(getComputedStyle(ribbon).transform).m43, 0] : [ribbon, riding, RIBBON_ON_LEAF]);
      fallShut(falling);
      window.setTimeout(() => {
        for (const f of flying) f.leaf.remove();
        layRibbon();
        turning = false;
      }, COVER_MS + 40);
    };
    const step = (): void => {
      const toGo = leaves - k;
      if (toGo > 0 || !whole) {
        const waiting = toGo <= 0;
        launch(face(k * 2), face(k * 2 + 1), waiting ? RIFFLE.waitingMs : RIFFLE.ms);
        later(step, waiting ? RIFFLE.waiting : k < 3 || toGo < 3 ? RIFFLE.ends : RIFFLE.gap);
        return;
      }
      // The last leaf carries the target page, with the target's other page beneath.
      const to = pages.spread(target);
      put(forward ? right : left, forward ? to.right : to.left);
      // Riffling forward to the ribbon's page, the ribbon rests on the page under the last leaf. Riffling back, the last leaf carries it over.
      if (home && forward) rest("here");
      // Riffle leaves turn flat, without `curl.ts` strips. Bending the first and last leaves stalled the main thread for half a second per riffle.
      const last = launch(forward ? face(k * 2) : to.right, forward ? to.left : face(k * 2), RIFFLE.ms + 260, home && !forward);
      later(() => land(last), RIFFLE.ms + 300);
    };
    if (lifts) later(first, LIFT.leaves);
    else first();
  }

  /**
   * A page turn in progress: the leaf holds the pages it carries, with the new
   * pages beneath, so a tap or drag can complete it (`finish`) or undo it
   * (`cancel`). While the painting on the leaf's far side is still being
   * made, the leaf turns no further than `HOLD`, which keeps it out of sight.
   */
  interface Turn {
    readonly forward: boolean;
    /** Sets the leaf's progress from 0 (where it started) to 1 (turned), following the pointer. */
    hold(progress: number): void;
    /** Completes the turn from `progress`, holding at `HOLD` until the far side's painting is done. */
    finish(progress: number): void;
    /** Turns the leaf back from `progress` and restores the pages as they were. */
    cancel(progress: number): void;
  }
  function beginTurn(target: string, ms = TURN_MS): Turn {
    const from = at;
    sway();
    const forward = from === null || pages.order(from, target) < 0;
    const to = pages.spread(target);
    turning = true;
    leaf.hidden = false;
    leaf.classList.remove("over", "turning");
    leaf.style.transition = "none";
    if (forward) {
      // The right page turns over onto the left, with the new left page on its back and the new right page beneath.
      put(leafFront, right.firstElementChild as HTMLElement | null);
      put(leafBack, to.left);
      put(right, to.right);
    } else {
      // The left page turns back onto the right, with the new right page on its front and the new left page beneath.
      leaf.classList.add("over");
      put(leafBack, left.firstElementChild as HTMLElement | null);
      put(leafFront, to.right);
      put(left, to.left);
    }
    // Updates the tabs as the page starts turning.
    markTabs(target);
    // A ribbon on the turning page turns with it. Turning forward onto the ribbon's page, the ribbon rests on the page beneath.
    const carries = from !== null && pages.order(forward ? from : target, marked) === 0;
    if (forward && pages.order(target, marked) === 0) rest("here");
    void leaf.offsetWidth;
    // Bends the leaf with `curl.ts` strips and casts its shadow. Each frame the strips follow the leaf's angle, by hand
    // or not, and a carried ribbon follows the strip by the spine.
    let curl: Curl | null = null;
    let frame = 0;
    const bend = (): void => {
      curl?.remove();
      curl = createCurl(curlHost, leafFront.firstElementChild as HTMLElement | null, leafBack.firstElementChild as HTMLElement | null, PAGE.w, PAGE.h, true, shades);
      leaf.classList.add("curled");
      cancelAnimationFrame(frame);
      const tick = (): void => {
        const deg = angleOf(leaf);
        const spine = curl?.at(deg, forward) ?? deg;
        if (carries) carry(CURL_Z, spine);
        frame = requestAnimationFrame(tick);
      };
      tick();
    };
    const unbend = (): void => {
      cancelAnimationFrame(frame);
      curl?.remove();
      curl = null;
      leaf.classList.remove("curled");
    };
    bend();
    const whole = painted(target);
    let ready = false;
    void whole.then(() => {
      // Redraws the target's left page out of sight now that it is complete, before the leaf shows it.
      if (!turning) return;
      put(forward ? leafBack : left, pages.spread(target).left);
      ready = true;
      if (curl !== null) bend();
    });
    /** The leaf's angle at `progress`, limited by `HOLD` while the far side's painting is not done. */
    const angleAt = (progress: number): number => {
      const deg = forward ? -179.6 * progress : -179.6 * (1 - progress);
      return ready ? deg : forward ? Math.max(deg, HOLD.forward) : Math.min(deg, HOLD.back);
    };
    const lay = (deg: number, ms: number, ease = "cubic-bezier(.3,.1,.3,1)"): void => {
      leaf.style.transition = ms > 0 ? `transform ${ms}ms ${ease}` : "none";
      leaf.style.transform = `translateZ(1.4px) rotateY(${deg.toFixed(2)}deg)`;
    };
    /** Whether the book was shut part way through the turn. */
    let shut = false;
    let timer = 0;
    const done = (): void => {
      shutUnderWay = null;
      unbend();
      leaf.style.transition = "";
      leaf.style.transform = "";
      if (forward) put(left, leafBack.firstElementChild as HTMLElement | null);
      else put(right, leafFront.firstElementChild as HTMLElement | null);
      leaf.hidden = true;
      leaf.classList.remove("turning", "over");
      put(leafFront, null);
      put(leafBack, null);
      // The open pages are the ones that turned, so nothing is redrawn when a turn ends.
      at = target;
      layDepth(target, 300);
      markTabs(target);
      layEdges();
      turning = false;
      if (queued !== null) {
        const next = queued;
        queued = null;
        turnTo(next);
      }
    };
    /** Restores the pages as they were before the turn. */
    const undone = (): void => {
      shutUnderWay = null;
      unbend();
      if (forward) {
        put(right, leafFront.firstElementChild as HTMLElement | null);
        put(leafBack, null);
      } else {
        put(left, leafBack.firstElementChild as HTMLElement | null);
        put(leafFront, null);
      }
      leaf.style.transition = "";
      leaf.style.transform = "";
      leaf.hidden = true;
      leaf.classList.remove("turning", "over");
      turning = false;
      if (at !== null) markTabs(at);
      layEdges();
    };
    // If the book shuts mid-turn, the leaf falls to the right ahead of the cover, with its strips and any ribbon on it.
    // A forward turn falls back to where it started, and a backward turn completes. A leaf already lying on the left
    // rides over flat with the cover, as a riffle's leaves do.
    shutUnderWay = (): void => {
      shutUnderWay = null;
      shut = true;
      window.clearTimeout(timer);
      if (angleOf(leaf) < -175) {
        unbend();
        fallShut(carries ? [[leaf, 1.4, 0], [ribbon, CURL_Z, RIBBON_ON_LEAF]] : [[leaf, 1.4, 0]]);
      } else lay(0, FALL.ms, FALL.ease);
      timer = window.setTimeout(forward ? undone : done, COVER_MS + 40);
    };
    return {
      forward,
      hold: (progress) => {
        if (!shut) lay(angleAt(progress), 0);
      },
      finish(progress) {
        const over = (from: number): void => {
          if (shut) return;
          const rest = Math.max(160, ms * (1 - from));
          lay(forward ? -179.6 : 0, rest);
          timer = window.setTimeout(done, rest + 40);
        };
        if (shut) return;
        void settledSoon(whole).then((now) => {
          if (now) return over(progress);
          if (shut) return;
          // The page beneath is complete but the painting on the leaf's far side is not, so the leaf lifts to `HOLD` and waits.
          lay(angleAt(Math.max(progress, 0.5)), HOLD.ms, "cubic-bezier(.2,.7,.3,1)");
          void whole.then(() => over(Math.max(progress, 0.5)));
        });
      },
      cancel(progress) {
        if (shut) return;
        const back = Math.max(160, TURN_MS * progress);
        lay(forward ? 0 : -179.6, back);
        timer = window.setTimeout(undone, back + 40);
      },
    };
  }

  // ---------- dragging a page ----------

  /**
   * A page turns when dragged toward the spine. The grabbed spot stays under
   * the finger or mouse as the leaf turns. Released past halfway, the turn
   * completes, and before halfway it falls back. A press that barely moves is
   * a tap, which goes to the row, name or picture under it, or turns the page
   * from bare paper (below).
   */
  let taken: { readonly side: "left" | "right"; readonly x0: number; readonly y0: number; turn: Turn | null; progress: number; reach: number } | null = null;
  let dragged = false;
  const take = (side: "left" | "right") => (e: PointerEvent): void => {
    if (!open || turning || e.button !== 0) return;
    // The grabbed spot's distance from the spine, which follows the pointer.
    const r = (side === "right" ? right : left).getBoundingClientRect();
    taken = { side, x0: e.clientX, y0: e.clientY, turn: null, progress: 0, reach: Math.max(40, side === "right" ? e.clientX - r.left : r.right - e.clientX) };
  };
  // A finger can drag a page from anywhere on it, and a mouse only from its edge, so a press while reading never starts a turn.
  const takeByHand = (side: "left" | "right") => (e: PointerEvent): void => {
    if (e.pointerType === "touch") take(side)(e);
  };
  right.addEventListener("pointerdown", takeByHand("right"));
  left.addEventListener("pointerdown", takeByHand("left"));
  window.addEventListener("pointermove", (e) => {
    if (taken === null) return;
    const dx = e.clientX - taken.x0;
    const toward = taken.side === "right" ? -dx : dx;
    if (taken.turn === null) {
      // A drag starts only after `DRAG.start` px toward the spine, more than a tap's wobble.
      if (toward < DRAG.start || Math.abs(e.clientY - taken.y0) > toward) return;
      const target = at === null ? null : pages.next(at, taken.side === "right" ? 1 : -1);
      if (target === null || turning) {
        taken = null;
        return;
      }
      taken.turn = beginTurn(target);
      dragged = true;
      // `.taking` shows the grabbing cursor (journal.css).
      root.classList.add("taking");
    }
    // At angle a, the grabbed spot lies `reach` times cos(a) from the spine. Solves for the angle that puts it under the
    // pointer.
    taken.progress = Math.acos(Math.max(-1, Math.min(1, 1 - toward / taken.reach))) / Math.PI;
    taken.turn.hold(taken.progress);
  });
  const letGo = (): void => {
    root.classList.remove("taking");
    if (taken?.turn != null) {
      if (taken.progress >= 0.5) taken.turn.finish(taken.progress);
      else taken.turn.cancel(taken.progress);
    }
    taken = null;
    // The click that ends a drag fires right away. Any later click is a tap again.
    if (dragged) window.setTimeout(() => (dragged = false), 0);
  };
  window.addEventListener("pointerup", letGo);
  window.addEventListener("pointercancel", letGo);
  // Stops the click that ends a drag, so it never reaches a row or a picture.
  window.addEventListener(
    "click",
    (e) => {
      if (!dragged) return;
      dragged = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );

  // ---------- opening and closing ----------

  /** Delays the cover's swing by `ms`, and the ribbon's with it. */
  function swingAfter(ms: number): void {
    cover.style.transitionDelay = `${ms}ms`;
    ribbon.style.transitionDelay = `${ms}ms`;
  }
  /** Opens or shuts the book. On open, `followIn` runs once a riffle can follow the cover over (`COVER_LEAD`). */
  function setOpen(on: boolean, place0?: string, followIn?: () => void): void {
    if (on === open) return;
    open = on;
    root.classList.toggle("open", on);
    onOpen(on);
    if (on) {
      const opensAt = place0 ?? "map";
      show(opensAt);
      // Moves from the corner first, and the cover opens as it arrives. If the opening page is still being painted, the
      // book stays shut in the middle and opens once the page is done.
      book.style.transition = `transform ${TRAVEL_MS}ms cubic-bezier(.45,.05,.3,1)`;
      inner.style.transition = `transform ${COVER_MS}ms cubic-bezier(.45,.05,.3,1) ${TRAVEL_MS * 0.45}ms`;
      swingAfter(TRAVEL_MS * 0.45);
      place(true);
      // Once open, clears the swing delay so the cover's edge and the ribbon respond to the pointer at once.
      const opened = (e: TransitionEvent): void => {
        if (e.target !== cover) return;
        cover.removeEventListener("transitionend", opened);
        swingAfter(0);
      };
      cover.addEventListener("transitionend", opened);
      // Times `followIn` from when the cover starts to swing, which depends on its delay, on the opening page being done
      // and on the main thread.
      if (followIn !== undefined) {
        const swings = (e: TransitionEvent): void => {
          if (e.target !== cover) return;
          cover.removeEventListener("transitionstart", swings);
          if (open) window.setTimeout(followIn, COVER_LEAD);
        };
        cover.addEventListener("transitionstart", swings);
      }
      const whole = painted(opensAt);
      void settledSoon(whole).then((ready) => {
        if (ready || !open) return;
        cover.classList.remove("open");
        void whole.then(() => {
          if (!open) return;
          // Redraws the spread under the shut cover now that it is complete, then opens.
          show(opensAt);
          swingAfter(0);
          cover.classList.add("open");
        });
      });
    } else {
      // The cover shuts over the open page, then the book moves back to its corner.
      shutUnderWay?.();
      inner.style.transition = `transform ${COVER_MS}ms cubic-bezier(.45,.05,.3,1)`;
      swingAfter(0);
      book.style.transition = `transform ${TRAVEL_MS}ms cubic-bezier(.45,.05,.3,1) ${COVER_MS * 0.6}ms`;
      place(false);
    }
  }

  // ---------- clicks, swipes and keys ----------

  /** Whether there is a spread in that direction. The first spread's left and the last spread's right turn nowhere. */
  const turns = (side: "left" | "right"): boolean => open && at !== null && pages.next(at, side === "right" ? 1 : -1) !== null;
  /** Turns to the next spread forward (1) or back (-1), if there is one. */
  function turnBy(by: 1 | -1): void {
    const to = open && at !== null ? pages.next(at, by) : null;
    if (to !== null) turnTo(to);
  }
  /**
   * Updates each margin for the open spread. Where there is no spread that way, the margin is disabled and clicks go
   * to the page. Over a row, a name, a fold or a way back the margin has a hole, so those keep their own clicks and
   * underline. Over the map, a picture or bare paper the margin turns the page.
   */
  function layEdges(): void {
    layRibbon();
    for (const m of margins) {
      const side = m.classList.contains("right") ? "right" : "left";
      m.classList.toggle("none", !turns(side));
      m.style.clipPath = holesFor(side);
    }
  }
  /** The margin's clip path: its strip minus every button under it, or "" when it covers none. */
  function holesFor(side: "left" | "right"): string {
    const page = (side === "right" ? right : left).firstElementChild;
    if (!(page instanceof HTMLElement)) return "";
    // The strip's left side, in the page's own pixels.
    const from = side === "right" ? PAGE.w - EDGE : 0;
    const holes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const b of page.querySelectorAll<HTMLElement>("button")) {
      // Skips a hidden fold or a row past the page's end, which take no click.
      if (b.offsetParent === null || b.closest(".jp-past") !== null) continue;
      let [x, y] = [0, 0];
      for (let n: HTMLElement | null = b; n !== null && n !== page; n = n.offsetParent as HTMLElement | null) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      const [x0, x1] = [Math.max(0, x - from), Math.min(EDGE, x + b.offsetWidth - from)];
      if (x1 <= x0) continue;
      // Merges stacked rows into one hole, since a seam between two would lift the page as the pointer crossed it.
      const last = holes.at(-1);
      if (last !== undefined && last.x0 === x0 && last.x1 === x1 && y <= last.y1 + 1 && y >= last.y0) last.y1 = Math.max(last.y1, y + b.offsetHeight);
      else holes.push({ x0, x1, y0: y, y1: y + b.offsetHeight });
    }
    if (holes.length === 0) return "";
    return `path(evenodd, "M0 0H${EDGE}V${PAGE.h}H0Z${holes.map((h) => `M${h.x0} ${h.y0}H${h.x1}V${h.y1}H${h.x0}Z`).join("")}")`;
  }

  // The outer fifth of each page is a margin that turns it.
  const margin = (side: "left" | "right"): HTMLElement => {
    const m = el(`jb-margin ${side}`, inner);
    margins.push(m);
    // Scales about the spine, the center of the open book (`liftMargins`).
    m.style.transformOrigin = side === "right" ? "calc(var(--edge) - var(--pw)) 50%" : "var(--pw) 50%";
    // Its page lifts a little under the pointer, and a drag can start here.
    const page = side === "right" ? right : cover;
    // Only where there is a spread that way. The first spread's left edge and the last one's right stay flat (`layEdges`).
    m.addEventListener("pointerenter", () => {
      if (turns(side) && !turning) page.classList.add("lift");
      if (turns(side) && !turning) sway();
    });
    m.addEventListener("pointerleave", () => page.classList.remove("lift"));
    m.addEventListener("pointerdown", (e) => {
      // On press, drops the lift without a transition, since easing back under the turning leaf would flicker.
      page.style.transition = "none";
      page.classList.remove("lift");
      void page.offsetWidth;
      page.style.transition = "";
      take(side)(e);
    });
    m.addEventListener("click", (e) => {
      e.stopPropagation();
      turnBy(side === "right" ? 1 : -1);
    });
    return m;
  };
  margin("left");
  margin("right");
  // A click on bare paper also turns: the right-hand page forward and the left back. Anything with its own click
  // handler (a row, a name, a fold, a way back, a map or a picture) stops the click before it gets here.
  right.addEventListener("click", () => turnBy(1));
  left.addEventListener("click", () => turnBy(-1));
  // A sideways trackpad swipe or the wheel also turns, one page per gesture. Nothing on a page scrolls, so the wheel
  // over the open book always turns. A pinch (ctrlKey) zooms and is ignored.
  const swiped = swipes();
  book.addEventListener(
    "wheel",
    (e) => {
      if (!open || e.ctrlKey) return;
      e.preventDefault();
      const by = swiped(e.deltaX, e.deltaY, e.timeStamp);
      if (by !== null) turnBy(by);
    },
    { passive: false },
  );
  catcher.addEventListener("click", () => setOpen(false));
  ribbon.addEventListener("click", (e) => {
    e.stopPropagation();
    turnTo(marked);
  });
  // A click on the shut book's cover, around the slip, opens it.
  coverFront.addEventListener("click", () => {
    if (!open) {
      layTabs();
      setOpen(true);
    }
  });
  /** The tabs last laid, as JSON, so laying the same tabs again does nothing. */
  let laidTabs = "";
  function layTabs(): void {
    const list = pages.tabs();
    const key = JSON.stringify(list);
    if (key === laidTabs) return;
    laidTabs = key;
    tabs.replaceChildren(
      ...list.map((t, k) => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "jb-tab";
        tab.dataset.at = t.at;
        tab.dataset.from = t.from;
        tab.style.top = `${40 + k * 84}px`;
        const name = document.createElement("span");
        name.textContent = t.name;
        tab.append(name);
        // A tab on the shut book opens it there.
        tab.addEventListener("click", (e) => {
          e.stopPropagation();
          if (open) turnTo(t.at);
          else api.open(t.at);
        });
        return tab;
      }),
    );
  }
  window.addEventListener(
    "keydown",
    (e) => {
      // Keys typed in the finder over the book belong to the finder.
      if (!open || e.target instanceof HTMLInputElement) return;
      // While the book is open, no key reaches the world.
      if (e.code === "Escape" || e.code === "KeyM") {
        setOpen(false);
        // `view.ts` also listens on window in the capture phase. On M it would reopen the book, and on Escape close the map.
        e.stopImmediatePropagation();
      } else if (e.code === "ArrowRight" || e.code === "ArrowLeft") turnBy(e.code === "ArrowRight" ? 1 : -1);
      e.stopPropagation();
      if (e.code !== "Tab") e.preventDefault();
    },
    true,
  );

  const api: JournalBook = {
    open: (place0) => {
      layTabs();
      if (open) {
        if (place0 !== undefined) turnTo(place0);
        return;
      }
      // Opens at the target once it is complete. If the target is not ready within a moment, the book opens at the map
      // and riffles to the target as the cover opens, continuing until the page is done.
      const target = place0 ?? "map";
      const ready = wholeAt(target);
      void settledSoon(ready).then((now) => {
        if (now || target === "map") return void ready.then(() => setOpen(true, target));
        setOpen(true, "map", () => turnTo(target));
      });
    },
    turnTo,
    close: () => setOpen(false),
    get isOpen() {
      return open;
    },
    slip,
    refresh: () => {
      layTabs();
      if (open && at !== null && !turning) show(at);
    },
    state: () => ({ open, at, turning }),
  };
  return api;
}
