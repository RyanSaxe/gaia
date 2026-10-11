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
  /** The fore-edge's tabs: each one's name, the place it opens at, and the chapter its part of the book begins with. */
  tabs(): readonly { readonly name: string; readonly at: string; readonly from: string }[];
  /** Settles once everything a place's spread needs, such as a file's text, has come, so its pages are drawn whole. */
  ready?(at: string): Promise<void>;
  /** Settles once a place's painting is whole: a page is never seen before its painting. */
  painted?(at: string): Promise<void>;
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
/** The longest a turn waits for a file's text, ms, and for a painting, which only one that failed to come takes. */
const TEXT_AT_MOST = 900;
const PAINTED_AT_MOST = 15000;
/**
 * A leaf whose next page is still being painted lifts at once and waits at
 * its edge, so a tap is always answered: how far it lifts (degrees, the
 * painting still out of sight) and how slowly, ms. Then it comes over.
 */
const HOLD = { forward: -64, back: -175, ms: 1600 } as const;
/** How far a page must be drawn toward the spine before it is taken rather than tapped, px. */
const DRAG = { start: 12 } as const;
/** How long a leaf takes to turn, the cover to swing, and the book to travel between its corner and your hands, ms. */
const TURN_MS = 720;
const COVER_MS = 900;
const TRAVEL_MS = 1050;
/** The closed book's tilt in its corner, degrees, and how much of the view the open book may take. */
const CORNER_TILT = 6;
/** The closed book in its corner: a little smaller than the slip's own size, and close in to the screen's edges, px. */
const CORNER = { scale: 0.86, margin: { x: 12, y: 14 } } as const;
const FILL = { w: 0.94, h: 0.88 } as const;

const el = (cls: string, parent?: HTMLElement): HTMLDivElement => {
  const e = document.createElement("div");
  e.className = cls;
  parent?.append(e);
  return e;
};

export function createJournalBook(layer: HTMLElement, pages: BookPages, onOpen: (open: boolean) => void): JournalBook {
  const root = el("journal", layer);
  // The brush: a stroke or a wash of color laid by hand, its edge wandering a little, as the mocks paint them.
  root.insertAdjacentHTML(
    "beforeend",
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <filter id="jp-wash" x="-10%" y="-20%" width="120%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="4" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="16" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="1.2"/></filter>
      <filter id="jp-brush" x="-60%" y="-5%" width="220%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="7" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="0.7"/></filter>
    </svg>`,
  );
  root.style.setProperty("--leather", `url(${LEATHER})`);
  root.style.setProperty("--paper", `url(${PAPER})`);
  root.style.setProperty("--pw", `${PAGE.w}px`);
  root.style.setProperty("--ph", `${PAGE.h}px`);
  root.style.setProperty("--ov", `${PAGE.overhang}px`);
  // While the book is open the world waits under it: a tap anywhere but the book shuts it.
  const catcher = el("journal-catch", root);
  const book = el("journal-book", root);
  const inner = el("jb-inner", book);
  el("jb-spine", inner);
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
  el("jb-block left", coverBack);
  const left = el("jb-left", coverBack);
  leaf.hidden = true;

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
    /** How far down the page's body a row sits, through the code and notes that hold it. */
    const down = (e: HTMLElement): number => {
      let y = 0;
      for (let n: HTMLElement | null = e; n !== null && n !== body; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      return y;
    };
    const rows = [...body.querySelectorAll<HTMLElement>(".jp-line, .jp-row, .jp-said-row")];
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
        fold.textContent = body.querySelector(".jp-code.prose") !== null ? "read on" : `${more.toLocaleString("en-US")} more ${more === 1 ? "line" : "lines"}`;
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
      const joins = last !== undefined && e.classList.contains("jp-line") && last.nextElementSibling === e && last.style.getPropertyValue("--mark") === e.style.getPropertyValue("--mark") && last.style.getPropertyValue("--mark-strength") === e.style.getPropertyValue("--mark-strength");
      if (joins) runs[runs.length - 1]?.push(e);
      else runs.push([e]);
    }
    for (const run of runs) {
      const first = run[0] as HTMLElement;
      const end = run[run.length - 1] as HTMLElement;
      const holder = first.parentElement as HTMLElement;
      const stroke = document.createElement("i");
      stroke.className = `jp-stroke ${first.classList.contains("jp-row") ? "row" : "line"}`;
      stroke.style.top = `${first.offsetTop + 3}px`;
      stroke.style.height = `${end.offsetTop + end.offsetHeight - first.offsetTop - 6}px`;
      stroke.style.background = first.style.getPropertyValue("--mark");
      stroke.style.opacity = first.style.getPropertyValue("--mark-strength");
      holder.append(stroke);
    }
  }
  function markTabs(place: string): void {
    for (const t of tabs.children) t.classList.toggle("on", (t as HTMLElement).dataset.from !== undefined && within(place, (t as HTMLElement).dataset.from as string));
  }
  function show(place: string): void {
    const s = pages.spread(place);
    put(left, s.left);
    put(right, s.right);
    at = place;
    markTabs(place);
  }
  const after = (ms: number): Promise<void> => new Promise<void>((r) => window.setTimeout(r, ms));
  /** Waits until a place's spread can be drawn whole, but never long: a slow file is drawn without its code rather than held. */
  const readied = (place: string): Promise<void> => Promise.race([pages.ready?.(place) ?? Promise.resolve(), after(TEXT_AT_MOST)]);
  /** Settles once a place's painting is whole; one that never comes is shown bare after a while. */
  const painted = (place: string): Promise<void> => Promise.race([pages.painted?.(place) ?? Promise.resolve(), after(PAINTED_AT_MOST)]);
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
    turning = true;
    void readied(target).then(() => turnNow(target));
  }
  function turnNow(target: string): void {
    if (!open) {
      turning = false;
      return;
    }
    beginTurn(target).finish(0);
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
  function beginTurn(target: string): Turn {
    const from = at;
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
    void leaf.offsetWidth;
    const whole = painted(target);
    let ready = false;
    void whole.then(() => {
      // Drawn again out of sight, now whole, before the leaf can show it.
      if (!turning) return;
      put(forward ? leafBack : left, pages.spread(target).left);
      ready = true;
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
      leaf.style.transition = "";
      leaf.style.transform = "";
      if (forward) put(left, leafBack.firstElementChild as HTMLElement | null);
      else put(right, leafFront.firstElementChild as HTMLElement | null);
      leaf.hidden = true;
      leaf.classList.remove("turning", "over");
      put(leafFront, null);
      put(leafBack, null);
      turning = false;
      // The pages lying open are the ones that turned: nothing is drawn again once a turn is done.
      at = target;
      markTabs(target);
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
          const rest = Math.max(160, TURN_MS * (1 - from));
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
        }, back + 40);
      },
    };
  }

  // ---------- turning a page by hand ----------

  /**
   * A page is turned by taking it: pressed and drawn toward the spine, the
   * spot taken stays under the finger or the mouse as the leaf turns, and let
   * go past halfway it falls over, short of it it falls back. A press that
   * hardly moves is a tap, and taps go on to the rows, names and pictures as
   * before.
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

  function setOpen(on: boolean, place0?: string): void {
    if (on === open) return;
    open = on;
    root.classList.toggle("open", on);
    onOpen(on);
    if (on) {
      const opensAt = place0 ?? "map";
      show(opensAt);
      // Lifted from the corner first, the cover swinging open as it arrives; if the page it opens onto is still being
      // painted, the book waits shut in your hands and opens once it is whole.
      book.style.transition = `transform ${TRAVEL_MS}ms cubic-bezier(.45,.05,.3,1)`;
      inner.style.transition = `transform ${COVER_MS}ms cubic-bezier(.45,.05,.3,1) ${TRAVEL_MS * 0.45}ms`;
      cover.style.transitionDelay = `${TRAVEL_MS * 0.45}ms`;
      place(true);
      const whole = painted(opensAt);
      void settledSoon(whole).then((ready) => {
        if (ready || !open) return;
        cover.classList.remove("open");
        void whole.then(() => {
          if (!open) return;
          // Drawn again under the shut cover, now whole, before it opens.
          show(opensAt);
          cover.style.transitionDelay = "0ms";
          cover.classList.add("open");
        });
      });
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
    // Its edge lifts a little under the pointer, the way a page invites you to take it, and it can be taken from here.
    const page = side === "right" ? right : cover;
    m.addEventListener("pointerenter", () => open && !turning && page.classList.add("lift"));
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
      // The book is lifted once the page it opens at can be drawn whole.
      void readied(place0 ?? "map").then(() => setOpen(true, place0));
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
