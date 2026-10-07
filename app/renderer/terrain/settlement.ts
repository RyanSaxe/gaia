// The terrain lab's buildings: one for each sample entity, each the
// hand-filled building Jev might choose for it, standing near the stream on
// its own leveled pad, apart from the others. The bake thread finds the
// sites and levels the pads (`standWorld`); the settlement stands each
// building on its site. Their walls and features stop the walk and clear the
// grass, and each has a signboard at the end of its walk naming what it
// stands for.

import { type BuildingPlan, type Built, Library, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { structure } from "@gaia/kinds";
import { STRUCTURE_PRESETS, mergeParts, realize } from "@gaia/realize";
import { type PlantView, type SceneLight, createPlant } from "@gaia/render";
import type { BuildingSite, Capsule, Extent } from "@gaia/terrain";
import { type Represented, SAMPLE_ENTITIES, type SampleEntity, representEntity } from "./samples.ts";
import { type StandBuilding, blockedBy, buildingClearings, signOf, standOf } from "./stand.ts";

export interface Building {
  readonly entity: SampleEntity;
  readonly represented: Represented;
  /** The building's own name, such as "Watermill". */
  readonly kindName: string;
  readonly view: PlantView;
  readonly plan: BuildingPlan;
  /** What stands beside the house, such as a mill wheel, in the house's frame. */
  readonly beside: Extent | null;
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
  views(): PlantView[];
}

const lib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);

/** The reach of a feature's solid parts in the house's frame, or null when it has none. */
function extentOf(feature: Built | undefined): Extent | null {
  if (feature === undefined) return null;
  const box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const part of feature.parts) {
    if (part.collision !== "solid") continue;
    for (let i = 0; i < part.positions.length; i += 3) {
      const x = part.positions[i] as number;
      const z = part.positions[i + 2] as number;
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.z0 = Math.min(box.z0, z);
      box.z1 = Math.max(box.z1, z);
    }
  }
  return Number.isFinite(box.x0) ? box : null;
}

/** A building for each entity, each the building Jev chose for it: the sample entities unless a world names its own. */
export function createSettlement(light: SceneLight, entities: readonly SampleEntity[] = SAMPLE_ENTITIES): Settlement {
  const buildings: Building[] = entities.map((entity) => {
    const preset = STRUCTURE_PRESETS.find((p) => p.name === entity.building);
    if (preset === undefined) throw new Error(`There is no building called ${entity.building}.`);
    const facts = Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(entity.facts)]));
    const built = realize(preset.blueprint, structure, lib, { seed: seedOf(`terrain-lab/${entity.facts.path}`), facts });
    const view = createPlant({ ...built, parts: mergeParts(built.parts) }, light);
    const represented = representEntity(entity.facts);
    view.setVitality(represented.report.vitality);
    return {
      entity,
      represented,
      kindName: preset.name,
      view,
      plan: built.slots.get("footprint")?.output as BuildingPlan,
      beside: extentOf(built.slots.get("feature")?.output as Built | undefined),
      site: { x: 0, z: 0, yaw: 0, level: 0 },
    };
  });

  return {
    buildings,
    requests: () => buildings.map((b) => ({ name: b.represented.name, plan: b.plan, beside: b.beside })),
    seat(sites) {
      buildings.forEach((b, i) => {
        b.site = sites[i] ?? b.site;
        b.view.object.position.set(b.site.x, b.site.level, b.site.z);
        b.view.object.rotation.y = b.site.yaw;
      });
    },
    blocked: (x, z, margin) => buildings.some((b) => blockedBy(b, b.site, x, z, margin)),
    clearings: () => buildings.flatMap((b) => buildingClearings(b, b.site)),
    signOf: (b) => signOf(b.plan, b.site),
    standOf: (b) => standOf(b.plan, b.site),
    views: () => buildings.map((b) => b.view),
  };
}
