// The bake's own thread. A page runs a few of these: each composes bands of
// lattice rows, and one finishes the bake (fitting, water, shore) and stands
// the world's things on it (`standWorld`: the buildings' pads, the landmarks,
// the trails, the trees, what stands for code and the wild land's ring), while the
// others work out whose ground each sample of the land is (`ownershipRows`,
// which the ground's vitality reads), so the page keeps drawing every frame
// while a world bakes. The whole world's land stays here: the page takes its
// plan and what standing did to it, and the land workers (the same thread,
// asked for chunks) bake the land around the person from those alone.
// They run the same pure functions a bake on the page would, so the result
// is byte-identical.

import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { type ComposedRows, type LandOutline, type OwnedSite, type ReliefReport, type Terrain, type WorldSpec, composeRows, finishTerrain, landformsOf, ownershipRows, planOf, wildBase } from "@gaia/terrain";
import { type Chunk, type LandSource, chunkBuffers, cutChunk, standChunk } from "./land-chunks.ts";
import { type Stand, type StandRequest, standWorld } from "./stand.ts";

export type BakeJob =
  | { readonly kind: "compose"; readonly world: WorldSpec; readonly z0: number; readonly z1: number }
  | { readonly kind: "finish"; readonly world: WorldSpec; readonly parts: readonly ComposedRows[]; readonly stand: StandRequest }
  | { readonly kind: "own"; readonly sites: readonly OwnedSite[]; readonly land: LandOutline; readonly grid: { readonly n: number; readonly origin: number; readonly spacing: number }; readonly k0: number; readonly k1: number }
  /** Keeps a world's land source, by the page's number for it, for the chunks asked of it after. */
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
 * job brings its own copy of the world, and the land caches what it reads
 * quickly by spec (`regionField`, which walks every region's sites over the
 * land): a copy found equal to the last is swapped for it, so a world's bands
 * build that once on each thread, not once a band.
 */
let lastWorld: { readonly json: string; readonly world: WorldSpec } | null = null;
const keptWorld = (world: WorldSpec): WorldSpec => {
  const json = JSON.stringify(world);
  if (lastWorld?.json === json) return lastWorld.world;
  lastWorld = { json, world };
  return world;
};
/** The land source of the world the page shows, by its number: only the newest is kept. */
let source: { readonly world: number; readonly source: LandSource } | null = null;
/**
 * The whole stood land this thread last finished. The page keeps the
 * finishing thread a while after a bake: the first chunks of the
 * world it opens are cut from this at once instead of baked again
 * (`cutChunk`), the same samples.
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
      // The wild base reads the stood land all around its rim, which only the whole world holds; the page cannot measure it.
      const base = wildBase(t);
      reply = { id: req.id, kind: "finished", land: { plan: planOf(t), edits: stood.edits, ways: stood.network.ways }, report: t.report, wildBase: base, stand: { ...stood, took: { finish: finished, ...stood.took } } };
    }
  } catch (error) {
    reply = { id: req.id, kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
  scope.postMessage(reply, moved);
};
