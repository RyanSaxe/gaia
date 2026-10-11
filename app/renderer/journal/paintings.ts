// The journal's paintings. A thing's page pictures the world's own view of
// it (`WorldHandle.view`), painted on the painter's own thread. A page is
// painted the first time it is opened: until then its left-hand page is bare
// paper, and the painting is laid on it stroke by stroke as the painter works,
// coarse to fine, so a page is never seen to change all at once. A painting
// is kept for as long as the world stands, and the pages ahead of the one
// open are painted next, so turning on rarely finds bare paper.

import type { Pixels } from "../terrain/capture.ts";
import type { PainterJob, PainterReply } from "./painter-worker.ts";
import PainterWorker from "./painter-worker.ts?worker";

/** The view taken of a thing, pixels: half the painting's size, as fine as its finest strokes need. */
const VIEW = { w: 520, h: 660 } as const;
/** The painting, device pixels: two to each of a page's pixels. */
const PAINTED = { w: 1040, h: 1320 } as const;

export interface Paintings {
  /**
   * The painting of what `id` stands for, on a canvas of its own: as far as
   * it is painted, filling in as the painter works. Asking for one that
   * isn't painted yet paints it before anything else.
   */
  picture(id: string): HTMLCanvasElement;
  /** Paints these after anything asked for, in this order. */
  ahead(ids: readonly string[]): void;
  /** How far the painting of `id` is: not begun, under way, done, or nothing stands for it. */
  state(id: string): "waiting" | "painting" | "done" | "none";
  /** Forgets every painting, for a world that changed. */
  clear(): void;
}

interface Painting {
  state: "waiting" | "painting" | "done" | "none";
  /** The painting so far. */
  so: ImageBitmap | null;
  /** The canvases showing it, until it is done. */
  readonly shown: Set<HTMLCanvasElement>;
}

/** A painting's seed: the same thing is always painted with the same strokes. */
const seedOf = (id: string): number => [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

export function createPaintings(view: (id: string, w: number, h: number) => Promise<{ readonly color: Pixels; readonly mask: Pixels } | null>): Paintings {
  const paintings = new Map<string, Painting>();
  const queue: string[] = [];
  let worker: Worker | null = null;
  let busy = false;
  let jobs = 0;
  /** The world each painting belongs to: a cleared world's late answers are dropped. */
  let era = 0;

  const show = (p: Painting, canvas: HTMLCanvasElement): void => {
    if (p.so === null) return;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(p.so, 0, 0);
  };
  const lay = (p: Painting, bitmap: ImageBitmap): void => {
    p.so?.close();
    p.so = bitmap;
    for (const c of p.shown) show(p, c);
  };
  const entry = (id: string): Painting => {
    let p = paintings.get(id);
    if (p === undefined) {
      p = { state: "waiting", so: null, shown: new Set() };
      paintings.set(id, p);
    }
    return p;
  };

  async function next(): Promise<void> {
    if (busy) return;
    const id = queue.shift();
    if (id === undefined) return;
    const p = entry(id);
    if (p.state !== "waiting") return void next();
    busy = true;
    p.state = "painting";
    const mine = era;
    try {
      const seen = await view(id, VIEW.w, VIEW.h);
      if (mine !== era) return;
      if (seen === null) {
        p.state = "none";
        return;
      }
      worker ??= new PainterWorker();
      const painter = worker;
      const job: PainterJob = { id: ++jobs, color: seen.color, mask: seen.mask, w: PAINTED.w, h: PAINTED.h, seed: seedOf(id) };
      await new Promise<void>((resolve) => {
        painter.onmessage = (e: MessageEvent<PainterReply>) => {
          const reply = e.data;
          if (reply.id !== job.id || mine !== era) {
            if ("partial" in reply) reply.partial.close();
            if ("painting" in reply) reply.painting.close();
            if (!("partial" in reply)) resolve();
            return;
          }
          if ("partial" in reply) lay(p, reply.partial);
          else {
            if ("painting" in reply) {
              lay(p, reply.painting);
              p.state = "done";
            } else p.state = "none";
            p.shown.clear();
            resolve();
          }
        };
        painter.postMessage(job, [job.color.data.buffer, job.mask.data.buffer]);
      });
    } catch {
      p.state = "none";
    } finally {
      busy = false;
      void next();
    }
  }

  return {
    picture(id) {
      const canvas = document.createElement("canvas");
      canvas.width = PAINTED.w;
      canvas.height = PAINTED.h;
      const p = entry(id);
      show(p, canvas);
      if (p.state === "waiting" || p.state === "painting") p.shown.add(canvas);
      if (p.state === "waiting") {
        const at = queue.indexOf(id);
        if (at >= 0) queue.splice(at, 1);
        queue.unshift(id);
        void next();
      }
      return canvas;
    },
    ahead(ids) {
      for (const id of ids) if (entry(id).state === "waiting" && !queue.includes(id)) queue.push(id);
      void next();
    },
    state: (id) => paintings.get(id)?.state ?? "waiting",
    clear() {
      era++;
      queue.length = 0;
      for (const p of paintings.values()) p.so?.close();
      paintings.clear();
    },
  };
}
