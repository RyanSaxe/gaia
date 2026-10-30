// Places the world's buildings, one for each entity, file or definition that
// appears as a building, built from the blueprint Jev composed for it. The
// bake thread finds the sites and levels the pads (`placeWorld`), and each
// tile's buildings draw together as one batch (`createPlantBatch`), one call
// per material. Their walls and every solid piece they show block the walk,
// their steps carry it up to the door, their walls and features clear the grass,
// and each has a signboard at the end of its walk naming what it represents.

import { type Blueprint, type BuildingPlan, type Built, Library, type Palette, type Part, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { structure } from "@gaia/kinds";
import { type PlantBatch, type SceneLight, createPlantBatch } from "@gaia/render";
import { type BuildingSite, type Capsule, type Extent, type SolidShape, buildingPieces, extentOf, turningExtent } from "@gaia/terrain";
import type * as THREE from "three";
import { type BuildAsk, made } from "./made.ts";
import type { BuildingOf, Represented } from "./represent.ts";
import { type BuildingToPlace, blockedBy, buildingClearings, needsBank, signOf, readingSpotOf } from "./place.ts";

export interface Building {
  readonly entity: BuildingOf;
  readonly represented: Represented;
  /** The building's own name, such as "Watermill". */
  readonly kindName: string;
  /** Its tile's batch and its index in it while its tile is placed (`Settlement.stand`), or null while it is far off. */
  batchSlot: { readonly batch: PlantBatch; readonly member: number } | null;
  /** The triangles its build draws. */
  readonly triangles: number;
  /** Its height and the horizontal radius of its bounds in meters, whether or not it is placed. */
  readonly height: number;
  readonly radius: number;
  /** The build request that rebuilds it when its tile comes near. */
  readonly ask: BuildAsk;
  /** The vitality it shows, kept while it is far off. */
  vitality: number;
  /** The blueprint and colors it was built with, which the map draws its mark from. */
  readonly blueprint: Blueprint;
  readonly palette: Palette;
  readonly plan: BuildingPlan;
  /** What is beside the house, such as a mill wheel, in the house's frame. */
  readonly beside: Extent | null;
  /** The solid pieces it shows past its walls, in its own frame (`buildingPieces`). */
  readonly pieces: readonly SolidShape[];
  /** Its walkable parts, such as the steps up to its door, which a walker stands on. */
  readonly walkable: readonly Part[];
  /** The extent of its turning feature, such as a mill's wheel, in the house's frame. */
  readonly wheel: Extent | null;
  /** Whether its feature is turned by running water, as a waterwheel is. */
  readonly byWater: boolean;
  site: BuildingSite;
}

/** A point in the world, with the way a sign there faces. */
export interface Spot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export interface Settlement {
  readonly buildings: readonly Building[];
  /** What the bake thread needs to site each building, in order. */
  requests(): BuildingToPlace[];
  /** Places each building on the site a bake found for it, in order. */
  seat(sites: readonly BuildingSite[]): void;
  /** Whether a wall or a feature lies within `margin` meters of (x, z). */
  blocked(x: number, z: number, margin: number): boolean;
  /** Ground under every building and along every walk, where grass does not grow. */
  clearings(): Capsule[];
  /** Where a building's signboard goes, facing anyone coming up its walk. */
  signOf(b: Building): Spot;
  /** Where a person stops to read the sign and look at the building. */
  readingSpotOf(b: Building): { x: number; z: number };
  /** The batches of the placed buildings, one per tile. */
  views(): PlantBatch[];
  /**
   * Places exactly `held` into `scene`, each tile's buildings (`tileOf`) together as one batch. It rebuilds the batch
   * of a tile whose buildings changed, from the builds made ahead (`makeAhead`) or else in place, and drops the
   * batches of tiles no longer held.
   */
  place(held: readonly Building[], scene: THREE.Object3D, tileOf: (b: Building) => string): void;
  /** The placed building a ray hits first, and the distance along the ray. */
  pick(raycaster: THREE.Raycaster): { readonly building: Building; readonly distance: number } | undefined;
  /** Sets a building's vitality, whether or not it is placed. */
  setVitality(b: Building, v: number): void;
}

const lib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);

/** A part's primitive in words: `timber-frame@1` is "timber frame". */
const wordsOf = (id: string): string => id.replace(/@\d+$/, "").replace(/-/g, " ");

/**
 * What a composed thing is called, from the parts Jev chose: a building by its walls and its feature ("Fieldstone
 * house with a tower"), a tree or a bush by its frame and its crown ("Branching with leaf strands"), flowers by
 * their drift ("Daisies"), and a landmark or a stone by its form ("Lookout tower", "Boulder").
 */
export function composedName(bp: Blueprint): string {
  const named = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const frame = bp.slots.form?.use;
  const crown = bp.slots.crown?.use;
  if (frame !== undefined && crown !== undefined) return named(`${wordsOf(frame)} with ${wordsOf(crown)}`);
  const drift = bp.slots.drift?.use;
  if (drift !== undefined) return named(wordsOf(drift));
  const form = bp.slots.form?.use;
  if (form !== undefined) return named(wordsOf(form));
  const walls = bp.slots.body?.use;
  const feature = bp.slots.feature?.use;
  return named(`${walls === undefined ? "" : `${wordsOf(walls)} `}house${feature === undefined ? "" : ` with a ${wordsOf(feature)}`}`);
}

/** Each building, for making ahead. */
export const settlementBuilds = (entities: readonly BuildingOf[]): BuildAsk[] =>
  entities.map((entity) => ({
    kind: "structure",
    blueprint: entity.blueprint,
    seed: seedOf(`terrain-lab/${entity.facts.path}`),
    facts: Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(entity.facts)])),
  }));

/** Creates a building for each thing that appears as a building, from the blueprint Jev composed for it. */
export function createSettlement(light: SceneLight, entities: readonly BuildingOf[]): Settlement {
  const asks = settlementBuilds(entities);
  const buildings: Building[] = entities.map((entity, i) => {
    const ask = asks[i] as BuildAsk;
    const built = made(ask, lib);
    const represented = entity.represented;
    // Measure its bounds as a plant's own meshes do: the height of its parts and how far they reach from its center.
    let height = 0.3;
    let radius = 1;
    for (const p of built.parts) {
      for (let k = 0; k < p.positions.length; k += 3) {
        height = Math.max(height, p.positions[k + 1] as number);
        radius = Math.max(radius, Math.abs(p.positions[k] as number), Math.abs(p.positions[k + 2] as number));
      }
    }
    return {
      entity,
      represented,
      kindName: entity.kindName,
      batchSlot: null,
      triangles: built.parts.reduce((n, p) => n + p.indices.length / 3, 0),
      height,
      radius,
      ask,
      vitality: represented.vitality,
      blueprint: entity.blueprint,
      palette: built.palette,
      plan: built.slots.get("footprint")?.output as BuildingPlan,
      beside: extentOf(built.slots.get("feature")?.output as Built | undefined),
      pieces: buildingPieces(built.slots.get("footprint")?.output as BuildingPlan, built.parts),
      walkable: built.parts.filter((p) => p.collision === "walkable"),
      wheel: turningExtent(built.slots.get("feature")?.output as Built | undefined),
      byWater: needsBank(entity.blueprint, lib),
      site: { x: 0, z: 0, yaw: 0, level: 0 },
    };
  });

  /** Each placed tile's batch and its buildings, in the batch's order. */
  const batches = new Map<string, { readonly members: readonly Building[]; readonly batch: PlantBatch }>();
  const atSite = (b: Building) => ({ x: b.site.x, y: b.site.level, z: b.site.z, yaw: b.site.yaw });
  return {
    buildings,
    requests: () => buildings.map((b) => ({ name: b.represented.name, plan: b.plan, beside: b.beside, ...(b.byWater ? { wheel: b.wheel } : {}) })),
    seat(sites) {
      buildings.forEach((b, i) => {
        b.site = sites[i] ?? b.site;
        if (b.batchSlot !== null) b.batchSlot.batch.move(b.batchSlot.member, atSite(b));
      });
    },
    blocked: (x, z, margin) => buildings.some((b) => blockedBy(b, b.site, x, z, margin)),
    clearings: () => buildings.flatMap((b) => buildingClearings(b, b.site)),
    signOf: (b) => signOf(b.plan, b.site),
    readingSpotOf: (b) => readingSpotOf(b.plan, b.site),
    views: () => [...batches.values()].map((t) => t.batch),
    place(held, scene, tileOf) {
      const want = new Map<string, Building[]>();
      for (const b of held) want.set(tileOf(b), [...(want.get(tileOf(b)) ?? []), b]);
      // Drop the batch of a tile no longer held or whose buildings changed.
      for (const [key, tile] of [...batches]) {
        const next = want.get(key);
        if (next !== undefined && next.length === tile.members.length && next.every((b) => tile.members.includes(b))) continue;
        tile.batch.dispose();
        for (const b of tile.members) b.batchSlot = null;
        batches.delete(key);
      }
      for (const [key, members] of want) {
        if (batches.has(key)) continue;
        const batch = createPlantBatch(members.map((b) => ({ plant: made(b.ask, lib), ...atSite(b), vitality: b.vitality })), light);
        members.forEach((b, member) => (b.batchSlot = { batch, member }));
        scene.add(batch.object);
        batches.set(key, { members, batch });
      }
    },
    pick(raycaster) {
      let best: { building: Building; distance: number } | undefined;
      for (const { members, batch } of batches.values()) {
        const hit = batch.pick(raycaster);
        const building = hit === undefined ? undefined : members[hit.member];
        if (hit !== undefined && building !== undefined && (best === undefined || hit.distance < best.distance)) best = { building, distance: hit.distance };
      }
      return best;
    },
    setVitality(b, v) {
      b.vitality = v;
      b.batchSlot?.batch.setVitality(b.batchSlot.member, v);
    },
  };
}
