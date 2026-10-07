// Bakes worlds off the page's thread: a few workers compose bands of lattice
// rows side by side, then one of them finishes the bake, so drawing never
// waits on a bake. Bands go to whichever worker is free, so a band of costly
// landforms never holds the rest back.

import { type ComposedRows, type Terrain, type WorldSpec, latticeOf } from "@gaia/terrain";
import type { BakeJob, BakeReply, Stand, StandRequest } from "./bake-worker.ts";
import BakeWorker from "./bake-worker.ts?worker";

export interface Baker {
  /** Bakes a world on the workers and stands its things on it; bakes run one after another in the order asked. */
  bake(world: WorldSpec, stand: StandRequest): Promise<{ terrain: Terrain; stand: Stand }>;
}

/** Rows per band: small enough to spread over every worker, large enough that messages stay few. */
const BAND = 96;

export function createBaker(threads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 2))): Baker {
  const workers = Array.from({ length: threads }, () => new BakeWorker());
  const waiting = new Map<number, { resolve: (reply: BakeReply) => void }>();
  let nextId = 0;
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<BakeReply>) => {
      const job = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      job?.resolve(e.data);
    };
  }
  const ask = (worker: Worker, job: BakeJob, transfer: Transferable[] = []): Promise<BakeReply> =>
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, { resolve });
      worker.postMessage({ ...job, id }, transfer);
    });

  let queue: Promise<unknown> = Promise.resolve();
  async function run(world: WorldSpec, stand: StandRequest): Promise<{ terrain: Terrain; stand: Stand }> {
    const { n } = latticeOf(world);
    const bands: [number, number][] = [];
    for (let z = 0; z < n; z += BAND) bands.push([z, Math.min(n, z + BAND)]);
    const parts: ComposedRows[] = [];
    let next = 0;
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
    const moved = parts.flatMap((p) => [p.raw.buffer, p.region.buffer, p.coverRegions.buffer, p.coverShares.buffer]);
    const reply = await ask(workers[0] as Worker, { kind: "finish", world, parts, stand }, moved);
    if (reply.kind !== "finished") throw new Error(reply.kind === "failed" ? reply.message : "The bake finished without a terrain.");
    return { terrain: reply.terrain, stand: reply.stand };
  }
  return {
    bake(world, stand) {
      const done = queue.then(() => run(world, stand));
      queue = done.catch(() => undefined);
      return done;
    },
  };
}
