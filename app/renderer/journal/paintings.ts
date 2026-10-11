// The journal's paintings. A thing's page pictures the world's own view of
// it (`WorldHandle.view`), painted on painters' own threads. A page is never
// seen before its painting exists: the book waits for it before the leaf that
// shows it moves (`painted`). So that wait is rare, paintings are made ahead,
// out of sight: the title page once the world stands, then the pages on
// either side of the one open, then the things nearest the person while they
// stand still, never while they walk. Each painting is kept with the world
// (`PaintingStore`), so a world opened again is not painted again, and a
// thing whose vitality changed is.

import type { Pixels } from "../terrain/capture.ts";
import type { PainterJob, PainterReply } from "./painter-worker.ts";
import PainterWorker from "./painter-worker.ts?worker";
import type { PaintingStore } from "./painting-store.ts";

/** The view taken of a thing, pixels: half the painting's size, as fine as its finest strokes need. */
const VIEW = { w: 520, h: 660 } as const;
/** The painting, device pixels: two to each of a page's pixels. */
const PAINTED = { w: 1040, h: 1320 } as const;
/** How often the things near the person are looked at again while they walk, ms. */
const IDLE_CHECK = 400;
/** The least time between views taken of things near the person, ms: each draws the world once more in a frame. */
const NEAR_EVERY = 3000;

export interface PaintingsOptions {
  /** The world's own view of a thing, `wide` as a frontispiece shows it, or null when nothing stands for it. */
  view(id: string, w: number, h: number, wide?: boolean): Promise<{ readonly color: Pixels; readonly mask: Pixels } | null>;
  /** Where paintings are kept between visits. */
  store?: PaintingStore;
  /** A painting's key in the store: its world, its thing and how the thing stands; null keeps nothing for it. */
  keyOf?(id: string, wide: boolean): string | null;
  /** Whether the things near the person may be painted now: never while they walk. */
  idle?(): boolean;
}

export interface Paintings {
  /**
   * The painting of what `id` stands for, on a canvas of its own. The book
   * shows it only once `painted` has settled, so it is whole when seen.
   * `wide` paints the thing small in its land, as the title page's
   * frontispiece shows the world.
   */
  picture(id: string, wide?: boolean): HTMLCanvasElement;
  /** Settles once `id` is painted, or found to have nothing to paint, painting it before anything else. */
  painted(id: string, wide?: boolean): Promise<void>;
  /** Paints these next, ahead of the reader. */
  ahead(ids: readonly string[], wide?: boolean): void;
  /** Paints these when nothing else waits and the person stands still: the things nearest them. */
  near(ids: readonly string[]): void;
  /** How far the painting of `id` is: not begun, under way, done, or nothing stands for it. */
  state(id: string, wide?: boolean): "waiting" | "painting" | "done" | "none";
  /** Forgets every painting, for a world that changed. */
  clear(): void;
}

/** How soon a painting is wanted: asked for by the book, ahead of the reader, or near the person. */
type Rank = 0 | 1 | 2;

interface Painting {
  state: "waiting" | "painting" | "done" | "none";
  rank: Rank;
  /** The finished painting. */
  done: ImageBitmap | null;
  /** The canvases waiting to show it. */
  readonly shown: Set<HTMLCanvasElement>;
  readonly settled: Promise<void>;
  readonly settle: () => void;
}

/** What a painting is of, as the queue and the store name it: a thing, or a thing seen wide. */
const WIDE = "wide:";
const named = (thing: string, wide: boolean): string => (wide ? `${WIDE}${thing}` : thing);
/** A painting's seed: the same thing is always painted with the same strokes. */
const seedOf = (id: string): number => [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
/** Painters working at once: enough to keep ahead of a reader, never so many the computer labors. */
const PAINTERS = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency ?? 4) / 3)));

export function createPaintings(options: PaintingsOptions): Paintings {
  let paintings = new Map<string, Painting>();
  const painters = Array.from({ length: PAINTERS }, () => ({ worker: null as Worker | null, busy: false }));
  let jobs = 0;
  /** One view taken at a time: each draws the world, so they never share a frame. */
  let viewing: Promise<unknown> = Promise.resolve();
  let idleTimer = 0;
  let lastNear = -Infinity;

  const entry = (id: string): Painting => {
    let p = paintings.get(id);
    if (p === undefined) {
      let settle = (): void => {};
      const settled = new Promise<void>((resolve) => (settle = resolve));
      p = { state: "waiting", rank: 2, done: null, shown: new Set(), settled, settle };
      paintings.set(id, p);
    }
    return p;
  };
  const want = (id: string, rank: Rank): Painting => {
    const p = entry(id);
    p.rank = Math.min(p.rank, rank) as Rank;
    return p;
  };
  const finish = (p: Painting, state: "done" | "none", bitmap: ImageBitmap | null): void => {
    p.state = state;
    p.done = bitmap;
    if (bitmap !== null) for (const c of p.shown) (c.getContext("2d") as CanvasRenderingContext2D).drawImage(bitmap, 0, 0);
    p.shown.clear();
    p.settle();
  };

  /** The waiting painting wanted soonest, in the order asked; near things only while the person stands still. */
  function take(): string | undefined {
    let best: [string, Painting] | undefined;
    for (const [id, p] of paintings) if (p.state === "waiting" && (best === undefined || p.rank < best[1].rank)) best = [id, p];
    if (best === undefined) return undefined;
    if (best[1].rank === 2) {
      const wait = options.idle?.() === false ? IDLE_CHECK : lastNear + NEAR_EVERY - performance.now();
      if (wait > 0) {
        if (idleTimer === 0) idleTimer = window.setTimeout(() => ((idleTimer = 0), pump()), wait);
        return undefined;
      }
      lastNear = performance.now();
    }
    return best[0];
  }

  function pump(): void {
    for (const painter of painters) {
      if (painter.busy) continue;
      const id = take();
      if (id === undefined) return;
      void paintOne(id, painter);
    }
  }

  async function paintOne(id: string, painter: (typeof painters)[number]): Promise<void> {
    const mine = paintings;
    const p = entry(id);
    p.state = "painting";
    painter.busy = true;
    const wide = id.startsWith(WIDE);
    const thing = wide ? id.slice(WIDE.length) : id;
    try {
      const key = options.keyOf?.(thing, wide) ?? null;
      const kept = key === null ? null : ((await options.store?.get(key)) ?? null);
      if (kept !== null) return finish(p, "done", await createImageBitmap(kept));
      const look = viewing.then(() => options.view(thing, VIEW.w, VIEW.h, wide));
      viewing = look.catch(() => null);
      const seen = await look;
      if (seen === null || mine !== paintings) return finish(p, "none", null);
      painter.worker ??= new PainterWorker();
      const worker = painter.worker;
      const job: PainterJob = { id: ++jobs, color: seen.color, mask: seen.mask, w: PAINTED.w, h: PAINTED.h, seed: seedOf(id) };
      const reply = await new Promise<PainterReply>((resolve) => {
        worker.onmessage = (e: MessageEvent<PainterReply>) => {
          if (e.data.id === job.id) resolve(e.data);
        };
        worker.postMessage(job, [job.color.data.buffer, job.mask.data.buffer]);
      });
      if (!("painting" in reply)) return finish(p, "none", null);
      if (mine !== paintings) return void reply.painting.close();
      finish(p, "done", reply.painting);
      if (key !== null && reply.kept !== null) void options.store?.put(key, reply.kept);
    } catch {
      finish(p, "none", null);
    } finally {
      painter.busy = false;
      pump();
    }
  }

  return {
    picture(thing, wide = false) {
      const id = named(thing, wide);
      const canvas = document.createElement("canvas");
      canvas.width = PAINTED.w;
      canvas.height = PAINTED.h;
      const p = want(id, 0);
      if (p.done !== null) (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(p.done, 0, 0);
      else if (p.state === "waiting" || p.state === "painting") p.shown.add(canvas);
      pump();
      return canvas;
    },
    painted(thing, wide = false) {
      const p = want(named(thing, wide), 0);
      pump();
      return p.settled;
    },
    ahead(things, wide = false) {
      for (const t of things) want(named(t, wide), 1);
      pump();
    },
    near(things) {
      for (const t of things) want(t, 2);
      pump();
    },
    state: (thing, wide = false) => paintings.get(named(thing, wide))?.state ?? "waiting",
    clear() {
      // A cleared world's paintings settle at once, so nothing waits on them.
      for (const p of paintings.values()) {
        p.done?.close();
        p.settle();
      }
      paintings = new Map();
    },
  };
}
