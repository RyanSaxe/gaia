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
  /** The fore-edge's tabs: each top chapter's name and place. */
  tabs(): readonly { readonly name: string; readonly at: string }[];
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
/** How long a leaf takes to turn, the cover to swing, and the book to travel between its corner and your hands, ms. */
const TURN_MS = 720;
const COVER_MS = 900;
const TRAVEL_MS = 1050;
/** The closed book's tilt in its corner, degrees, and how much of the view the open book may take. */
const CORNER_TILT = -6;
const FILL = { w: 0.94, h: 0.88 } as const;

const el = (cls: string, parent?: HTMLElement): HTMLDivElement => {
  const e = document.createElement("div");
  e.className = cls;
  parent?.append(e);
  return e;
};

export function createJournalBook(layer: HTMLElement, pages: BookPages, onOpen: (open: boolean) => void): JournalBook {
  const root = el("journal", layer);
  root.style.setProperty("--leather", `url(${LEATHER})`);
  root.style.setProperty("--paper", `url(${PAPER})`);
  root.style.setProperty("--pw", `${PAGE.w}px`);
  root.style.setProperty("--ph", `${PAGE.h}px`);
  root.style.setProperty("--ov", `${PAGE.overhang}px`);
  // While the book is open the world waits under it: a tap anywhere but the book shuts it.
  const catcher = el("journal-catch", root);
  const book = el("journal-book", root);
  const inner = el("jb-inner", book);
  el("jb-board", inner);
  el("jb-block", inner);
  const right = el("jb-right", inner);
  const tabs = el("jb-tabs", inner);
  const leaf = el("jb-leaf", inner);
  const leafFront = el("jb-face front", leaf);
  const leafBack = el("jb-face back", leaf);
  const cover = el("jb-cover", inner);
  const coverFront = el("jb-face front", cover);
  const coverBack = el("jb-face back", cover);
  el("jb-stitch", coverFront);
  const slip = el("jb-slip", coverFront);
  el("jb-strap", coverFront);
  const left = el("jb-left", coverBack);
  leaf.hidden = true;

  let open = false;
  let at: string | null = null;
  let turning = false;
  let queued: string | null = null;

  const put = (into: HTMLElement, page: HTMLElement | null): void => {
    into.replaceChildren(...(page === null ? [] : [page]));
    if (page !== null) requestAnimationFrame(() => endOnWholeLine(page));
  };
  /** A page ends on a whole line or row: one its body cuts short is left off. */
  function endOnWholeLine(page: HTMLElement): void {
    const body = page.querySelector<HTMLElement>(".jp-body");
    if (body === null) return;
    const bottom = body.clientHeight;
    for (const line of body.querySelectorAll<HTMLElement>(".jp-line, .jp-row")) line.classList.toggle("jp-past", line.offsetTop + line.offsetHeight > bottom);
  }
  function show(place: string): void {
    const s = pages.spread(place);
    put(left, s.left);
    put(right, s.right);
    at = place;
    for (const t of tabs.children) t.classList.toggle("on", (t as HTMLElement).dataset.at !== undefined && within(place, (t as HTMLElement).dataset.at as string));
  }
  /** Whether `place` lies in the chapter at `chapter`: it is the chapter or comes after it and before the next tab. */
  function within(place: string, chapter: string): boolean {
    const list = pages.tabs();
    const k = list.findIndex((t) => t.at === chapter);
    const next = list[k + 1];
    return pages.order(chapter, place) <= 0 && (next === undefined || pages.order(place, next.at) < 0);
  }

  // ---------- where the book is: its corner, or held open ----------

  /** The scale at which the open book fits the view, and the corner pose that puts the slip where the minimap is. */
  function poses(): { held: string; corner: string; scale: number } {
    const vw = layer.clientWidth || window.innerWidth;
    const vh = layer.clientHeight || window.innerHeight;
    const scale = Math.min((vw * FILL.w) / (PAGE.w * 2 + PAGE.overhang * 2), (vh * FILL.h) / (PAGE.h + PAGE.overhang * 2));
    // The slip's middle, in the closed book's own pixels from the spine's middle, is laid where the minimap's is today.
    const slipX = 26 + 92 - PAGE.w / 2;
    const slipY = 24 + 92 - PAGE.h / 2 - PAGE.overhang;
    const side = 156;
    const mx = vw - 18 - side / 2;
    const my = vh - 22 - side / 2;
    const k = (side / 184) * 1;
    const a = (CORNER_TILT * Math.PI) / 180;
    const cx = mx - k * (slipX * Math.cos(a) - slipY * Math.sin(a));
    const cy = my - k * (slipX * Math.sin(a) + slipY * Math.cos(a));
    return {
      held: `translate(${vw / 2}px, ${vh / 2}px) rotateX(6deg) scale(${scale})`,
      corner: `translate(${cx}px, ${cy}px) rotateZ(${CORNER_TILT}deg) scale(${k})`,
      scale,
    };
  }
  const closedShift = `translateX(${-(PAGE.w / 2 + PAGE.overhang / 2)}px)`;
  function place(isOpen: boolean): void {
    const p = poses();
    book.style.transform = isOpen ? p.held : p.corner;
    inner.style.transform = isOpen ? "translateX(0)" : closedShift;
    cover.classList.toggle("open", isOpen);
  }
  place(false);
  window.addEventListener("resize", () => place(open));

  // ---------- turning ----------

  function turnTo(target: string): void {
    if (!open || target === at) return;
    if (turning) {
      queued = target;
      return;
    }
    const from = at;
    const forward = from === null || pages.order(from, target) < 0;
    const to = pages.spread(target);
    turning = true;
    leaf.hidden = false;
    leaf.classList.remove("over", "turning");
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
    void leaf.offsetWidth;
    leaf.classList.add("turning");
    leaf.classList.toggle("over", forward);
    window.setTimeout(() => {
      if (forward) put(left, leafBack.firstElementChild as HTMLElement | null);
      else put(right, leafFront.firstElementChild as HTMLElement | null);
      leaf.hidden = true;
      leaf.classList.remove("turning", "over");
      put(leafFront, null);
      put(leafBack, null);
      turning = false;
      show(target);
      if (queued !== null) {
        const next = queued;
        queued = null;
        turnTo(next);
      }
    }, TURN_MS + 40);
  }

  // ---------- opening and closing ----------

  function setOpen(on: boolean, place0?: string): void {
    if (on === open) return;
    open = on;
    root.classList.toggle("open", on);
    onOpen(on);
    if (on) {
      show(place0 ?? "map");
      // Lifted from the corner first, the cover swinging open as it arrives.
      book.style.transition = `transform ${TRAVEL_MS}ms cubic-bezier(.45,.05,.3,1)`;
      inner.style.transition = `transform ${COVER_MS}ms cubic-bezier(.45,.05,.3,1) ${TRAVEL_MS * 0.45}ms`;
      cover.style.transitionDelay = `${TRAVEL_MS * 0.45}ms`;
      place(true);
    } else {
      // The cover swings shut over the page you were reading, then the book is set back in its corner.
      inner.style.transition = `transform ${COVER_MS}ms cubic-bezier(.45,.05,.3,1)`;
      cover.style.transitionDelay = "0ms";
      book.style.transition = `transform ${TRAVEL_MS}ms cubic-bezier(.45,.05,.3,1) ${COVER_MS * 0.6}ms`;
      place(false);
    }
  }

  // ---------- touching the book ----------

  // The outer margin of each page turns it; a tap on the cover's slip while closed opens the book.
  const margin = (side: "left" | "right"): HTMLElement => {
    const m = el(`jb-margin ${side}`, inner);
    m.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!open || at === null) return;
      const to = pages.next(at, side === "right" ? 1 : -1);
      if (to !== null) turnTo(to);
    });
    return m;
  };
  margin("left");
  margin("right");
  catcher.addEventListener("click", () => setOpen(false));
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
      if (!open) return;
      // While the book is open the world waits: no key reaches it.
      if (e.code === "Escape" || e.code === "KeyM") setOpen(false);
      else if (e.code === "ArrowRight" || e.code === "ArrowLeft") {
        const to = at === null ? null : pages.next(at, e.code === "ArrowRight" ? 1 : -1);
        if (to !== null) turnTo(to);
      }
      e.stopPropagation();
      if (e.code !== "Tab") e.preventDefault();
    },
    true,
  );

  return {
    open: (place0) => {
      layTabs();
      if (open) {
        if (place0 !== undefined) turnTo(place0);
        return;
      }
      setOpen(true, place0);
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
}
