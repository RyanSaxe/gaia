// The terrain lab's buildings: one for each sample entity, each the
// hand-filled building Jev might choose for it, standing near the stream on
// its own leveled pad, apart from the others. Their walls and features stop
// the walk and clear the grass, and each has a signboard at the end of its
// walk naming what it stands for.

import { type BuildingPlan, type Built, Library, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { structure } from "@gaia/kinds";
import { STRUCTURE_PRESETS, mergeParts, realize } from "@gaia/realize";
import { type PlantView, type SceneLight, createPlant } from "@gaia/render";
import { type BuildingSite, type Capsule, type Extent, type Terrain, clearingsOf, findSite, levelPad, siteToWorld } from "@gaia/terrain";
import { type Represented, SAMPLE_ENTITIES, type SampleEntity, representEntity } from "./samples.ts";

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
  /** Finds every building's site on a new bake, levels its pad and stands it there. */
  settle(t: Terrain): void;
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

function local(site: BuildingSite, x: number, z: number): [number, number] {
  const c = Math.cos(site.yaw);
  const s = Math.sin(site.yaw);
  const dx = x - site.x;
  const dz = z - site.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

export function createSettlement(light: SceneLight): Settlement {
  const buildings: Building[] = SAMPLE_ENTITIES.map((entity) => {
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

  const doorOf = (b: Building): number => b.plan.openings.find((o) => o.kind === "door")?.position[0] ?? 0;

  return {
    buildings,
    settle(t) {
      const taken: BuildingSite[] = [];
      for (const b of buildings) {
        b.site = findSite(t, b.plan, taken, 30, b.beside);
        levelPad(t, b.plan, b.site, b.beside);
        taken.push(b.site);
        b.view.object.position.set(b.site.x, b.site.level, b.site.z);
        b.view.object.rotation.y = b.site.yaw;
      }
    },
    blocked(x, z, margin) {
      return buildings.some((b) => {
        const [lx, lz] = local(b.site, x, z);
        const inHouse = Math.abs(lx) < b.plan.width / 2 + margin && Math.abs(lz) < b.plan.depth / 2 + margin;
        const e = b.beside;
        return inHouse || (e !== null && lx > e.x0 - margin && lx < e.x1 + margin && lz > e.z0 - margin && lz < e.z1 + margin);
      });
    },
    clearings() {
      return buildings.flatMap((b) => {
        const out = clearingsOf(b.plan, b.site);
        const e = b.beside;
        if (e !== null) {
          const wide = e.x1 - e.x0 >= e.z1 - e.z0;
          const r = Math.min(e.x1 - e.x0, e.z1 - e.z0) / 2 + 0.3;
          const cx = (e.x0 + e.x1) / 2;
          const cz = (e.z0 + e.z1) / 2;
          const run = Math.abs(e.x1 - e.x0 - (e.z1 - e.z0)) / 2;
          const [ax, az] = siteToWorld(b.site, wide ? cx - run : cx, wide ? cz : cz - run);
          const [bx, bz] = siteToWorld(b.site, wide ? cx + run : cx, wide ? cz : cz + run);
          out.push({ ax, az, bx, bz, radius: r });
        }
        return out;
      });
    },
    signOf(b) {
      const [x, z] = siteToWorld(b.site, doorOf(b) + 1.35, b.plan.depth / 2 + 4.9);
      return { x, z, yaw: b.site.yaw };
    },
    standOf(b) {
      const [x, z] = siteToWorld(b.site, doorOf(b) + 0.5, b.plan.depth / 2 + 6.6);
      return { x, z };
    },
    views: () => buildings.map((b) => b.view),
  };
}
