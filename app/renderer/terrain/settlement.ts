// The terrain lab's buildings: one for each sample entity, each the
// hand-filled building Jev might choose for it, standing near the stream on
// its own leveled pad, apart from the others. The bake thread finds the
// sites and levels the pads (`standWorld`); the settlement stands each
// building on its site. Their walls and features stop the walk and clear the
// grass, and each has a signboard at the end of its walk naming what it
// stands for.

import { type Blueprint, type BuildingPlan, type Built, Library, type Palette, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { structure } from "@gaia/kinds";
import { STRUCTURE_PRESETS, mergeParts } from "@gaia/realize";
import { type PlantView, type SceneLight, createPlant } from "@gaia/render";
import type { BuildingSite, Capsule, Extent } from "@gaia/terrain";
import type * as THREE from "three";
import { type BuildAsk, made } from "./made.ts";
import { type Represented, SAMPLE_ENTITIES, type SampleEntity, representEntity } from "./samples.ts";
import { type StandBuilding, blockedBy, buildingClearings, extentOf, signOf, standOf } from "./stand.ts";

export interface Building {
  readonly entity: SampleEntity;
  readonly represented: Represented;
  /** The building's own name, such as "Watermill". */
  readonly kindName: string;
  /** Its meshes while its tile stands (`Settlement.stand`); null while it lies far off. */
  view: PlantView | null;
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
  /** The meshes of the buildings that stand now. */
  views(): PlantView[];
  /**
   * Stands exactly `held` into `scene`: builds the meshes of any that lie
   * far off, from the build made for it ahead (`makeAhead`) or else in
   * place, and lets go of the meshes of the rest.
   */
  stand(held: readonly Building[], scene: THREE.Object3D): void;
  /** Sets a building's vitality, standing or not. */
  setVitality(b: Building, v: number): void;
}

const lib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);

const presetOf = (entity: SampleEntity): (typeof STRUCTURE_PRESETS)[number] => {
  const preset = STRUCTURE_PRESETS.find((p) => p.name === entity.building);
  if (preset === undefined) throw new Error(`There is no building called ${entity.building}.`);
  return preset;
};

/** Each entity's building, for making ahead. */
export const settlementBuilds = (entities: readonly SampleEntity[]): BuildAsk[] =>
  entities.map((entity) => ({
    kind: "structure",
    blueprint: presetOf(entity).blueprint,
    seed: seedOf(`terrain-lab/${entity.facts.path}`),
    facts: Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(entity.facts)])),
  }));

/** A building for each entity, each the building Jev chose for it: the sample entities unless a world names its own. */
export function createSettlement(light: SceneLight, entities: readonly SampleEntity[] = SAMPLE_ENTITIES): Settlement {
  const asks = settlementBuilds(entities);
  const buildings: Building[] = entities.map((entity, i) => {
    const preset = presetOf(entity);
    const ask = asks[i] as BuildAsk;
    const built = made(ask, lib);
    const view = createPlant({ ...built, parts: mergeParts(built.parts) }, light);
    const represented = representEntity(entity.facts);
    view.setVitality(represented.report.vitality);
    return {
      entity,
      represented,
      kindName: preset.name,
      view,
      height: view.height,
      radius: view.radius,
      ask,
      vitality: represented.report.vitality,
      blueprint: preset.blueprint,
      palette: built.palette,
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
        b.view?.object.position.set(b.site.x, b.site.level, b.site.z);
        if (b.view !== null) b.view.object.rotation.y = b.site.yaw;
      });
    },
    blocked: (x, z, margin) => buildings.some((b) => blockedBy(b, b.site, x, z, margin)),
    clearings: () => buildings.flatMap((b) => buildingClearings(b, b.site)),
    signOf: (b) => signOf(b.plan, b.site),
    standOf: (b) => standOf(b.plan, b.site),
    views: () => buildings.flatMap((b) => (b.view === null ? [] : [b.view])),
    stand(held, scene) {
      const keep = new Set(held);
      for (const b of buildings) {
        if (!keep.has(b)) {
          if (b.view === null) continue;
          scene.remove(b.view.object);
          b.view.dispose();
          b.view = null;
          continue;
        }
        if (b.view !== null) continue;
        const built = made(b.ask, lib);
        const view = createPlant({ ...built, parts: mergeParts(built.parts) }, light);
        view.object.position.set(b.site.x, b.site.level, b.site.z);
        view.object.rotation.y = b.site.yaw;
        view.setVitality(b.vitality);
        scene.add(view.object);
        b.view = view;
      }
    },
    setVitality(b, v) {
      b.vitality = v;
      b.view?.setVitality(v);
    },
  };
}
