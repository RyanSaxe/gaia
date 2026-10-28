// Bakes worlds off the main thread, so drawing never waits on a bake. A few
// workers compose bands of lattice rows, each taken by whichever worker is
// free, then one finishes the bake while the others compute each sample's
// ground owner. The page gets the world's plan and placements, never its whole
// land (`land.ts`). Each bake's workers end with it, because an idle worker
// keeps some 50 MB of a bake's leftovers until it happens to collect, and a
// phone cannot spare that.

import { type ComposedRows, GROUND_VITALITY, type Ownership, type ReliefReport, type WorldSpec, frameOf, ownershipGrid } from "@gaia/terrain";
import type { BakeJob, BakeReply } from "./bake-worker.ts";
import type { LandSource } from "./land-chunks.ts";
import { type Stand, type StandRequest, groundSites } from "./stand.ts";
import BakeWorker from "./bake-worker.ts?worker";

export interface Baked {
  /** The source the land workers bake the land around the person from. The whole world's land stays on the bake's thread. */
  readonly land: LandSource;
  /** The relief over the walkable square, and the wild land's base height, which only the whole world can measure. */
  readonly report: ReliefReport;
  readonly wildBase: number;
  readonly stand: Stand;
  /**
   * The bake's finishing thread, which still has the whole placed world. The
   * page's land adopts it to cut its first chunks at once, and ends it when
   * it no longer needs it.
   */
  readonly whole: Worker;
  /** The ground owner of every part of the land (`ownershipOf`). */
  readonly ownership: Ownership;
}

export interface Baker {
  /** Bakes a world on the workers and places its things on it. Bakes run one after another in request order. */
  bake(world: WorldSpec, stand: StandRequest): Promise<Baked>;
}

/** Rows per band: small enough to spread over every worker, large enough that messages stay few. */
const BAND = 96;

export function createBaker(threads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 2))): Baker {
  const waiting = new Map<number, { worker: Worker; resolve: (reply: BakeReply) => void }>();
  let nextId = 0;
  const spawn = (): Worker[] =>
    Array.from({ length: threads }, () => {
      const w = new BakeWorker();
      w.onmessage = (e: MessageEvent<BakeReply>) => {
        const job = waiting.get(e.data.id);
        waiting.delete(e.data.id);
        job?.resolve(e.data);
      };
      // A thread that dies, such as from running out of memory, fails its jobs, so the bake fails rather than waiting forever.
      w.onerror = (e) => {
        e.preventDefault();
        for (const [id, job] of waiting) {
          if (job.worker !== w) continue;
          waiting.delete(id);
          job.resolve({ id, kind: "failed", message: `A bake thread stopped: ${e.message}` });
        }
      };
      return w;
    });
  // The first bake's workers start with the page, so that bake begins at once.
  let started: Worker[] | null = spawn();
  const ask = (worker: Worker, job: BakeJob, transfer: Transferable[] = []): Promise<BakeReply> =>
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, { worker, resolve });
      worker.postMessage({ ...job, id }, transfer);
    });

  /** Computes the land's ground owners in bands of rows over `on`, every worker but the finishing one when there are others. */
  async function own(world: WorldSpec, stand: StandRequest, on: readonly Worker[]): Promise<Ownership> {
    const sites = groundSites(stand.code);
    const land = frameOf(world);
    const grid = ownershipGrid((land.n - 1) * land.spacing);
    const taps = GROUND_VITALITY.taps;
    const owners = new Uint16Array(grid.n * grid.n * taps);
    const shares = new Uint8Array(grid.n * grid.n * taps);
    const rows = Math.ceil(grid.n / on.length);
    await Promise.all(
      on.map(async (w, k) => {
        const k0 = Math.min(grid.n, k * rows);
        const k1 = Math.min(grid.n, k0 + rows);
        if (k1 <= k0) return;
        const reply = await ask(w, { kind: "own", sites, land: { size: world.size, ...(world.aspect === undefined ? {} : { aspect: world.aspect }) }, grid, k0, k1 });
        if (reply.kind === "failed") throw new Error(reply.message);
        if (reply.kind !== "owned") return;
        owners.set(reply.owners, reply.k0 * grid.n * taps);
        shares.set(reply.shares, reply.k0 * grid.n * taps);
      }),
    );
    return { ...grid, owners, shares };
  }

  let queue: Promise<unknown> = Promise.resolve();
  async function run(world: WorldSpec, stand: StandRequest): Promise<Baked> {
    const workers = started ?? spawn();
    started = null;
    let kept: Worker | null = null;
    try {
      const baked = await bakeOn(workers, world, stand);
      kept = baked.whole;
      // From here on, the page's land handles the finishing thread's messages.
      kept.onmessage = null;
      return baked;
    } finally {
      for (const w of workers) if (w !== kept) w.terminate();
    }
  }
  async function bakeOn(workers: readonly Worker[], world: WorldSpec, stand: StandRequest): Promise<Baked> {
    const { n } = frameOf(world);
    const bands: [number, number][] = [];
    for (let z = 0; z < n; z += BAND) bands.push([z, Math.min(n, z + BAND)]);
    const parts: ComposedRows[] = [];
    let next = 0;
    const t0 = performance.now();
    // Each worker takes the next band as soon as it finishes one.
    await Promise.all(
      workers.map(async (w) => {
        while (next < bands.length) {
          const [z0, z1] = bands[next++] as [number, number];
          const reply = await ask(w, { kind: "compose", world, z0, z1 });
          if (reply.kind === "failed") throw new Error(reply.message);
          if (reply.kind === "composed") parts.push(reply.rows);
        }
      }),
    );
    const composed = Math.round(performance.now() - t0);
    const moved = parts.flatMap((p) => [p.raw.buffer, p.region.buffer, p.coverRegions.buffer, p.coverShares.buffer]);
    const finisher = workers[0] as Worker;
    const [reply, ownership] = await Promise.all([ask(finisher, { kind: "finish", world, parts, stand }, moved), own(world, stand, workers.length > 1 ? workers.slice(1) : [finisher])]);
    if (reply.kind !== "finished") throw new Error(reply.kind === "failed" ? reply.message : "The bake finished without a terrain.");
    return { land: reply.land, report: reply.report, wildBase: reply.wildBase, stand: { ...reply.stand, took: { compose: composed, ...reply.stand.took, finished: Math.round(performance.now() - t0) } }, whole: finisher, ownership };
  }
  return {
    bake(world, stand) {
      const done = queue.then(() => run(world, stand));
      // The queue waits on the bake but keeps no reference to its result, so
      // the world alone decides when to drop a bake's stand and terrain.
      queue = done.then(
        () => undefined,
        () => undefined,
      );
      return done;
    },
  };
}
