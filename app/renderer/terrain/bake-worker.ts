// The bake worker. The page runs a few: each composes bands of lattice rows,
// then one finishes the bake and places the world's things on it
// (`standWorld`) while the others compute each sample's ground owner
// (`ownershipRows`), so the page keeps drawing while a world bakes. The whole
// land stays on the worker, and the page's land workers, this same worker
// asked for chunks, bake the land around the person from the plan and the
// leveling edits alone. They run the same pure functions as a bake on the
// page, so the result is byte-identical.

import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { type ComposedRows, type LandOutline, type OwnedSite, type ReliefReport, type Terrain, type WorldSpec, composeRows, finishTerrain, landformsOf, ownershipRows, planOf, wildBase } from "@gaia/terrain";
import { type Chunk, type LandSource, chunkBuffers, cutChunk, standChunk } from "./land-chunks.ts";
import { type Stand, type StandRequest, standWorld } from "./stand.ts";

export type BakeJob =
  | { readonly kind: "compose"; readonly world: WorldSpec; readonly z0: number; readonly z1: number }
  | { readonly kind: "finish"; readonly world: WorldSpec; readonly parts: readonly ComposedRows[]; readonly stand: StandRequest }
  | { readonly kind: "own"; readonly sites: readonly OwnedSite[]; readonly land: LandOutline; readonly grid: { readonly n: number; readonly origin: number; readonly spacing: number }; readonly k0: number; readonly k1: number }
  /** Keeps a world's land source, by the page's number for that world, for later chunk requests. */
  | { readonly kind: "land"; readonly world: number; readonly source: LandSource }
  | { readonly kind: "chunk"; readonly world: number; readonly k: number; readonly cx: number; readonly cz: number };

export type BakeRequest = BakeJob & { readonly id: number };

export type BakeReply =
  | { readonly id: number; readonly kind: "composed"; readonly rows: ComposedRows }
  | { readonly id: number; readonly kind: "finished"; readonly land: LandSource; readonly report: ReliefReport; readonly wildBase: number; readonly stand: Stand }
  | { readonly id: number; readonly kind: "owned"; readonly k0: number; readonly owners: Uint16Array; readonly shares: Uint8Array }
  | { readonly id: number; readonly kind: "kept" }
  | { readonly id: number; readonly kind: "chunk"; readonly chunk: Chunk }
  | { readonly id: number; readonly kind: "failed"; readonly message: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<BakeRequest>) => void) | null;
  postMessage(message: BakeReply, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
// The same library the world bakes with.
const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
/**
 * The world this thread last composed or finished, and its spec as text. Each
 * job brings its own copy of the world, and the land caches data by spec
 * object (`regionField`, which walks every region's sites over the land). A
 * copy equal to the last is replaced by the last, so each thread builds that
 * cache once per world rather than once per band.
 */
let lastWorld: { readonly json: string; readonly world: WorldSpec } | null = null;
const keptWorld = (world: WorldSpec): WorldSpec => {
  const json = JSON.stringify(world);
  if (lastWorld?.json === json) return lastWorld.world;
  lastWorld = { json, world };
  return world;
};
/** The land source of the world the page shows, with its number. Only the newest is kept. */
let source: { readonly world: number; readonly source: LandSource } | null = null;
/**
 * The whole leveled land this thread last finished. The page keeps the
 * finishing thread a while after a bake and cuts the first chunks of the
 * opened world from this at once (`cutChunk`) instead of baking them again.
 * The samples are the same.
 */
let whole: Terrain | null = null;

scope.onmessage = (e) => {
  const req = e.data;
  let reply: BakeReply;
  let moved: Transferable[] = [];
  try {
    if (req.kind === "land") {
      source = { world: req.world, source: req.source };
      reply = { id: req.id, kind: "kept" };
    } else if (req.kind === "chunk") {
      if (source === null || source.world !== req.world) throw new Error(`No land source for world ${req.world}.`);
      const chunk = whole === null ? standChunk(source.source, req.k, req.cx, req.cz) : cutChunk(whole, source.source, req.k, req.cx, req.cz);
      reply = { id: req.id, kind: "chunk", chunk };
      moved = chunkBuffers(chunk);
    } else if (req.kind === "own") {
      const rows = ownershipRows(req.sites, req.land, req.grid, req.k0, req.k1);
      reply = { id: req.id, kind: "owned", k0: req.k0, ...rows };
      moved = [rows.owners.buffer, rows.shares.buffer];
    } else if (req.kind === "compose") {
      const world = keptWorld(req.world);
      const rows = composeRows(world, landformsOf(world, lib), req.z0, req.z1);
      reply = { id: req.id, kind: "composed", rows };
      moved = [rows.raw.buffer, rows.region.buffer, rows.coverRegions.buffer, rows.coverShares.buffer];
    } else {
      const world = keptWorld(req.world);
      const t0 = performance.now();
      const t = finishTerrain(world, landformsOf(world, lib), req.parts);
      const finished = Math.round(performance.now() - t0);
      const stood = standWorld(t, req.stand);
      whole = t;
      // The wild base reads the leveled land all around its rim. Only the whole world has that, so the page cannot measure it.
      const base = wildBase(t);
      reply = { id: req.id, kind: "finished", land: { plan: planOf(t), edits: stood.edits, ways: stood.network.ways }, report: t.report, wildBase: base, stand: { ...stood, took: { finish: finished, ...stood.took } } };
    }
  } catch (error) {
    reply = { id: req.id, kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
  scope.postMessage(reply, moved);
};
