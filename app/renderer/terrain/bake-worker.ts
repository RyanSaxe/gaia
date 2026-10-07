// The bake's own thread. A page runs a few of these: each composes bands of
// lattice rows, and one finishes the bake (fitting, water, shore) and stands
// the world's things on it (`standWorld`: the buildings' pads, the landmarks,
// the trails, the trees, the understory, the wild land's ring and the ground
// texture's data), so the page keeps drawing every frame while a world bakes.
// They run the same pure functions a bake on the page would, so the result
// is byte-identical.

import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { type ComposedRows, type Terrain, type WorldSpec, composeRows, finishTerrain, landformsOf } from "@gaia/terrain";
import { type Stand, type StandRequest, standWorld } from "./stand.ts";

export type BakeJob =
  | { readonly kind: "compose"; readonly world: WorldSpec; readonly z0: number; readonly z1: number }
  | { readonly kind: "finish"; readonly world: WorldSpec; readonly parts: readonly ComposedRows[]; readonly stand: StandRequest };

export type BakeRequest = BakeJob & { readonly id: number };

export type BakeReply =
  | { readonly id: number; readonly kind: "composed"; readonly rows: ComposedRows }
  | { readonly id: number; readonly kind: "finished"; readonly terrain: Terrain; readonly stand: Stand }
  | { readonly id: number; readonly kind: "failed"; readonly message: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<BakeRequest>) => void) | null;
  postMessage(message: BakeReply, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
// The same library the terrain lab bakes with.
const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);

scope.onmessage = (e) => {
  const req = e.data;
  let reply: BakeReply;
  let moved: Transferable[] = [];
  try {
    const landforms = landformsOf(req.world, lib);
    if (req.kind === "compose") {
      const rows = composeRows(req.world, landforms, req.z0, req.z1);
      reply = { id: req.id, kind: "composed", rows };
      moved = [rows.raw.buffer, rows.region.buffer, rows.coverRegions.buffer, rows.coverShares.buffer];
    } else {
      const t = finishTerrain(req.world, landforms, req.parts);
      const stood = standWorld(t, req.stand);
      reply = { id: req.id, kind: "finished", terrain: t, stand: stood };
      moved = [t.lattice.heights.buffer, t.waterLevel.buffer, t.shore.buffer, t.region.buffer, t.coverRegions.buffer, t.coverShares.buffer, stood.wilds.positions.buffer, stood.wilds.indices.buffer, stood.ground.buffer];
    }
  } catch (error) {
    reply = { id: req.id, kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
  scope.postMessage(reply, moved);
};
