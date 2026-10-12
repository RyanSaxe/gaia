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
// half old and half new.

import { type Lattice, type Placement, type ReliefReport, type Terrain, type WorldSpec, frameOf, heightAt, knowWildBase, worldOf, worldOfZ } from "@gaia/terrain";
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
} as const;

/** A world's land as the page takes it on: the source the workers bake from, and what only the whole world could measure. */
export interface LandWorld {
  readonly source: LandSource;
  readonly report: ReliefReport;
  readonly wildBase: number;
}

export interface PageLand {
  /** The land near the person, to the meter: level 0's window as a `Terrain`. The same object for the page's life; its arrays change in place as the window moves. */
  readonly terrain: Terrain;
  /** Every level's height, water level, distance to the water and signed distance to a trail's edge, four floats a sample: the ground texture's data. */
  readonly ground: Float32Array;
  /** Every level's region, covers and trail places, sample for sample with `ground`, level after level, as a texture array holds them. */
  readonly region: Uint8Array;
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
  /** Tile (ti, tj)'s understory, stood on the workers from the open world's plan; null if another world has opened since. */
  things(ti: number, tj: number): Promise<readonly Placement[] | null>;
  /** Called with a level's index each time its window moves. */
  onMoved: ((k: number) => void) | null;
}

const LAYER = CLIP.size * CLIP.size;

/** One level's samples, or a move's, row by row over its window. */
interface Level {
  readonly ground: Float32Array;
  readonly region: Uint8Array;
  readonly coverRegions: Uint8Array;
  readonly coverShares: Uint8Array;
  readonly trailPlaces: Float32Array;
}

const levelOf = (): Level => ({
  ground: new Float32Array(LAYER * 4),
  region: new Uint8Array(LAYER),
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

/** Writes `chunk` into a level's arrays whose window starts at (ox, oz). */
function place(chunk: Chunk, ox: number, oz: number, into: Level): void {
  const x0 = chunk.cx * CHUNK - ox;
  const z0 = chunk.cz * CHUNK - oz;
  for (let j = 0; j < CHUNK; j++) {
    const from = j * CHUNK;
    const to = (z0 + j) * CLIP.size + x0;
    into.ground.set(chunk.ground.subarray(from * 4, (from + CHUNK) * 4), to * 4);
    into.region.set(chunk.region.subarray(from, from + CHUNK), to);
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
    to.coverRegions.set(from.coverRegions.subarray(a * 4, (a + CHUNK) * 4), b * 4);
    to.coverShares.set(from.coverShares.subarray(a * 4, (a + CHUNK) * 4), b * 4);
    to.trailPlaces.set(from.trailPlaces.subarray(a * 2, (a + CHUNK) * 2), b * 2);
  }
}

/** A few workers that bake chunks of the land, each keeping the source of the world it was last given. */
function createLandWorkers(threads: number) {
  const waiting = new Map<number, (reply: BakeReply) => void>();
  let nextId = 0;
  const workers = Array.from({ length: threads }, () => {
    const worker = new BakeWorker();
    worker.onmessage = (e: MessageEvent<BakeReply>) => {
      const done = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      done?.(e.data);
    };
    return { worker, busy: 0 };
  });
  const ask = (on: (typeof workers)[number], job: BakeJob): Promise<BakeReply> =>
    new Promise((resolve) => {
      const id = nextId++;
      on.busy++;
      waiting.set(id, (reply) => {
        on.busy--;
        resolve(reply);
      });
      on.worker.postMessage({ ...job, id });
    });
  return {
    async keep(world: number, source: LandSource): Promise<void> {
      await Promise.all(workers.map((w) => ask(w, { kind: "land", world, source })));
    },
    async chunk(world: number, k: number, cx: number, cz: number): Promise<Chunk> {
      const free = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
      const reply = await ask(free, { kind: "chunk", world, k, cx, cz });
      if (reply.kind === "failed") throw new Error(reply.message);
      if (reply.kind !== "chunk") throw new Error(`A land worker answered a chunk with "${reply.kind}".`);
      return reply.chunk;
    },
    async things(world: number, ti: number, tj: number): Promise<readonly Placement[]> {
      const free = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
      const reply = await ask(free, { kind: "things", world, ti, tj });
      if (reply.kind === "failed") throw new Error(reply.message);
      if (reply.kind !== "things") throw new Error(`A land worker answered a tile's things with "${reply.kind}".`);
      return reply.placements;
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
    ground: new Float32Array(LAYER * 4 * levels),
    region: new Uint8Array(LAYER * levels),
    coverRegions: new Uint8Array(LAYER * 4 * levels),
    coverShares: new Uint8Array(LAYER * 4 * levels),
    trailPlaces: new Float32Array(LAYER * 2 * levels),
  };
  const store: Level[] = Array.from({ length: levels }, (_, k) => ({
    ground: all.ground.subarray(k * LAYER * 4, (k + 1) * LAYER * 4),
    region: all.region.subarray(k * LAYER, (k + 1) * LAYER),
    coverRegions: all.coverRegions.subarray(k * LAYER * 4, (k + 1) * LAYER * 4),
    coverShares: all.coverShares.subarray(k * LAYER * 4, (k + 1) * LAYER * 4),
    trailPlaces: all.trailPlaces.subarray(k * LAYER * 2, (k + 1) * LAYER * 2),
  }));
  /** Where each level's window starts; NaN until a world's land lies there. */
  const origins = Array.from({ length: levels }, () => ({ x: Number.NaN, z: Number.NaN }));
  /** What each level's move bakes into before it takes over: one per level, kept from move to move. */
  const staging: (Level | null)[] = Array.from({ length: levels }, () => null);
  /** Each level's move under way, if any: one at a time, and the next follows once it is in. */
  const moving: (Promise<void> | null)[] = Array.from({ length: levels }, () => null);
  /** Which world the levels hold: a chunk baked for an earlier one is dropped. */
  let generation = 0;
  let source: LandSource | null = null;
  /** Meters between the world lattice's samples. */
  let spacing = 1;
  let onMoved: ((k: number) => void) | null = null;

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
    const g = level0.ground;
    for (let i = 0; i < LAYER; i++) {
      heights[i] = g[i * 4] as number;
      waterLevel[i] = g[i * 4 + 1] as number;
      shore[i] = g[i * 4 + 2] as number;
    }
  };

  /** Moves level `k` to window (ox, oz): carries over the chunks both windows hold, bakes the rest, and takes over once all are in. */
  async function move(k: number, ox: number, oz: number): Promise<void> {
    const mine = generation;
    const src = source;
    if (src === null) return;
    const into = (staging[k] ??= levelOf());
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
      else asks.push(workers.chunk(mine, k, cx, cz).then((c) => (mine === generation ? place(c, ox, oz, into) : undefined)));
    }
    await Promise.all(asks);
    if (mine !== generation) return;
    // The new window takes over whole, in one frame.
    from.ground.set(into.ground);
    from.region.set(into.region);
    from.coverRegions.set(into.coverRegions);
    from.coverShares.set(into.coverShares);
    from.trailPlaces.set(into.trailPlaces);
    was.x = ox;
    was.z = oz;
    if (k === 0) showLevel0();
    onMoved?.(k);
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
    async things(ti, tj) {
      const mine = generation;
      const placed = await workers.things(mine, ti, tj);
      return mine === generation ? placed : null;
    },
  };
}
