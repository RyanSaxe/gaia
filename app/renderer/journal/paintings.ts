// Paints the journal's pictures from the world's view of each thing
// (`WorldHandle.view`) on painter workers. The book shows a page only after
// its painting is done (`painted`), so paintings are made ahead: the
// title page first, then the pages around the open one, then the things near a
// person who is not walking. `PaintingStore` keeps them between visits, and a
// change of vitality repaints a thing (`repaint`).

import type { Pixels } from "../terrain/capture.ts";
import type { PainterJob, PainterReply } from "./painter-worker.ts";
import PainterWorker from "./painter-worker.ts?worker";
import type { PaintingStore } from "./painting-store.ts";

/** The size in pixels of the view captured of a thing: half the painting's size, fine enough for its finest strokes. */
const VIEW = { w: 520, h: 660 } as const;
/** The painting's size in device pixels, two per page pixel. */
const PAINTED = { w: 1040, h: 1320 } as const;
/** How many ms to wait before checking again for near things to paint while the person walks. */
const IDLE_CHECK = 400;
/** The minimum ms between views captured of things near the person, since each renders the world once more in a frame. */
const NEAR_EVERY = 3000;

export interface PaintingsOptions {
  /** Captures the world's view of a thing, wide for the title page with `wide`, or null when no thing in the world matches `id`. */
  view(id: string, w: number, h: number, wide?: boolean): Promise<{ readonly color: Pixels; readonly mask: Pixels } | null>;
  /** Where paintings are kept between visits. */
  store?: PaintingStore;
  /** A painting's key in the store, from its world, its thing and the thing's form and vitality. Null skips the store. */
  keyOf?(id: string, wide: boolean): string | null;
  /** Whether things near the person may be painted now. False while they walk. */
  idle?(): boolean;
}

export interface Paintings {
  /**
   * Returns a new canvas with the painting for `id`. The book shows it only
   * after `painted` resolves, so it is complete when seen. `wide` paints the
   * thing small in its land, as on the title page.
   */
  picture(id: string, wide?: boolean): HTMLCanvasElement;
  /** Resolves once `id` is painted, or found to have nothing to paint. Moves it to the front of the queue. */
  painted(id: string, wide?: boolean): Promise<void>;
  /** Queues these next, ahead of the reader. */
  ahead(ids: readonly string[], wide?: boolean): void;
  /** Queues the things nearest the person, painted only when nothing else waits and the person is not walking. */
  near(ids: readonly string[]): void;
  /**
   * Repaints things whose look changed in place, such as their vitality, when the person is not walking. Each shows
   * its old painting until the new one is done, so no page waits or goes blank. A thing not yet painted is skipped,
   * since its first painting will show its current look.
   */
  repaint(ids: readonly string[]): void;
  /** The painting state of `id`: waiting, painting, done, or none when no thing matches it. */
  state(id: string, wide?: boolean): "waiting" | "painting" | "done" | "none";
  /** Drops every painting when the world changes. */
  clear(): void;
}

/**
 * Paints `seen` at `w` by `h` device pixels on a new painter worker, with the same strokes for the same `seed`. Returns
 * the painting encoded for storage (WebP), or null when it could not be painted.
 */
export async function paintKept(seen: { readonly color: Pixels; readonly mask: Pixels }, w: number, h: number, seed: string): Promise<Blob | null> {
  const worker = new PainterWorker();
  try {
    const job: PainterJob = { id: 1, color: seen.color, mask: seen.mask, w, h, seed: seedOf(seed) };
    const reply = await new Promise<PainterReply>((resolve) => {
      worker.onmessage = (e: MessageEvent<PainterReply>) => resolve(e.data);
      worker.postMessage(job, [job.color.data.buffer, job.mask.data.buffer]);
    });
    if (!("painting" in reply)) return null;
    reply.painting.close();
    return reply.kept;
  } finally {
    worker.terminate();
  }
}

/** A painting's priority: 0 for the book's request, 1 for ahead of the reader, 2 for near the person. */
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

/** The id prefix for a wide painting in the queue. */
const WIDE = "wide:";
const named = (thing: string, wide: boolean): string => (wide ? `${WIDE}${thing}` : thing);
/** A painting's seed from its id, so the same thing always gets the same strokes. */
const seedOf = (id: string): number => [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
/** How many painter workers run at once: a third of the CPU cores, from 1 to 3. */
const PAINTERS = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency ?? 4) / 3)));

export function createPaintings(options: PaintingsOptions): Paintings {
  let paintings = new Map<string, Painting>();
  const painters = Array.from({ length: PAINTERS }, () => ({ worker: null as Worker | null, busy: false }));
  let jobs = 0;
  /** Captures run one at a time, since each renders the world and two must never share a frame. */
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
    // A new painting replaces the old one. A repaint that produced nothing leaves the old one shown.
    if (bitmap !== null) {
      if (p.done !== bitmap) p.done?.close();
      p.done = bitmap;
    }
    p.state = p.done === null ? state : "done";
    if (bitmap !== null) for (const c of p.shown) (c.getContext("2d") as CanvasRenderingContext2D).drawImage(bitmap, 0, 0);
    p.shown.clear();
    p.settle();
  };

  /** The waiting painting with the best rank, in request order. A near thing waits while the person walks and until `NEAR_EVERY` has passed. */
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
      // A painting being redone shows its old painting until the new one is done.
      if (p.state === "waiting" || p.state === "painting") p.shown.add(canvas);
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
    repaint(things) {
      for (const id of things.flatMap((t) => [named(t, false), named(t, true)])) {
        const p = paintings.get(id);
        if (p?.state !== "done") continue;
        p.state = "waiting";
        p.rank = 2;
      }
      pump();
    },
    state: (thing, wide = false) => paintings.get(named(thing, wide))?.state ?? "waiting",
    clear() {
      // Resolves every cleared painting at once, so nothing waits on them.
      for (const p of paintings.values()) {
        p.done?.close();
        p.settle();
      }
      paintings = new Map();
    },
  };
}
