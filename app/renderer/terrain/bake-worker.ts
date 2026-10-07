// The bake's own thread. A page runs a few of these: each composes bands of
// lattice rows, and one finishes the bake (fitting, water, shore) and stands
// the world's things on it (the cottage's pad, the trees, the understory, the
// wild land's ring), so the page keeps drawing every frame while a world
// bakes. They run the same pure functions `bakeTerrain` and the scatters run,
// so the result is byte-identical to baking on the page.

import { type BuildingPlan, Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import {
  type BuildingSite,
  type ComposedRows,
  type Occupied,
  type Placement,
  type ScatterRule,
  type Terrain,
  type WildsRing,
  type WorldSpec,
  clearingsOf,
  composeRows,
  findSite,
  finishTerrain,
  groundedBase,
  insideFootprint,
  landformsOf,
  levelPad,
  scatterComponents,
  scatterPlants,
  wildsRing,
} from "@gaia/terrain";

/** What to stand on a finished bake. */
export interface StandRequest {
  /** The cottage: sited and its pad leveled into the ground before anything else stands. */
  readonly plan: BuildingPlan;
  /** How many trees, the scatter's seed, and each kind's trunk radius; tree i is kind i modulo the kinds. */
  readonly trees: { readonly count: number; readonly seed: number; readonly trunks: readonly number[] };
  readonly understory: { readonly rules: readonly ScatterRule[]; readonly seed: number };
}

export interface Tree {
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What stands on a finished bake. */
export interface Stand {
  readonly site: BuildingSite;
  readonly trees: readonly Tree[];
  /** What the trees and the cottage's ground hold, which the understory kept clear of. */
  readonly occupied: readonly Occupied[];
  readonly placements: readonly Placement[];
  readonly wilds: WildsRing;
  /** Height, water level and distance to the water per lattice sample, four floats each: the ground texture's data. */
  readonly ground: Float32Array;
}

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

function stand(t: Terrain, req: StandRequest): Stand {
  const site = findSite(t, req.plan);
  levelPad(t, req.plan, site);
  const kinds = req.trees.trunks.length;
  const trees = scatterPlants(t, req.trees.count, req.trees.seed).flatMap((s, i) => {
    if (insideFootprint(req.plan, site, s.x, s.z, 6)) return [];
    const kind = i % kinds;
    return [{ kind, x: s.x, y: groundedBase(t.lattice, s.x, s.z, req.trees.trunks[kind] as number), z: s.z }];
  });
  // Nothing of the understory stands in the cottage or on its walk: discs a meter apart along each cleared capsule.
  const cottage = clearingsOf(req.plan, site).flatMap((c) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(c.bx - c.ax, c.bz - c.az)));
    return Array.from({ length: steps + 1 }, (_, k) => ({ x: c.ax + ((c.bx - c.ax) * k) / steps, z: c.az + ((c.bz - c.az) * k) / steps, radius: c.radius + 0.5 }));
  });
  const occupied = [...trees.map((tr) => ({ x: tr.x, z: tr.z, radius: 1.6 })), ...cottage];
  const placements = scatterComponents(t, req.understory.rules, req.understory.seed, occupied);
  const count = t.lattice.n * t.lattice.n;
  const ground = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    ground[i * 4] = t.lattice.heights[i] as number;
    ground[i * 4 + 1] = t.waterLevel[i] as number;
    ground[i * 4 + 2] = t.shore[i] as number;
  }
  return { site, trees, occupied, placements, wilds: wildsRing(t), ground };
}

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
      const stood = stand(t, req.stand);
      reply = { id: req.id, kind: "finished", terrain: t, stand: stood };
      moved = [t.lattice.heights.buffer, t.waterLevel.buffer, t.shore.buffer, t.region.buffer, t.coverRegions.buffer, t.coverShares.buffer, stood.wilds.positions.buffer, stood.wilds.indices.buffer, stood.ground.buffer];
    }
  } catch (error) {
    reply = { id: req.id, kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
  scope.postMessage(reply, moved);
};
