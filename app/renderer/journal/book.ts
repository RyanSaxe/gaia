// The traveller's journal: a worn leather book. Closed, it rests at the lower
// right with the minimap on a slip under a strap across its cover; opened,
// it is lifted to the middle of the view and its cover swings open on the
// spine. Pages turn as a real book's do: a leaf with a face on each side
// swings over the spine. The left-hand page is always the back of the cover
// and whatever leaves it carries, so the cover swings shut over the page you
// were reading. Only the open spread and a turning leaf exist at any time;
// every page is drawn from its words as it comes into view (`BookPages`).

import "./journal.css";
import LEATHER from "./leather.webp";
import PAPER from "./paper.webp";
import { linesOf } from "./page.ts";
import { RIBBON_LIE, RIBBON_POSES, ribbonSvg, ribbonTransform } from "./ribbon.ts";
import { type Curl, angleOf, createCurl } from "./curl.ts";
import { swipes } from "./swipe.ts";

/** The two pages a place in the book opens onto. */
export interface Spread {
  readonly left: HTMLElement;
  readonly right: HTMLElement;
}

/** What the book holds, by place: "map" (the endpapers), "contents", or an entry's `of`. */
export interface BookPages {
  spread(at: string): Spread;
  /** The place a page turn forward (+1) or back (-1) reaches from `at`, or null past either end. */
  next(at: string, by: 1 | -1): string | null;
  /** Negative when `a` comes before `b` in the book. */
  order(a: string, b: string): number;
  /** The fore-edge's tabs: each one's name, the place it opens at, and the chapter its part of the book begins with. */
  tabs(): readonly { readonly name: string; readonly at: string; readonly from: string }[];
  /** Settles once everything a place's spread needs, such as a file's text, has come, so its pages are drawn whole. */
  ready?(at: string): Promise<void>;
  /** Settles once a place's painting is whole: a page is never seen before its painting. */
  painted?(at: string): Promise<void>;
  /**
   * What a riffle's leaves show on its way from `from` to `toward`: for the `k`th face of `of`, a page of real code
   * from a file the way passes, or null when no code has come yet.
   */
  passing?(from: string, toward: string): (k: number, of: number) => HTMLElement | null;
  /** How far through the book a place lies, 0 at the front to 1 at the back, which the edges of its leaves show. */
  fraction?(at: string): number;
}

export interface JournalBook {
  /** Lifts the book from its corner and opens it at a place, the map by default. */
  open(at?: string): void;
  /** Turns to a place, forward or back, in one motion however far it is. */
  turnTo(at: string): void;
  /** Shuts the book over the page it is open at and sets it back in its corner. */
  close(): void;
  readonly isOpen: boolean;
  /** The slip on the cover, which holds the minimap. */
  readonly slip: HTMLElement;
  /** Draws the open spread afresh, after what the pages say has changed. */
  refresh(): void;
  state(): { readonly open: boolean; readonly at: string | null; readonly turning: boolean };
}

/** A page's size in the book's own pixels, and how far the boards overhang the pages. */
export const PAGE = { w: 520, h: 660, overhang: 10 } as const;
/** How wide a page's edge is, its outer fifth, in the book's pixels: a click there turns the page, over a map or a picture too. */
const EDGE = PAGE.w / 5;
/** The longest the book waits for a page to be whole, ms, which only text or a painting that failed to come takes. */
const WHOLE_AT_MOST = 20000;
/** How long the next page or the one before waits under a lifted page for its painting, ms, before the book riffles to it. */
const BESIDE_MS = 1500;
/**
 * A leaf whose next page is still being painted lifts at once and waits at
 * its edge, so a tap is always answered: how far it lifts (degrees, the
 * painting still out of sight) and how slowly, ms. Then it comes over.
 */
const HOLD = { forward: -64, back: -175, ms: 1600 } as const;
/** How far a page must be drawn toward the spine before it is taken rather than tapped, px. */
const DRAG = { start: 12 } as const;
/** How long a leaf takes to turn, the cover to swing, and the book to travel between its corner and your hands, ms. */
/** How far the margins stand toward the eye, in the book's pixels, past the 36 a lifted page's edge rises (`liftMargins`). */
const MARGIN_LIFT = 40;
/** The journal's perspective in journal.css, which the margins' scale undoes. */
const MARGIN_PERSPECTIVE = 2400;
const TURN_MS = 720;
const COVER_MS = 900;
const TRAVEL_MS = 1050;
/**
 * How long after the cover starts to swing open a riffle that follows it in may start, ms: its first leaf, or the
 * ribbon lifted across before it, then trails the cover all the way over instead of overtaking it.
 */
const COVER_LEAD = 420;
/** The closed book's tilt in its corner, degrees, and how much of the view the open book may take. */
const CORNER_TILT = 6;
/** The closed book in its corner: a little smaller than the slip's own size, and close in to the screen's edges, px. */
const CORNER = { scale: 0.86, margin: { x: 12, y: 14 } } as const;
const FILL = { w: 0.94, h: 0.88 } as const;
/**
 * The ribbon lifted across the book onto the page a jump leaves: how long it takes to swing over, to be drawn out of
 * the leaves, and how long after it starts the leaves go, ms.
 */
const LIFT = { ms: 620, drawn: 320, leaves: 440 } as const;
/** How far the ribbon lies off the front of a leaf that carries it, in the book's pixels. */
const RIBBON_ON_LEAF = 0.3;
/** The layer a turning leaf's strips lie at (`.jb-curl` in journal.css), which the ribbon on that leaf rides. */
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
  const root = el("journal", layer);
  // The brush: a stroke of color laid by hand, its edge wandering a little, as the mocks paint them. A stroke runs down
  // the gutter or across the title page, so the brush reaches as far past it every way.
  root.insertAdjacentHTML(
    "beforeend",
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <filter id="jp-brush" x="-60%" y="-60%" width="220%" height="220%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="7" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="0.7"/></filter>
    </svg>`,
  );
  root.style.setProperty("--leather", `url(${LEATHER})`);
  root.style.setProperty("--paper", `url(${PAPER})`);
  root.style.setProperty("--pw", `${PAGE.w}px`);
  root.style.setProperty("--ph", `${PAGE.h}px`);
  root.style.setProperty("--ov", `${PAGE.overhang}px`);
  root.style.setProperty("--edge", `${EDGE}px`);
  // While the book is open the world waits under it: a tap anywhere but the book shuts it.
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
  // A silk ribbon left at the page a riffle began from (`ribbon.ts`); a tap on it goes back there. It is drawn once, at
  // the map until a riffle leaves it elsewhere: only its pose about the spine and how much of it shows ever change.
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

  // A page is finished the moment it is laid in the book, before anything can see it: it ends on a whole line, and
  // Jev's marks are painted beside what they point at, so no page is ever seen changing.
  const put = (into: HTMLElement, page: HTMLElement | null): void => {
    into.replaceChildren(...(page === null ? [] : [page]));
    if (page !== null) finish(page);
  };
  function finish(page: HTMLElement): void {
    const body = page.querySelector<HTMLElement>(".jp-body");
    if (body === null) return;
    const bottom = body.clientHeight;
    /** How far down the page's body a row sits, through the code or list that holds it. */
    const down = (e: HTMLElement): number => {
      let y = 0;
      for (let n: HTMLElement | null = e; n !== null && n !== body; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      return y;
    };
    const rows = [...body.querySelectorAll<HTMLElement>(".jp-line, .jp-row")];
    for (const row of rows) row.classList.toggle("jp-past", down(row) + row.offsetHeight > bottom);
    // A definition too long for its page folds where the page ends: the last row that fits makes room for the fold.
    const fold = body.querySelector<HTMLElement>(".jp-fold.after");
    if (fold !== null && rows.some((r) => r.classList.contains("jp-past"))) {
      const last = rows.filter((r) => !r.classList.contains("jp-past")).at(-1);
      if (last !== undefined) {
        last.classList.add("jp-past");
        const more = rows.filter((r) => r.classList.contains("jp-past") && r.classList.contains("jp-line")).length;
        fold.style.top = `${down(last)}px`;
        // A document's lines are its paragraphs, so its fold just reads on.
        fold.textContent = body.querySelector(".jp-code.prose") !== null ? "read on" : linesOf(more);
        fold.classList.add("shown");
      }
    }
    paintMarks(body);
  }
  /** One brush stroke down the gutter for each run of lines a mark covers, and one beside each marked row. */
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
  /** Lays the ribbon at rest where its page lies, as journal.css poses it there. */
  function layRibbon(): void {
    const side = sideOf(at);
    if (ribbon.dataset.side !== side) rest(side);
  }
  /** Poses the ribbon at rest on `side` at once, from wherever it was: a leaf or the page over it hides the change. */
  function rest(side: RibbonSide): void {
    ribbon.style.transition = "none";
    ribbon.style.transform = "";
    ribbon.style.removeProperty("--hid");
    ribbon.dataset.side = side;
    void ribbon.offsetWidth;
    ribbon.style.transition = "";
  }
  /** Lays the ribbon on the front of a leaf raised `z` and standing at `deg` about the spine, over `transition`. */
  function carry(z: number, deg: number, transition = "none"): void {
    ribbon.dataset.side = "carried";
    ribbon.style.transition = transition;
    ribbon.style.transform = ribbonTransform({ z, deg, off: RIBBON_ON_LEAF });
  }
  /**
   * Lifts the ribbon out from among the leaves on one side and lays it across on the open page there, drawn out from
   * the foot up as it rises: forward from the right-hand leaves onto the left-hand page, back from the left-hand
   * leaves onto the right-hand page. It starts over the open page with only its head and tail showing, as they show
   * from among the leaves, so it is drawn out on top of that page rather than under it.
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
  /** The free end of the ribbon sways a little, as silk does when the book moves. */
  function sway(): void {
    ribbon.classList.remove("sway");
    void ribbon.offsetWidth;
    ribbon.classList.add("sway");
  }
  /**
   * The leaves' edges on each side are as thick as the pages that lie there, so
   * near the front the left edge is a sliver and the right a deep stack, and through the book they trade places. They
   * stay within the boards' overhang. A riffle carries them across over `ms`.
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
      // A deep stack shades toward its outer edge, as the leaves under one another catch less light.
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
  /** Settles once a place's spread can be drawn whole, its code and its painting come; one that never comes is shown as it stands after a while. */
  const wholeAt = (place: string): Promise<void> =>
    Promise.race([Promise.all([pages.ready?.(place), pages.painted?.(place)]).then(() => undefined), after(WHOLE_AT_MOST)]);
  /** Settles once a place's painting is whole, as `wholeAt` does. */
  const painted = (place: string): Promise<void> => Promise.race([pages.painted?.(place) ?? Promise.resolve(), after(WHOLE_AT_MOST)]);
  /** Whether a promise has already settled, or settles within a moment. */
  const settledSoon = (p: Promise<void>): Promise<boolean> => Promise.race([p.then(() => true), after(40).then(() => false)]);
  /** Whether `place` lies in the part of the book a tab begins at `chapter`: from it to the next tab's. */
  function within(place: string, chapter: string): boolean {
    const list = pages.tabs();
    const k = list.findIndex((t) => t.from === chapter);
    const next = list[k + 1];
    return pages.order(chapter, place) <= 0 && (next === undefined || pages.order(place, next.from) < 0);
  }

  // ---------- where the book is: its corner, or held open ----------

  /** The scale at which the open book fits the view, and the corner pose that puts the slip where the minimap is. */
  function poses(): { held: string; corner: string; scale: number } {
    const vw = layer.clientWidth || window.innerWidth;
    const vh = layer.clientHeight || window.innerHeight;
    const scale = Math.min((vw * FILL.w) / (PAGE.w * 2 + PAGE.overhang * 2), (vh * FILL.h) / (PAGE.h + PAGE.overhang * 2));
    // The slip's middle, in the closed book's own pixels from the book's middle, is laid in the lower left corner:
    // the slip lies by the cover's outer edge, so the book hangs off the screen's left and bottom.
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
  /** The outer margins that turn the pages, made with the rest of the book's touch below. */
  const margins: HTMLElement[] = [];
  function place(isOpen: boolean): void {
    const p = poses();
    book.style.transform = isOpen ? p.held : p.corner;
    inner.style.transform = isOpen ? "translateX(0)" : closedShift;
    cover.classList.toggle("open", isOpen);
    liftMargins(p.scale);
  }
  /**
   * Stands the margins in front of a page lifting under the pointer and of the open cover, whose edges rise some 36
   * of the book's pixels toward the eye: lower, a lifted page would cover its own margin, the pointer would leave it,
   * the page would settle and the margin show again, over and over, and the left margin, under the cover, would never
   * be reached at all. Raised that far they would look larger and stand farther out, so each is scaled back about
   * the spine by as much as the view's perspective (`.journal` in journal.css) enlarges it, and covers the same edge.
   */
  function liftMargins(scale: number): void {
    const k = (MARGIN_PERSPECTIVE - MARGIN_LIFT * scale) / MARGIN_PERSPECTIVE;
    for (const m of margins) m.style.transform = `translateZ(${MARGIN_LIFT}px) scale(${k})`;
  }
  place(false);
  // A new size of window moves the book at once: it travels between its corner and your hands only to open and shut.
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
      // A far page is riffled to, whole or not; the page beside turns as a page does.
      if (at === null || !beside) return riffleTo(target, ready, now);
      if (now) return turnNow(target);
      // The page beside: it lifts under the hand, as at its edge, and the book riffles on only if that page is long in coming.
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
   * How a riffle goes: ms between leaves at full pace and at its two ends, how long a leaf takes over, the most leaves
   * a riffle turns before it lands (fewer when the page asked for is whole already), and the slower pace it keeps
   * while that page is still being made.
   */
  const RIFFLE = { gap: 55, ends: 140, ms: 560, most: 36, whole: 12, waiting: 300, waitingMs: 900 } as const;
  /** The faint lines of a written page seen in passing, four of them, the same each time. */
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
  /** A riffle under way, which the book shut part way through lets fall shut with the cover. */
  let shutRiffle: (() => void) | null = null;
  /**
   * Lets leaves, or the ribbon, fall shut with the cover, each posed about the spine as `translateZ(z) rotateY(…)
   * translateZ(off)`: one still lying on the left-hand leaves rides the cover over at its height above the cover's
   * own, and one in the air falls ahead of the cover, keeping its share of the cover's angle, so neither passes
   * through the cover. The cover's heights open and shut are the ribbon's among its leaves (`RIBBON_POSES`).
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
   * The book riffles toward a far page: many leaves turn over one after another, fast, several in the air at once,
   * the way a thumb lets a book's pages run, and the last carries the page asked for, once that page is whole. While
   * it is still being made, the leaves keep turning, slower.
   */
  function riffleTo(target: string, ready: Promise<void>, wholeNow: boolean): void {
    const from = at as string;
    const forward = pages.order(from, target) < 0;
    // A jump leaves the ribbon at the page it began from, unless it is the ribbon's own way back. Lying among the leaves
    // on the far side of the book from where that page will lie, it is first lifted across onto it.
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
    // Each face a page of the code the book passes, where that code has come; faint lines of writing otherwise.
    const passing = pages.passing?.(from, target);
    const faces = 2 * leaves + 2;
    const face = (n: number): HTMLElement => passing?.(forward ? n : faces - n, faces) ?? ghost(n);
    const [start, end] = forward ? [0, -179.6] : [-179.6, 0];
    right.classList.remove("lift");
    cover.classList.remove("lift");
    const flying: { readonly leaf: HTMLElement; readonly z: number }[] = [];
    let k = 0;
    /** The height of the leaf the ribbon lies on, while a leaf of this riffle carries it. */
    let riding: number | null = null;
    const timers: number[] = [];
    const later = (f: () => void, ms: number): void => void timers.push(window.setTimeout(f, ms));
    /** Turns a leaf over, and with it the ribbon when that lies on its front. */
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
      // Only the leaves on top of the pile are kept once they land.
      while (flying.length > 16) flying.shift()?.leaf.remove();
      k++;
      return l;
    };
    // The first leaf lifts the page lying open, the ribbon with it when that lies on it; under it, the next is blank
    // paper written on.
    // The edges and the tabs move with the leaves, so a lift has the page's thread to itself while it draws the ribbon out.
    const first = (): void => {
      layDepth(target, 1800);
      markTabs(target);
      const lifted = (forward ? right : left).firstElementChild as HTMLElement;
      put(forward ? right : left, face(1));
      launch(forward ? lifted : face(0), forward ? face(0) : lifted, RIFFLE.ms, forward && lies === "here");
      later(step, RIFFLE.ends);
    };
    const land = (last: HTMLElement): void => {
      shutRiffle = null;
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
    // Shut part way, the leaves fall shut with the cover, and the ribbon with the leaf it lies on, or from where it is
    // being lifted across. The book lies shut at the page the riffle left.
    shutRiffle = (): void => {
      shutRiffle = null;
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
      // The last leaf carries the page asked for, and the page beside it lies beneath.
      const to = pages.spread(target);
      put(forward ? right : left, forward ? to.right : to.left);
      // Riffling to the ribbon's page: forward, the last leaf lifts off it lying there; back, the last leaf brings it over.
      if (home && forward) rest("here");
      // Its leaves turn flat: bending its first and last stalled the page's thread for half a second once a riffle.
      const last = launch(forward ? face(k * 2) : to.right, forward ? to.left : face(k * 2), RIFFLE.ms + 260, home && !forward);
      later(() => land(last), RIFFLE.ms + 300);
    };
    if (lifts) later(first, LIFT.leaves);
    else first();
  }

  /**
   * A turn under way: the leaf laid with the pages it carries, the new pages
   * beneath, so a tap or a drag can carry it over (`finish`) or let it fall
   * back (`cancel`). A leaf whose far side's picture is still being made lifts
   * no further than keeps it out of sight (`HOLD`) until it is whole.
   */
  interface Turn {
    readonly forward: boolean;
    /** Sets the leaf this far over, 0 lying where it started to 1 turned, as a hand holds it. */
    hold(progress: number): void;
    /** Carries the leaf the rest of the way from `progress`, waiting at its edge for a picture still being made. */
    finish(progress: number): void;
    /** Lets the leaf fall back from `progress` and lays the pages as they were. */
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
      // The right page lifts and turns over onto the left, showing the new left page on its back; the new right page lies beneath.
      put(leafFront, right.firstElementChild as HTMLElement | null);
      put(leafBack, to.left);
      put(right, to.right);
    } else {
      // The left page lifts and turns back onto the right, showing the new right page on its front; the new left page lies beneath.
      leaf.classList.add("over");
      put(leafBack, left.firstElementChild as HTMLElement | null);
      put(leafFront, to.right);
      put(left, to.left);
    }
    // The tabs move with the page as it turns.
    markTabs(target);
    // The ribbon lying on the page that turns goes over with it; turning forward onto its page, the leaf lifts off it.
    const carries = from !== null && pages.order(forward ? from : target, marked) === 0;
    if (forward && pages.order(target, marked) === 0) rest("here");
    void leaf.offsetWidth;
    // The leaf bends and casts its shadow, its strips following the leaf's own angle every frame, by hand or not, and
    // the ribbon on it the strip by the spine, where it lies.
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
      // Drawn again out of sight, now whole, before the leaf can show it.
      if (!turning) return;
      put(forward ? leafBack : left, pages.spread(target).left);
      ready = true;
      if (curl !== null) bend();
    });
    /** The leaf's angle at `progress` over, held short of showing a picture not yet whole. */
    const angleAt = (progress: number): number => {
      const deg = forward ? -179.6 * progress : -179.6 * (1 - progress);
      return ready ? deg : forward ? Math.max(deg, HOLD.forward) : Math.min(deg, HOLD.back);
    };
    const lay = (deg: number, ms: number, ease = "cubic-bezier(.3,.1,.3,1)"): void => {
      leaf.style.transition = ms > 0 ? `transform ${ms}ms ${ease}` : "none";
      leaf.style.transform = `translateZ(1.4px) rotateY(${deg.toFixed(2)}deg)`;
    };
    const done = (): void => {
      unbend();
      leaf.style.transition = "";
      leaf.style.transform = "";
      if (forward) put(left, leafBack.firstElementChild as HTMLElement | null);
      else put(right, leafFront.firstElementChild as HTMLElement | null);
      leaf.hidden = true;
      leaf.classList.remove("turning", "over");
      put(leafFront, null);
      put(leafBack, null);
      // The pages lying open are the ones that turned: nothing is drawn again once a turn is done.
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
    return {
      forward,
      hold: (progress) => lay(angleAt(progress), 0),
      finish(progress) {
        const over = (from: number): void => {
          const rest = Math.max(160, ms * (1 - from));
          lay(forward ? -179.6 : 0, rest);
          window.setTimeout(done, rest + 40);
        };
        void settledSoon(whole).then((now) => {
          if (now) return over(progress);
          // The page beneath is whole; the picture on the leaf's far side is not yet, so the leaf lifts and waits.
          lay(angleAt(Math.max(progress, 0.5)), HOLD.ms, "cubic-bezier(.2,.7,.3,1)");
          void whole.then(() => over(Math.max(progress, 0.5)));
        });
      },
      cancel(progress) {
        const back = Math.max(160, TURN_MS * progress);
        lay(forward ? 0 : -179.6, back);
        window.setTimeout(() => {
          unbend();
          // The pages lie as they were before the leaf was taken.
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
        }, back + 40);
      },
    };
  }

  // ---------- turning a page by hand ----------

  /**
   * A page is turned by taking it: pressed and drawn toward the spine, the
   * spot taken stays under the finger or the mouse as the leaf turns, and let
   * go past halfway it falls over, short of it it falls back. A press that
   * hardly moves is a tap, and a tap goes on to the row, name or picture under
   * it, or turns the page from bare paper (below).
   */
  let taken: { readonly side: "left" | "right"; readonly x0: number; readonly y0: number; turn: Turn | null; progress: number; reach: number } | null = null;
  let dragged = false;
  const take = (side: "left" | "right") => (e: PointerEvent): void => {
    if (!open || turning || e.button !== 0) return;
    // How far from the spine the page was taken: that spot is what follows the pointer.
    const r = (side === "right" ? right : left).getBoundingClientRect();
    taken = { side, x0: e.clientX, y0: e.clientY, turn: null, progress: 0, reach: Math.max(40, side === "right" ? e.clientX - r.left : r.right - e.clientX) };
  };
  // A finger takes a page anywhere on it; a mouse only by its edge, so a press while reading never starts a turn.
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
      // A page is taken only when drawn toward the spine, further than a tap's wobble.
      if (toward < DRAG.start || Math.abs(e.clientY - taken.y0) > toward) return;
      const target = at === null ? null : pages.next(at, taken.side === "right" ? 1 : -1);
      if (target === null || turning) {
        taken = null;
        return;
      }
      taken.turn = beginTurn(target);
      dragged = true;
      // The hand that holds a page closes on it.
      root.classList.add("taking");
    }
    // Turned by an angle, the spot taken lies its reach times the angle's cosine from the spine: the angle that puts it
    // under the pointer.
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
    // The click that ends a drag comes at once; any other click after it is a tap again.
    if (dragged) window.setTimeout(() => (dragged = false), 0);
  };
  window.addEventListener("pointerup", letGo);
  window.addEventListener("pointercancel", letGo);
  // A drag is not a tap: the click that ends it never reaches a row or a picture.
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

  let arriving = 0;
  /** The cover swings `ms` from now, and the ribbon lying on the leaves it carries swings with it. */
  function swingAfter(ms: number): void {
    cover.style.transitionDelay = `${ms}ms`;
    ribbon.style.transitionDelay = `${ms}ms`;
  }
  /** Opens or shuts the book. Opening, `followIn` runs as soon as a riffle can follow the cover over (`COVER_LEAD`). */
  function setOpen(on: boolean, place0?: string, followIn?: () => void): void {
    if (on === open) return;
    open = on;
    root.classList.toggle("open", on);
    // The fore-edge's tabs show once the book has come to your hands, and go as it is shut.
    window.clearTimeout(arriving);
    if (on) arriving = window.setTimeout(() => root.classList.add("arrived"), TRAVEL_MS);
    else root.classList.remove("arrived");
    onOpen(on);
    if (on) {
      const opensAt = place0 ?? "map";
      show(opensAt);
      // Lifted from the corner first, the cover swinging open as it arrives; if the page it opens onto is still being
      // painted, the book waits shut in your hands and opens once it is whole.
      book.style.transition = `transform ${TRAVEL_MS}ms cubic-bezier(.45,.05,.3,1)`;
      inner.style.transition = `transform ${COVER_MS}ms cubic-bezier(.45,.05,.3,1) ${TRAVEL_MS * 0.45}ms`;
      swingAfter(TRAVEL_MS * 0.45);
      place(true);
      // Timed from when the cover starts to swing, which waits on its delay, on the page it opens onto being whole and
      // on the page's thread.
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
          // Drawn again under the shut cover, now whole, before it opens.
          show(opensAt);
          swingAfter(0);
          cover.classList.add("open");
        });
      });
    } else {
      // The cover swings shut over the page you were reading, then the book is set back in its corner.
      shutRiffle?.();
      inner.style.transition = `transform ${COVER_MS}ms cubic-bezier(.45,.05,.3,1)`;
      swingAfter(0);
      book.style.transition = `transform ${TRAVEL_MS}ms cubic-bezier(.45,.05,.3,1) ${COVER_MS * 0.6}ms`;
      place(false);
    }
  }

  // ---------- touching the book ----------

  /** Whether a page lies that way from the open spread: the first spread's left and the last one's right turn nowhere. */
  const turns = (side: "left" | "right"): boolean => open && at !== null && pages.next(at, side === "right" ? 1 : -1) !== null;
  /** Turns to the next spread forward (1) or back (-1), if there is one. */
  function turnBy(by: 1 | -1): void {
    const to = open && at !== null ? pages.next(at, by) : null;
    if (to !== null) turnTo(to);
  }
  /**
   * Lays each margin over its page as the spread lies now. Where no page lies that way it stands aside, flat, and a
   * click there is the page's own. Over a row, a name, a fold or a way back it leaves a hole, so those keep their
   * own clicks and their underline; over the map, a picture or bare paper the margin is the page's edge.
   */
  function layEdges(): void {
    layRibbon();
    for (const m of margins) {
      const side = m.classList.contains("right") ? "right" : "left";
      m.classList.toggle("none", !turns(side));
      m.style.clipPath = holesFor(side);
    }
  }
  /** The margin's shape as a clip path: its strip less every button on the page under it, or none when it covers none. */
  function holesFor(side: "left" | "right"): string {
    const page = (side === "right" ? right : left).firstElementChild;
    if (!(page instanceof HTMLElement)) return "";
    // The strip's left side, in the page's own pixels.
    const from = side === "right" ? PAGE.w - EDGE : 0;
    const holes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const b of page.querySelectorAll<HTMLElement>("button")) {
      // A fold not shown, or a row past the page's end, takes no click.
      if (b.offsetParent === null || b.closest(".jp-past") !== null) continue;
      let [x, y] = [0, 0];
      for (let n: HTMLElement | null = b; n !== null && n !== page; n = n.offsetParent as HTMLElement | null) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      const [x0, x1] = [Math.max(0, x - from), Math.min(EDGE, x + b.offsetWidth - from)];
      if (x1 <= x0) continue;
      // Rows one under the next make one hole: a seam between two would lift the page as the pointer crossed it.
      const last = holes.at(-1);
      if (last !== undefined && last.x0 === x0 && last.x1 === x1 && y <= last.y1 + 1 && y >= last.y0) last.y1 = Math.max(last.y1, y + b.offsetHeight);
      else holes.push({ x0, x1, y0: y, y1: y + b.offsetHeight });
    }
    if (holes.length === 0) return "";
    return `path(evenodd, "M0 0H${EDGE}V${PAGE.h}H0Z${holes.map((h) => `M${h.x0} ${h.y0}H${h.x1}V${h.y1}H${h.x0}Z`).join("")}")`;
  }

  // The outer fifth of each page is its edge, which turns it; a tap on the cover's slip while closed opens the book.
  const margin = (side: "left" | "right"): HTMLElement => {
    const m = el(`jb-margin ${side}`, inner);
    margins.push(m);
    // Scaled about the spine, where the open book's middle meets the view's (`liftMargins`).
    m.style.transformOrigin = side === "right" ? "calc(var(--edge) - var(--pw)) 50%" : "var(--pw) 50%";
    // Its edge lifts a little under the pointer, the way a page invites you to take it, and it can be taken from here.
    const page = side === "right" ? right : cover;
    // Only where a page lies that way: the first spread's left edge and the last one's right stay flat (`layEdges`).
    m.addEventListener("pointerenter", () => {
      if (turns(side) && !turning) page.classList.add("lift");
      if (turns(side) && !turning) sway();
    });
    m.addEventListener("pointerleave", () => page.classList.remove("lift"));
    m.addEventListener("pointerdown", (e) => {
      // Taken, the page lies flat at once: easing back from its lift under the leaf that takes over would flicker.
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
  // A click on bare paper turns that way too: the right-hand page forward, the left back. Whatever on a page answers a
  // click of its own (a row, a name, a fold, a way back, a map or a picture) stops it before it gets here.
  right.addEventListener("click", () => turnBy(1));
  left.addEventListener("click", () => turnBy(-1));
  // So does a swipe sideways on a trackpad, or the wheel, one page a gesture. Nothing on a page scrolls, so the wheel
  // over the open book is always a turn. A pinch is a zoom, and is left alone.
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
  // The closed book's cover, around the slip, lifts it too.
  coverFront.addEventListener("click", () => {
    if (!open) {
      layTabs();
      setOpen(true);
    }
  });
  function layTabs(): void {
    tabs.replaceChildren(
      ...pages.tabs().map((t, k) => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "jb-tab";
        tab.dataset.at = t.at;
        tab.dataset.from = t.from;
        tab.style.top = `${40 + k * 84}px`;
        const name = document.createElement("span");
        name.textContent = t.name;
        tab.append(name);
        tab.addEventListener("click", (e) => {
          e.stopPropagation();
          turnTo(t.at);
        });
        return tab;
      }),
    );
  }
  window.addEventListener(
    "keydown",
    (e) => {
      // Typing in the finder laid over the book is the finder's.
      if (!open || e.target instanceof HTMLInputElement) return;
      // While the book is open the world waits: no key reaches it.
      if (e.code === "Escape" || e.code === "KeyM") setOpen(false);
      else if (e.code === "ArrowRight" || e.code === "ArrowLeft") turnBy(e.code === "ArrowRight" ? 1 : -1);
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
      // The book is lifted at the page it opens at once that is whole. For a page still being made it opens at the
      // map, and the riffle on to that page starts as the cover opens and leafs on until the page is whole.
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
      if (open && at !== null && !turning) show(at);
    },
    state: () => ({ open, at, turning }),
  };
  return api;
}
