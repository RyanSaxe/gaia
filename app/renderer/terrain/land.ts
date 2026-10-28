// Keeps the page's land as a clipmap around the person, as games keep their
// terrain. Level k stores every 2^k-th lattice sample in a window `CLIP.size`
// samples wide near the person, and land workers bake each window in chunks
// from the world's plan alone (`land-chunks.ts`), so a world of any size uses
// the same seven windows.
//
// Level 0, the land within a few hundred meters at full resolution, is the
// page's `Terrain`, and a read past it falls back to the finest level that
// contains the point (`Lattice.beyond`). A level moves only once every chunk
// of its new window has arrived, so a window never shows half old and half
// new data.

import { type Lattice, type ReliefReport, type Terrain, type WorldSpec, frameOf, heightAt, knowWildBase, worldOf, worldOfZ } from "@gaia/terrain";
import type { BakeJob, BakeReply } from "./bake-worker.ts";
import { CHUNK, type Chunk, type LandSource, chunkPastLand, emptyChunk, latticeIndex } from "./land-chunks.ts";
import BakeWorker from "./bake-worker.ts?worker";

/** Clipmap level sizes. */
export const CLIP = {
  /** Samples per side of every level: a whole number of chunks. */
  size: 512,
  /** Level count. The ground's rings and the water's mirror reach the seventh level, at 64 spacings a sample. */
  levels: 7,
  /** How far in its own samples the person may move from a level's center before the level recenters: one chunk. */
  recenter: CHUNK,
  /**
   * Extra layers after the levels, where a painting of a far place gets its
   * own finest levels (`PageLand.aside`): 512 m at 1 m spacing and 1 km at
   * 2 m. The person's view never draws from them.
   */
  aside: 2,
} as const;

/** A world's land as the page receives it: the source the workers bake from, and the values only the whole world could measure. */
export interface LandWorld {
  readonly source: LandSource;
  readonly report: ReliefReport;
  readonly wildBase: number;
  /** The bake's finishing thread, which still has the whole placed world and cuts the opening's chunks at once (`Baked.whole`). */
  readonly whole?: Worker;
}

/** Milliseconds the land keeps a bake's finishing thread after its world opens, long enough for the opening and a first jump. */
const KEEP_WHOLE_MS = 30_000;

export interface PageLand {
  /** Level 0's window as a `Terrain`, the land near the person at full resolution. It is the same object for the page's life, and its arrays change in place as the window moves. */
  readonly terrain: Terrain;
  /** Every level's height, water level, distance to the water and signed distance to a trail's edge, four floats a sample: the ground texture's data. */
  readonly ground: Float32Array;
  /** Every level's region, covers and trail places, sample for sample with `ground` and level after level, as a texture array stores them. */
  readonly region: Uint8Array;
  /** 1 where a sample's nearest water is a pond (`nearPond`). */
  readonly nearPond: Uint8Array;
  readonly coverRegions: Uint8Array;
  readonly coverShares: Uint8Array;
  readonly trailPlaces: Float32Array;
  /** Each level's first sample, in its own grid units (world meters over the lattice's spacing times 2^k). */
  readonly origins: readonly { readonly x: number; readonly z: number }[];
  /** Opens a world: bakes every level around (x, z), and resolves once all of them contain it. */
  open(world: LandWorld, x: number, z: number): Promise<void>;
  /** Call every frame the person moves. A level whose center is a chunk away from them moves around them. */
  follow(x: number, z: number): void;
  /** Moves every level around (x, z), as after a jump. Resolves once all of them contain it. */
  around(x: number, z: number): Promise<void>;
  /**
   * Prepares the land a painting of a far place needs, while the levels keep
   * following the person. Each of the finest levels whose window around
   * (x, z) differs from the person's is baked into its own layer
   * (`CLIP.aside`). Resolves with `paint`, which runs `draw` with those
   * levels reading their aside layers and points them back at the person's
   * layers before it returns, so no frame drawn for the person shows them.
   * Resolves with null if another world opened first.
   */
  aside(x: number, z: number): Promise<{ paint<T>(draw: () => T): T } | null>;
  /** The layer each level reads: its own, or a painting's aside layer while that painting draws. */
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

/** Level k's window around (x, z): its first sample in its own grid units, snapped to a chunk step. */
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

/** A job given to a land worker, and the callback for its reply. The reply is null when the worker ended first and the job's world has since closed. */
interface Pending {
  readonly job: BakeJob & { readonly world: number };
  readonly answer: (reply: BakeReply | null) => void;
  /** Its priority, lower first (`JOB_PRIORITY`). */
  readonly priority: number;
  /** When it was sent, for the workers' report. */
  sent?: number;
}

/**
 * Priority of each kind of job. The person's own land comes first, so its
 * windows keep up with them. The land a painting sets aside comes next, since
 * nobody sees it until the painting is done.
 */
export const JOB_PRIORITY = { land: 0, aside: 1 } as const;
/** Jobs each worker has at once: one running and the next, so it never idles. The rest wait in the page's queue. */
const IN_FLIGHT = 2;

/** A land worker and the jobs it has yet to answer. */
interface Thread {
  readonly worker: Worker;
  readonly jobs: Map<number, Pending>;
}

/**
 * A few workers that bake chunks of the land, each keeping the source of the
 * world it was last given. When a worker ends or dies with jobs left, as the
 * kept finishing thread does when dropped, its jobs go to the others, so
 * nothing waits on a reply that will never come.
 */
function createLandWorkers(threads: number) {
  let nextId = 0;
  /** The world whose source the workers have, and that source, to give a worker that starts later. */
  let kept: { readonly world: number; readonly source: LandSource } | null = null;
  /** Recent milliseconds from send to reply for each kind of job. */
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
  /** A bake's finishing thread while it is kept. Chunks of its world go to it first. */
  let whole: Thread | null = null;
  const send = (on: Thread, pending: Pending): void => {
    const id = nextId++;
    pending.sent = performance.now();
    on.jobs.set(id, pending);
    on.worker.postMessage({ ...pending.job, id });
  };
  /** Jobs no worker has yet, taken by priority and in request order within a priority. */
  const queue: Pending[] = [];
  /** Gives each thread with room the highest-priority waiting jobs: the finishing thread while it is kept, then the workers. */
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
  /** Ends a thread. Its unanswered jobs return to the queue if their world is still `open`, and are answered with null if not. */
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
  /** Replaces a dead land worker with a fresh one given the kept world's source. A dead finishing thread is dropped. */
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
    /** Adopts a new world's finishing thread, ending the previous one and answering its unanswered jobs with null. */
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
    /** Ends the kept finishing thread, freeing the whole world it has. The land workers take its unanswered jobs. */
    drop(): void {
      const was = whole;
      whole = null;
      if (was !== null) end(was, kept?.world);
    },
    /** Chunk (cx, cz) of level `k`, at `priority`. Null when world `world` closed before a worker could answer. */
    async chunk(world: number, k: number, cx: number, cz: number, priority: number = JOB_PRIORITY.land): Promise<Chunk | null> {
      const reply = await ask({ kind: "chunk", world, k, cx, cz }, priority);
      if (reply === null) return null;
      if (reply.kind === "failed") throw new Error(reply.message);
      if (reply.kind !== "chunk") throw new Error(`A land worker answered a chunk with "${reply.kind}".`);
      return reply.chunk;
    },
  };
}

/** The page's land until its first world opens: level, dry ground. */
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
  /** Each level's samples as reads see them: its own layer, except while a painting draws. */
  const store: Level[] = layered.slice(0, levels);
  const layers = Array.from({ length: levels }, (_, k) => k);
  /** Where each level's window starts, or NaN until a world's land is there. */
  const origins = Array.from({ length: levels }, () => ({ x: Number.NaN, z: Number.NaN }));
  /** Each level's move in progress, if any. A level moves once at a time, and the next move starts after it finishes. */
  const moving: (Promise<void> | null)[] = Array.from({ length: levels }, () => null);
  /** The world the levels contain. A chunk baked for an earlier world is dropped. */
  let generation = 0;
  let source: LandSource | null = null;
  /** Meters between the world lattice's samples. */
  let spacing = 1;
  let onMoved: ((k: number, fresh: boolean) => void) | null = null;
  /** The timer that drops the kept finishing thread. */
  let letGo: ReturnType<typeof setTimeout> | undefined;

  const level0 = store[0] as Level;
  const heights = new Float32Array(LAYER);
  const waterLevel = new Float32Array(LAYER);
  const shore = new Float32Array(LAYER);

  /** Reads one of level k's four channels at (gx, gz) in its grid units, interpolating between samples as the ground texture does. */
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
  /** Reads past level 0's window from the finest coarser level that contains the point. */
  lattice.beyond = (x, z, values) => {
    const channel = values === heights ? 0 : values === waterLevel ? 1 : values === shore ? 2 : -1;
    // An array no level stores is read at the window's edge, as a lattice without `beyond` would read it.
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

  /** Copies level 0's window into the page's `Terrain` and aligns its lattice with the world's. */
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
   * Fills `into` with level `k`'s window at (ox, oz). It copies the chunks the current window already has and bakes
   * the rest. Resolves once all have arrived.
   */
  function fill(k: number, ox: number, oz: number, into: Level, mine: number, src: LandSource, priority: number = JOB_PRIORITY.land): Promise<void> {
    const from = store[k] as Level;
    const was = origins[k] as { x: number; z: number };
    const per = size / CHUNK;
    // Request the window's center chunks first, nearest the person.
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

  /** Moves level `k` to window (ox, oz). It copies the chunks both windows share, bakes the rest, and switches once all have arrived. */
  async function move(k: number, ox: number, oz: number): Promise<void> {
    const mine = generation;
    const src = source;
    if (src === null) return;
    const from = store[k] as Level;
    const was = origins[k] as { x: number; z: number };
    // An empty level, as when a world opens, takes its chunks as they arrive, since nothing draws it until all have.
    // A level in use fills its new window in a separate buffer and switches all at once.
    const fresh = Number.isNaN(was.x);
    const into = fresh ? from : levelOf();
    await fill(k, ox, oz, into, mine, src);
    if (mine !== generation) return;
    // Switch to the new window whole, in one frame.
    if (!fresh) copyLevel(into, from);
    was.x = ox;
    was.z = oz;
    if (k === 0) showLevel0();
    onMoved?.(k, true);
  }

  /** Moves level `k` around (x, z) unless it is already there, after any move in progress. Resolves once it contains (x, z). */
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
      // Carry nothing of the last world's land into this one.
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
      // Only the finest levels get aside layers. Past them, a painting's distance draws from the person's coarser
      // levels, which cover it along with the person's own land.
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
          // Switching to the aside layers and back happens within one task, so no frame drawn for the person falls
          // between. Their own layers are never touched, so none of their data uploads again.
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
