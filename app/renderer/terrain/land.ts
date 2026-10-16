// The land as the page holds it: a clipmap of the stood land around the
// person, as games hold their terrain. Level k holds every 2^k-th sample of
// the world's lattice in a window of `CLIP.size` of them a side, centered
// near the person on the world's own grid of 2^k spacings. The land workers
// bake each window in chunks from the world's plan alone (`land-chunks.ts`),
// so the page never holds the whole world's land: a world of any size holds
// the same seven windows.
//
// The ground texture draws from the same windows (`ground` is its data), and
// level 0, the land within a few hundred meters to the meter, is the page's
// `Terrain`: walking, the paths and everything placed near the person read
// it as they read a whole world's land. A read past it falls to the finest
// level that holds the point (`Lattice.beyond`). When the person walks a
// chunk from a level's middle, the workers bake the chunks its window moves
// onto, and the level moves once they all have come, so a window never shows
// half old and half new. Through a world's opening the bake's own finishing
// thread, which still holds the whole stood world, cuts the chunks
// asked of it at once (`LandWorld.whole`).

import { type Lattice, type ReliefReport, type Terrain, type WorldSpec, frameOf, heightAt, knowWildBase, worldOf, worldOfZ } from "@gaia/terrain";
import type { BakeJob, BakeReply } from "./bake-worker.ts";
import { CHUNK, type Chunk, type LandSource, chunkPastLand, emptyChunk, latticeIndex } from "./land-chunks.ts";
import BakeWorker from "./bake-worker.ts?worker";

/** The land's levels around the person. */
export const CLIP = {
  /** Samples per side of every level: a whole number of chunks. */
  size: 512,
  /** Levels: the ground's rings and the water's mirror reach the seventh, 64 spacings a sample. */
  levels: 7,
  /** How far, in its own samples, the person may move from a level's middle before it moves around them: one chunk. */
  recenter: CHUNK,
  /**
   * Layers past the levels where a painting of a far place has its own finest
   * levels made ready (`PageLand.aside`): 512 m at 1 m and 1 km at 2 m. The
   * person's levels are never drawn from them.
   */
  aside: 2,
} as const;

/** A world's land as the page takes it on: the source the workers bake from, and what only the whole world could measure. */
export interface LandWorld {
  readonly source: LandSource;
  readonly report: ReliefReport;
  readonly wildBase: number;
  /** The bake's finishing thread, which still holds the whole stood world and cuts the opening's chunks at once (`Baked.whole`). */
  readonly whole?: Worker;
}

/** How long the land keeps a bake's finishing thread after its world opens, ms: through the opening and a first jump. */
const KEEP_WHOLE_MS = 30_000;

export interface PageLand {
  /** The land near the person, to the meter: level 0's window as a `Terrain`. The same object for the page's life; its arrays change in place as the window moves. */
  readonly terrain: Terrain;
  /** Every level's height, water level, distance to the water and signed distance to a trail's edge, four floats a sample: the ground texture's data. */
  readonly ground: Float32Array;
  /** Every level's region, covers and trail places, sample for sample with `ground`, level after level, as a texture array holds them. */
  readonly region: Uint8Array;
  /** 1 where a sample's nearest water is a pond's (`nearPond`). */
  readonly nearPond: Uint8Array;
  readonly coverRegions: Uint8Array;
  readonly coverShares: Uint8Array;
  readonly trailPlaces: Float32Array;
  /** Each level's first sample, in its own grid units (world meters over the lattice's spacing times 2^k). */
  readonly origins: readonly { readonly x: number; readonly z: number }[];
  /** Takes on a world: bakes every level around (x, z), and resolves once all of them hold it. */
  open(world: LandWorld, x: number, z: number): Promise<void>;
  /** Called every frame the person moves: a level they have walked a chunk from moves around them. */
  follow(x: number, z: number): void;
  /** Moves every level around (x, z), as after a jump: resolves once all of them hold it. */
  around(x: number, z: number): Promise<void>;
  /**
   * The land a painting of a place far from the person needs, made ready to
   * one side while the levels go on following the person: each of the finest
   * levels whose window around (x, z) is not the person's own is baked into a
   * layer of its own (`CLIP.aside`).
   * Resolves with `paint`, which runs `draw` with those levels drawn from
   * their layers and points them back at the person's own before it returns,
   * so no frame drawn for the person ever shows them; null if another world
   * opened first.
   */
  aside(x: number, z: number): Promise<{ paint<T>(draw: () => T): T } | null>;
  /** Which layer each level is drawn from: its own, or a painting's set aside while that painting is drawn. */
  readonly layers: readonly number[];
  /** The land workers' report: jobs waiting on each, and how long each kind took lately. */
  workers(): { readonly waiting: readonly number[]; readonly whole: boolean; readonly took: Record<string, { readonly n: number; readonly mean: number; readonly max: number }> };
  /** Called with a level's index each time its window or layer changes, and whether that layer's data is new to the GPU. */
  onMoved: ((k: number, fresh: boolean) => void) | null;
}

const LAYER = CLIP.size * CLIP.size;

/** One level's samples, or a move's, row by row over its window. */
interface Level {
  readonly ground: Float32Array;
  readonly region: Uint8Array;
  readonly nearPond: Uint8Array;
  readonly coverRegions: Uint8Array;
  readonly coverShares: Uint8Array;
  readonly trailPlaces: Float32Array;
}

const levelOf = (): Level => ({
  ground: new Float32Array(LAYER * 4),
  region: new Uint8Array(LAYER),
  nearPond: new Uint8Array(LAYER),
  coverRegions: new Uint8Array(LAYER * 4),
  coverShares: new Uint8Array(LAYER * 4),
  trailPlaces: new Float32Array(LAYER * 2),
});

/** Level k's window around (x, z): its first sample, in its own grid units, on a step of a chunk. */
function windowAt(spacing: number, k: number, x: number, z: number): { x: number; z: number } {
  const unit = spacing * 2 ** k;
  const snap = (v: number): number => Math.round(v / unit / CLIP.recenter) * CLIP.recenter - CLIP.size / 2;
  return { x: snap(x), z: snap(z) };
}

/** Copies every array of one level into another's. */
function copyLevel(from: Level, to: Level): void {
  to.ground.set(from.ground);
  to.region.set(from.region);
  to.nearPond.set(from.nearPond);
  to.coverRegions.set(from.coverRegions);
  to.coverShares.set(from.coverShares);
  to.trailPlaces.set(from.trailPlaces);
}

/** Writes `chunk` into a level's arrays whose window starts at (ox, oz). */
function place(chunk: Chunk, ox: number, oz: number, into: Level): void {
  const x0 = chunk.cx * CHUNK - ox;
  const z0 = chunk.cz * CHUNK - oz;
  for (let j = 0; j < CHUNK; j++) {
    const from = j * CHUNK;
    const to = (z0 + j) * CLIP.size + x0;
    into.ground.set(chunk.ground.subarray(from * 4, (from + CHUNK) * 4), to * 4);
    into.region.set(chunk.region.subarray(from, from + CHUNK), to);
    into.nearPond.set(chunk.nearPond.subarray(from, from + CHUNK), to);
    into.coverRegions.set(chunk.coverRegions.subarray(from * 4, (from + CHUNK) * 4), to * 4);
    into.coverShares.set(chunk.coverShares.subarray(from * 4, (from + CHUNK) * 4), to * 4);
    into.trailPlaces.set(chunk.trailPlaces.subarray(from * 2, (from + CHUNK) * 2), to * 2);
  }
}

/** Copies chunk (cx, cz) from a level's arrays over window (fx, fz) into another's over window (tx, tz). */
function carry(cx: number, cz: number, from: Level, fx: number, fz: number, to: Level, tx: number, tz: number): void {
  for (let j = 0; j < CHUNK; j++) {
    const a = (cz * CHUNK - fz + j) * CLIP.size + cx * CHUNK - fx;
    const b = (cz * CHUNK - tz + j) * CLIP.size + cx * CHUNK - tx;
    to.ground.set(from.ground.subarray(a * 4, (a + CHUNK) * 4), b * 4);
    to.region.set(from.region.subarray(a, a + CHUNK), b);
    to.nearPond.set(from.nearPond.subarray(a, a + CHUNK), b);
    to.coverRegions.set(from.coverRegions.subarray(a * 4, (a + CHUNK) * 4), b * 4);
    to.coverShares.set(from.coverShares.subarray(a * 4, (a + CHUNK) * 4), b * 4);
    to.trailPlaces.set(from.trailPlaces.subarray(a * 2, (a + CHUNK) * 2), b * 2);
  }
}

/** A job given to a land worker, and who waits on its answer: null when the worker ended first and the job's world has since closed. */
interface Pending {
  readonly job: BakeJob & { readonly world: number };
  readonly answer: (reply: BakeReply | null) => void;
  /** How soon it is wanted: lower first (`JOB_PRIORITY`). */
  readonly priority: number;
  /** When it was sent, for the workers' report. */
  sent?: number;
}

/**
 * How soon each kind of job is wanted. The person's own land comes first, so
 * its windows keep up with them; then the land a painting sets aside, which
 * nobody sees until the painting is done.
 */
export const JOB_PRIORITY = { land: 0, aside: 1 } as const;
/** Jobs each worker holds at once: one under way and the next, so it never idles, and the rest wait their turn on the page. */
const IN_FLIGHT = 2;

/** A land worker and the jobs it has yet to answer. */
interface Thread {
  readonly worker: Worker;
  readonly jobs: Map<number, Pending>;
}

/**
 * A few workers that bake chunks of the land, each keeping the source of the
 * world it was last given. A worker that ends while it still has jobs, as
 * the kept finishing thread does when it is let go, or that dies, hands them
 * to the others, so nothing waits on an answer that will never come.
 */
function createLandWorkers(threads: number) {
  let nextId = 0;
  /** The world the workers hold the source of, and that source, for a worker that starts after it was given. */
  let kept: { readonly world: number; readonly source: LandSource } | null = null;
  /** How long each kind of job took lately, sent to answered, ms. */
  const took = new Map<string, number[]>();
  const listen = (worker: Worker): Thread => {
    const on: Thread = { worker, jobs: new Map() };
    worker.onmessage = (e: MessageEvent<BakeReply>) => {
      const pending = on.jobs.get(e.data.id);
      on.jobs.delete(e.data.id);
      if (pending?.sent !== undefined) took.set(pending.job.kind, [...(took.get(pending.job.kind) ?? []).slice(-39), performance.now() - pending.sent]);
      pending?.answer(e.data);
      pump();
    };
    worker.onerror = (e) => {
      e.preventDefault();
      replace(on);
    };
    return on;
  };
  const workers = Array.from({ length: threads }, () => listen(new BakeWorker()));
  /** A bake's finishing thread while it is kept: chunks of its world go to it first. */
  let whole: Thread | null = null;
  const send = (on: Thread, pending: Pending): void => {
    const id = nextId++;
    pending.sent = performance.now();
    on.jobs.set(id, pending);
    on.worker.postMessage({ ...pending.job, id });
  };
  /** Jobs no worker holds yet, taken soonest-wanted first and in the order asked within a priority. */
  const queue: Pending[] = [];
  /** Gives each thread with room the soonest-wanted jobs waiting: the finishing thread while it is kept, then the workers. */
  const pump = (): void => {
    for (const on of [...(whole === null ? [] : [whole]), ...workers]) {
      while (on.jobs.size < IN_FLIGHT && queue.length > 0) {
        let best = 0;
        for (let i = 1; i < queue.length; i++) if ((queue[i] as Pending).priority < (queue[best] as Pending).priority) best = i;
        send(on, queue.splice(best, 1)[0] as Pending);
      }
    }
  };
  const ask = (job: Pending["job"], priority: number): Promise<BakeReply | null> =>
    new Promise((answer) => {
      queue.push({ job, answer, priority });
      pump();
    });
  /** Ends a thread: what it had yet to answer goes to another while its world is still `open`, and is let go if not. */
  const end = (on: Thread, open: number | undefined): void => {
    on.worker.terminate();
    const jobs = [...on.jobs.values()];
    on.jobs.clear();
    for (const pending of jobs) {
      if (pending.job.world === open) queue.unshift(pending);
      else pending.answer(null);
    }
    pump();
  };
  /** A land worker that died is replaced by a fresh one given the kept world's source; a finishing thread that died is let go. */
  const replace = (on: Thread): void => {
    if (on === whole) whole = null;
    const i = workers.indexOf(on);
    if (i >= 0) {
      const fresh = listen(new BakeWorker());
      workers[i] = fresh;
      if (kept !== null) send(fresh, { job: { kind: "land", ...kept }, answer: () => undefined, priority: JOB_PRIORITY.land });
    }
    end(on, kept?.world);
  };
  return {
    async keep(world: number, source: LandSource): Promise<void> {
      kept = { world, source };
      await Promise.all([...workers, ...(whole === null ? [] : [whole])].map((on) => new Promise<BakeReply | null>((answer) => send(on, { job: { kind: "land", world, source }, answer, priority: JOB_PRIORITY.land }))));
    },
    /** Takes on a new world's finishing thread, ending the one kept before and letting go of what it had yet to answer. */
    adopt(worker: Worker): void {
      const was = whole;
      whole = listen(worker);
      if (was !== null) end(was, undefined);
    },
    /** The jobs each thread has yet to answer, and how long each kind took lately, for reports. */
    stats: () => ({
      waiting: [...workers.map((w) => w.jobs.size), ...(whole === null ? [] : [whole.jobs.size]), queue.length],
      whole: whole !== null,
      took: Object.fromEntries([...took].map(([k, v]) => [k, { n: v.length, mean: Math.round(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)), max: Math.round(Math.max(0, ...v)) }])),
    }),
    /** Ends the kept finishing thread, letting go of the whole world it holds; the land workers take on what it had yet to answer. */
    drop(): void {
      const was = whole;
      whole = null;
      if (was !== null) end(was, kept?.world);
    },
    /** Chunk (cx, cz) of level `k`, as soon as `priority` says; null when world `world` closed before a worker could answer. */
    async chunk(world: number, k: number, cx: number, cz: number, priority: number = JOB_PRIORITY.land): Promise<Chunk | null> {
      const reply = await ask({ kind: "chunk", world, k, cx, cz }, priority);
      if (reply === null) return null;
      if (reply.kind === "failed") throw new Error(reply.message);
      if (reply.kind !== "chunk") throw new Error(`A land worker answered a chunk with "${reply.kind}".`);
      return reply.chunk;
    },
  };
}

/** What the page's land reads as until its first world opens: level, dry ground. */
const PLACEHOLDER: WorldSpec = { size: 320, regions: [] };

/** The page's land, baked on `threads` workers of its own. */
export function createPageLand(threads = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 2))): PageLand {
  const { size, levels } = CLIP;
  const workers = createLandWorkers(threads);
  const all = {
    ground: new Float32Array(LAYER * 4 * (levels + CLIP.aside)),
    region: new Uint8Array(LAYER * (levels + CLIP.aside)),
    nearPond: new Uint8Array(LAYER * (levels + CLIP.aside)),
    coverRegions: new Uint8Array(LAYER * 4 * (levels + CLIP.aside)),
    coverShares: new Uint8Array(LAYER * 4 * (levels + CLIP.aside)),
    trailPlaces: new Float32Array(LAYER * 2 * (levels + CLIP.aside)),
  };
  /** Each layer's samples: the levels' own, then the layers set aside for paintings. */
  const layered: Level[] = Array.from({ length: levels + CLIP.aside }, (_, k) => ({
    ground: all.ground.subarray(k * LAYER * 4, (k + 1) * LAYER * 4),
    region: all.region.subarray(k * LAYER, (k + 1) * LAYER),
    nearPond: all.nearPond.subarray(k * LAYER, (k + 1) * LAYER),
    coverRegions: all.coverRegions.subarray(k * LAYER * 4, (k + 1) * LAYER * 4),
    coverShares: all.coverShares.subarray(k * LAYER * 4, (k + 1) * LAYER * 4),
    trailPlaces: all.trailPlaces.subarray(k * LAYER * 2, (k + 1) * LAYER * 2),
  }));
  /** Each level's samples as the land is read: its own layer, but for the moment a painting is drawn. */
  const store: Level[] = layered.slice(0, levels);
  const layers = Array.from({ length: levels }, (_, k) => k);
  /** Where each level's window starts; NaN until a world's land lies there. */
  const origins = Array.from({ length: levels }, () => ({ x: Number.NaN, z: Number.NaN }));
  /** Each level's move under way, if any: one at a time, and the next follows once it is in. */
  const moving: (Promise<void> | null)[] = Array.from({ length: levels }, () => null);
  /** Which world the levels hold: a chunk baked for an earlier one is dropped. */
  let generation = 0;
  let source: LandSource | null = null;
  /** Meters between the world lattice's samples. */
  let spacing = 1;
  let onMoved: ((k: number, fresh: boolean) => void) | null = null;
  /** When the kept finishing thread is let go. */
  let letGo: ReturnType<typeof setTimeout> | undefined;

  const level0 = store[0] as Level;
  const heights = new Float32Array(LAYER);
  const waterLevel = new Float32Array(LAYER);
  const shore = new Float32Array(LAYER);

  /** Level k at (gx, gz) in its own grid units, one of its four channels, between samples as the ground texture reads it. */
  const sampleLevel = (k: number, channel: number, gx: number, gz: number): number => {
    const data = (store[k] as Level).ground;
    const cx = Math.min(size - 1.000001, Math.max(0, gx));
    const cz = Math.min(size - 1.000001, Math.max(0, gz));
    const ix = Math.floor(cx);
    const iz = Math.floor(cz);
    const fx = cx - ix;
    const fz = cz - iz;
    const at = (i: number, j: number): number => data[((iz + j) * size + ix + i) * 4 + channel] as number;
    const h00 = at(0, 0);
    const h10 = at(1, 0);
    const h01 = at(0, 1);
    const h11 = at(1, 1);
    if (fx + fz <= 1) return h00 + fx * (h10 - h00) + fz * (h01 - h00);
    return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
  };
  const lattice: { -readonly [K in keyof Lattice]: Lattice[K] } = { n: size, spacing: 1, origin: 0, originZ: 0, heights };
  /** A read of level 0's window past its edge: from the finest coarser level that holds the point. */
  lattice.beyond = (x, z, values) => {
    const channel = values === heights ? 0 : values === waterLevel ? 1 : values === shore ? 2 : -1;
    // An array no level holds is read at the window's edge, as a lattice without `beyond` would read it.
    if (channel < 0) return heightAt({ n: size, spacing: lattice.spacing, origin: lattice.origin, originZ: lattice.originZ ?? lattice.origin, heights }, x, z, values);
    for (let k = 1; k < levels; k++) {
      const o = origins[k] as { x: number; z: number };
      const unit = spacing * 2 ** k;
      const gx = x / unit - o.x;
      const gz = z / unit - o.z;
      if ((gx >= 0 && gz >= 0 && gx <= size - 1 && gz <= size - 1) || k === levels - 1) return sampleLevel(k, channel, gx, gz);
    }
    return 0;
  };
  const view: { -readonly [K in keyof Terrain]: Terrain[K] } = {
    spec: PLACEHOLDER,
    lattice,
    waterLevel,
    shore,
    region: level0.region,
    nearPond: level0.nearPond,
    coverRegions: level0.coverRegions,
    coverShares: level0.coverShares,
    streams: [],
    ponds: [],
    fit: 1,
    mean: 0,
    pondDepths: [],
    report: { min: 0, max: 0, range: 0, maxSlope: 0, walkShare: 1, maxStep: 0 },
    landforms: [],
  };

  /** Level 0's window as the page's `Terrain`: its samples where the world's lattice holds them. */
  const showLevel0 = (): void => {
    const o = origins[0] as { x: number; z: number };
    const world = frameOf(view.spec);
    lattice.spacing = world.spacing;
    lattice.origin = worldOf(world, latticeIndex(world, 0, o.x));
    lattice.originZ = worldOfZ(world, latticeIndex(world, 0, o.z));
    const g = (store[0] as Level).ground;
    for (let i = 0; i < LAYER; i++) {
      heights[i] = g[i * 4] as number;
      waterLevel[i] = g[i * 4 + 1] as number;
      shore[i] = g[i * 4 + 2] as number;
    }
  };

  /**
   * Fills `into` with level `k`'s window at (ox, oz): the chunks the level's window now holds are carried over,
   * the rest baked. Resolves once all are in.
   */
  function fill(k: number, ox: number, oz: number, into: Level, mine: number, src: LandSource, priority: number = JOB_PRIORITY.land): Promise<void> {
    const from = store[k] as Level;
    const was = origins[k] as { x: number; z: number };
    const per = size / CHUNK;
    // Nearest the person first: the window's middle chunks.
    const order: [number, number][] = [];
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) order.push([i, j]);
    const middle = (c: [number, number]): number => Math.hypot(c[0] - per / 2 + 0.5, c[1] - per / 2 + 0.5);
    order.sort((a, b) => middle(a) - middle(b));
    const asks: Promise<void>[] = [];
    for (const [i, j] of order) {
      const cx = ox / CHUNK + i;
      const cz = oz / CHUNK + j;
      const held = cx * CHUNK >= was.x && cz * CHUNK >= was.z && cx * CHUNK + CHUNK <= was.x + size && cz * CHUNK + CHUNK <= was.z + size;
      if (held) carry(cx, cz, from, was.x, was.z, into, ox, oz);
      else if (chunkPastLand(src.plan, k, cx, cz)) place(emptyChunk(src.plan, k, cx, cz), ox, oz, into);
      else asks.push(workers.chunk(mine, k, cx, cz, priority).then((c) => (c !== null && mine === generation ? place(c, ox, oz, into) : undefined)));
    }
    return Promise.all(asks).then(() => undefined);
  }

  /** Moves level `k` to window (ox, oz): carries over the chunks both windows hold, bakes the rest, and takes over once all are in. */
  async function move(k: number, ox: number, oz: number): Promise<void> {
    const mine = generation;
    const src = source;
    if (src === null) return;
    const from = store[k] as Level;
    const was = origins[k] as { x: number; z: number };
    // A level holding nothing yet, as when a world opens, takes its chunks as they come: nothing draws it until
    // they all have. A level that is drawn takes its new window aside, and all at once.
    const fresh = Number.isNaN(was.x);
    const into = fresh ? from : levelOf();
    await fill(k, ox, oz, into, mine, src);
    if (mine !== generation) return;
    // The new window takes over whole, in one frame.
    if (!fresh) copyLevel(into, from);
    was.x = ox;
    was.z = oz;
    if (k === 0) showLevel0();
    onMoved?.(k, true);
  }

  /** Moves level `k` around (x, z) unless it is already there; after any move under way. Resolves once it holds (x, z). */
  function moveAround(k: number, x: number, z: number): Promise<void> {
    const going = moving[k];
    if (going !== null && going !== undefined) return going.then(() => moveAround(k, x, z));
    const at = windowAt(spacing, k, x, z);
    const o = origins[k] as { x: number; z: number };
    if (o.x === at.x && o.z === at.z) return Promise.resolve();
    const done = move(k, at.x, at.z).finally(() => {
      moving[k] = null;
    });
    moving[k] = done;
    return done;
  }

  return {
    terrain: view,
    ...all,
    origins,
    layers,
    get onMoved() {
      return onMoved;
    },
    set onMoved(fn) {
      onMoved = fn;
    },
    async open(next, x, z) {
      generation++;
      const mine = generation;
      source = next.source;
      const plan = next.source.plan;
      clearTimeout(letGo);
      if (next.whole === undefined) workers.drop();
      else {
        workers.adopt(next.whole);
        letGo = setTimeout(() => workers.drop(), KEEP_WHOLE_MS);
      }
      await workers.keep(mine, next.source);
      if (mine !== generation) return;
      view.spec = plan.spec;
      view.streams = plan.streams;
      view.ponds = plan.ponds.map((p) => p.pond);
      view.pondDepths = plan.ponds.map((p) => p.depth);
      view.fit = plan.fit;
      view.mean = plan.mean;
      view.report = next.report;
      view.landforms = plan.landforms;
      knowWildBase(view, next.wildBase);
      spacing = frameOf(plan.spec).spacing;
      // Nothing of the last world's land is carried into this one's.
      for (const o of origins) o.x = o.z = Number.NaN;
      await Promise.all(Array.from({ length: levels }, (_, k) => moveAround(k, x, z)));
    },
    follow(x, z) {
      if (source === null) return;
      for (let k = 0; k < levels; k++) if (moving[k] === null) void moveAround(k, x, z);
    },
    async around(x, z) {
      if (source === null) return;
      await Promise.all(Array.from({ length: levels }, (_, k) => moveAround(k, x, z)));
    },
    async aside(x, z) {
      const mine = generation;
      const src = source;
      if (src === null) return null;
      // Only the finest levels are set aside, into layers of their own: past them a painting's distance is drawn
      // from the person's own coarser levels, which hold it as well as the land they see.
      const apart: { k: number; ox: number; oz: number }[] = [];
      const fills: Promise<void>[] = [];
      for (let k = 0; k < CLIP.aside; k++) {
        const at = windowAt(spacing, k, x, z);
        const o = origins[k] as { x: number; z: number };
        if (o.x === at.x && o.z === at.z) continue;
        apart.push({ k, ox: at.x, oz: at.z });
        fills.push(fill(k, at.x, at.z, layered[levels + k] as Level, mine, src, JOB_PRIORITY.aside));
      }
      await Promise.all(fills);
      if (mine !== generation) return null;
      let fresh = true;
      return {
        paint(draw) {
          // Drawing from the set-aside layers and back takes one task, so no frame drawn for the person falls
          // between; their own layers are never touched, so nothing of theirs goes to the GPU again.
          const kept = apart.map(({ k, ox, oz }) => {
            const o = origins[k] as { x: number; z: number };
            const was = { x: o.x, z: o.z };
            o.x = ox;
            o.z = oz;
            store[k] = layered[levels + k] as Level;
            layers[k] = levels + k;
            if (k === 0) showLevel0();
            onMoved?.(k, fresh);
            return { k, was };
          });
          fresh = false;
          try {
            return draw();
          } finally {
            for (const { k, was } of kept) {
              const o = origins[k] as { x: number; z: number };
              o.x = was.x;
              o.z = was.z;
              store[k] = layered[k] as Level;
              layers[k] = k;
              if (k === 0) showLevel0();
              onMoved?.(k, false);
            }
          }
        },
      };
    },
    workers: () => workers.stats(),
  };
}
