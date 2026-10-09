// The bake's own thread. A page runs a few of these: each composes bands of
// lattice rows, and one finishes the bake (fitting, water, shore) and stands
// the world's things on it (`standWorld`: the buildings' pads, the landmarks,
// the trails, the trees, the understory, the wild land's ring and the ground
// texture's data), while the others work out whose ground each sample of the
// land is (`ownershipRows`, which the ground's vitality reads), so the page
// keeps drawing every frame while a world bakes.
// They run the same pure functions a bake on the page would, so the result
// is byte-identical.

import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { type ComposedRows, type OwnedSite, type Terrain, type WorldSpec, composeRows, finishTerrain, landformsOf, ownershipRows } from "@gaia/terrain";
import { type Stand, type StandRequest, standWorld } from "./stand.ts";

export type BakeJob =
  | { readonly kind: "compose"; readonly world: WorldSpec; readonly z0: number; readonly z1: number }
  | { readonly kind: "finish"; readonly world: WorldSpec; readonly parts: readonly ComposedRows[]; readonly stand: StandRequest }
  | { readonly kind: "own"; readonly sites: readonly OwnedSite[]; readonly size: number; readonly grid: { readonly n: number; readonly origin: number; readonly spacing: number }; readonly k0: number; readonly k1: number };

export type BakeRequest = BakeJob & { readonly id: number };

export type BakeReply =
  | { readonly id: number; readonly kind: "composed"; readonly rows: ComposedRows }
  | { readonly id: number; readonly kind: "finished"; readonly terrain: Terrain; readonly stand: Stand }
  | { readonly id: number; readonly kind: "owned"; readonly k0: number; readonly owners: Uint16Array; readonly shares: Uint8Array }
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
    if (req.kind === "own") {
      const rows = ownershipRows(req.sites, req.size, req.grid, req.k0, req.k1);
      reply = { id: req.id, kind: "owned", k0: req.k0, ...rows };
      moved = [rows.owners.buffer, rows.shares.buffer];
    } else if (req.kind === "compose") {
      const rows = composeRows(req.world, landformsOf(req.world, lib), req.z0, req.z1);
      reply = { id: req.id, kind: "composed", rows };
      moved = [rows.raw.buffer, rows.region.buffer, rows.coverRegions.buffer, rows.coverShares.buffer];
    } else {
      const t = finishTerrain(req.world, landformsOf(req.world, lib), req.parts);
      const stood = standWorld(t, req.stand);
      reply = { id: req.id, kind: "finished", terrain: t, stand: stood };
      moved = [t.lattice.heights.buffer, t.waterLevel.buffer, t.shore.buffer, t.region.buffer, t.coverRegions.buffer, t.coverShares.buffer, stood.wilds.positions.buffer, stood.wilds.indices.buffer, stood.ground.buffer, stood.trailPlaces.buffer];
    }
  } catch (error) {
    reply = { id: req.id, kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
  scope.postMessage(reply, moved);
};
