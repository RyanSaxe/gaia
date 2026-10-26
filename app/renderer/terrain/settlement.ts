// The world's buildings: one for each entity, file or definition that
// stands as a building, each the building Jev composed for it, standing on its
// own leveled pad, apart from the others. The bake thread finds the
// sites and levels the pads (`standWorld`); the settlement stands each
// building on its site, every standing building of a tile drawn together as
// one batch (`createPlantBatch`), a call per material for the whole tile. Their walls and features stop the walk and clear the
// grass, and each has a signboard at the end of its walk naming what it
// stands for.

import { type Blueprint, type BuildingPlan, type Built, Library, type Palette, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { structure } from "@gaia/kinds";
import { type PlantBatch, type SceneLight, createPlantBatch } from "@gaia/render";
import { type BuildingSite, type Capsule, type Extent, extentOf, turningExtent } from "@gaia/terrain";
import type * as THREE from "three";
import { type BuildAsk, made } from "./made.ts";
import type { BuildingOf, Represented } from "./represent.ts";
import { type StandBuilding, blockedBy, buildingClearings, needsBank, signOf, standOf } from "./stand.ts";

export interface Building {
  readonly entity: BuildingOf;
  readonly represented: Represented;
  /** The building's own name, such as "Watermill". */
  readonly kindName: string;
  /** Its tile's batch and its place in it while its tile stands (`Settlement.stand`); null while it lies far off. */
  standing: { readonly batch: PlantBatch; readonly member: number } | null;
  /** The triangles its build draws. */
  readonly triangles: number;
  /** Its height and the horizontal radius of its bounds, meters, whether or not it stands. */
  readonly height: number;
  readonly radius: number;
  /** What builds it again when its tile comes near. */
  readonly ask: BuildAsk;
  /** The vitality it shows, kept while it stands far off. */
  vitality: number;
  /** The blueprint it was built from and the colors it was given, which its mark on the map is drawn from. */
  readonly blueprint: Blueprint;
  readonly palette: Palette;
  readonly plan: BuildingPlan;
  /** What stands beside the house, such as a mill wheel, in the house's frame. */
  readonly beside: Extent | null;
  /** Where its feature turns, such as a mill's wheel, in the house's frame. */
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
  requests(): StandBuilding[];
  /** Stands each building on the site a bake found for it, in order. */
  seat(sites: readonly BuildingSite[]): void;
  /** True where a wall or a feature stands, within `margin` meters. */
  blocked(x: number, z: number, margin: number): boolean;
  /** Ground under every building and along every walk, where grass does not grow. */
  clearings(): Capsule[];
  /** Where a building's signboard stands, facing anyone coming up its walk. */
  signOf(b: Building): Spot;
  /** Where a person stops to read the sign and look at the building. */
  standOf(b: Building): { x: number; z: number };
  /** The batches of the buildings that stand now, one per tile. */
  views(): PlantBatch[];
  /**
   * Stands exactly `held` into `scene`, each tile's (`tileOf`) together as one batch: builds the batch of a tile
   * whose buildings changed, from the builds made for them ahead (`makeAhead`) or else in place, and lets go of the
   * batches of tiles no longer held.
   */
  stand(held: readonly Building[], scene: THREE.Object3D, tileOf: (b: Building) => string): void;
  /** The standing building a ray hits first, and how far along it. */
  pick(raycaster: THREE.Raycaster): { readonly building: Building; readonly distance: number } | undefined;
  /** Sets a building's vitality, standing or not. */
  setVitality(b: Building, v: number): void;
}

const lib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);

/** A part's primitive in words: `timber-frame@1` is "timber frame". */
const wordsOf = (id: string): string => id.replace(/@\d+$/, "").replace(/-/g, " ");

/**
 * What a composed thing is called, from the parts Jev chose: a building by its walls and its feature ("Fieldstone
 * house with a tower"), a landmark by its form ("Lookout tower").
 */
export function composedName(bp: Blueprint): string {
  const named = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
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

/** A building for each thing a world stands as a building, each the building Jev composed for it. */
export function createSettlement(light: SceneLight, entities: readonly BuildingOf[]): Settlement {
  const asks = settlementBuilds(entities);
  const buildings: Building[] = entities.map((entity, i) => {
    const ask = asks[i] as BuildAsk;
    const built = made(ask, lib);
    const represented = entity.represented;
    // Its bounds as a plant's own meshes measure them: the height of its parts, and how far they reach from its middle.
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
      standing: null,
      triangles: built.parts.reduce((n, p) => n + p.indices.length / 3, 0),
      height,
      radius,
      ask,
      vitality: represented.vitality,
      blueprint: entity.blueprint,
      palette: built.palette,
      plan: built.slots.get("footprint")?.output as BuildingPlan,
      beside: extentOf(built.slots.get("feature")?.output as Built | undefined),
      wheel: turningExtent(built.slots.get("feature")?.output as Built | undefined),
      byWater: needsBank(entity.blueprint, lib),
      site: { x: 0, z: 0, yaw: 0, level: 0 },
    };
  });

  /** Each standing tile's batch and its buildings, in the batch's order. */
  const batches = new Map<string, { readonly members: readonly Building[]; readonly batch: PlantBatch }>();
  const atSite = (b: Building) => ({ x: b.site.x, y: b.site.level, z: b.site.z, yaw: b.site.yaw });
  return {
    buildings,
    requests: () => buildings.map((b) => ({ name: b.represented.name, plan: b.plan, beside: b.beside, ...(b.byWater ? { wheel: b.wheel } : {}) })),
    seat(sites) {
      buildings.forEach((b, i) => {
        b.site = sites[i] ?? b.site;
        if (b.standing !== null) b.standing.batch.move(b.standing.member, atSite(b));
      });
    },
    blocked: (x, z, margin) => buildings.some((b) => blockedBy(b, b.site, x, z, margin)),
    clearings: () => buildings.flatMap((b) => buildingClearings(b, b.site)),
    signOf: (b) => signOf(b.plan, b.site),
    standOf: (b) => standOf(b.plan, b.site),
    views: () => [...batches.values()].map((t) => t.batch),
    stand(held, scene, tileOf) {
      const want = new Map<string, Building[]>();
      for (const b of held) want.set(tileOf(b), [...(want.get(tileOf(b)) ?? []), b]);
      // A tile no longer held, or whose buildings changed, lets its batch go.
      for (const [key, tile] of [...batches]) {
        const next = want.get(key);
        if (next !== undefined && next.length === tile.members.length && next.every((b) => tile.members.includes(b))) continue;
        tile.batch.dispose();
        for (const b of tile.members) b.standing = null;
        batches.delete(key);
      }
      for (const [key, members] of want) {
        if (batches.has(key)) continue;
        const batch = createPlantBatch(members.map((b) => ({ plant: made(b.ask, lib), ...atSite(b), vitality: b.vitality })), light);
        members.forEach((b, member) => (b.standing = { batch, member }));
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
      b.standing?.batch.setVitality(b.standing.member, v);
    },
  };
}
