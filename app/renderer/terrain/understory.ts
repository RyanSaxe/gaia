// The terrain lab's understory: rocks in groups, bushes in thickets and
// drifts of wildflowers, scattered by @gaia/terrain and drawn as one
// InstancedMesh per part of each blueprint, so a hundred bushes cost a
// handful of draw calls. Placement reruns whenever the land is rebaked.

import * as THREE from "three";
import { type AnyKind, type Library, seedOf } from "@gaia/schema";
import { flora, rock, wildflowers } from "@gaia/kinds";
import { FLOWER_PRESETS, type Preset, ROCK_PRESETS, type Realized, SHRUB_PRESETS, realize } from "@gaia/realize";
import { type PlantInstances, type SceneLight, createPlantInstances } from "@gaia/render";
import { type Occupied, type Placement, type ScatterRule, type Terrain, type WorldSpec, scatterComponents } from "@gaia/terrain";
import type { Clearings } from "./clearings.ts";

interface Group {
  readonly id: string;
  readonly kind: AnyKind;
  readonly presets: readonly Preset[];
  readonly weights: readonly number[];
  /** Whether the group's instances draw into the sun's shadow map. */
  readonly casts: boolean;
  /** How much of its outline at the ground is kept clear of grass, 0 for none. */
  readonly clears: number;
  readonly rule: Omit<ScatterRule, "id" | "variants" | "regions">;
  /** Density per landform: rocks crowd terraces and basins, flowers favor open meadow. */
  readonly landforms: Readonly<Record<string, number>>;
}

/**
 * Each preset built from `n` seeds, so neighbors of one blueprint differ in
 * shape and not only in turn, size and hue. A variant is one more build and
 * one more instanced mesh per part; the shader varies each copy a little more.
 */
const seeded = (presets: readonly Preset[], weights: readonly number[], n: number): { presets: readonly Preset[]; weights: readonly number[] } => ({
  presets: Array.from({ length: n }, () => presets).flat(),
  weights: Array.from({ length: n }, () => weights.map((w) => w / n)).flat(),
});

const GROUPS: readonly Group[] = [
  {
    id: "rocks",
    kind: rock,
    ...seeded(ROCK_PRESETS, [3, 0.5, 1, 2, 1, 0.7], 2),
    casts: true,
    clears: 0.92,
    rule: { groups: 3.5, members: [1, 4], spread: 6, mix: "member", scale: [0.7, 1.25], maxSlope: 22, waterClearance: 1.5, ground: "lowest", sink: 0.05 },
    landforms: { "terraces@1": 1.8, "basin@1": 1.4, "valley@1": 1, "rolling-hills@1": 1, "meadow@1": 0.6, "dunes@1": 0.3 },
  },
  {
    id: "shrubs",
    kind: flora,
    ...seeded(SHRUB_PRESETS, [1, 1, 0.7, 0.6], 3),
    casts: true,
    clears: 0.55,
    rule: { groups: 5, members: [1, 5], spread: 5, mix: "member", scale: [0.75, 1.2], maxSlope: 24, waterClearance: 2, ground: "lowest", sink: 0.06 },
    landforms: { "valley@1": 1.3, "rolling-hills@1": 1.2, "basin@1": 1, "terraces@1": 0.8, "meadow@1": 0.7, "dunes@1": 0.4 },
  },
  {
    id: "flowers",
    kind: wildflowers,
    ...seeded(FLOWER_PRESETS, [1.2, 1, 0.8, 0.8, 0.8, 0.7], 1),
    casts: false,
    clears: 0,
    rule: { groups: 6.5, members: [2, 5], spread: 7, mix: "group", scale: [0.8, 1.15], maxSlope: 20, waterClearance: 1, ground: "plane", sink: 0.02 },
    landforms: { "meadow@1": 1.6, "rolling-hills@1": 1.3, "valley@1": 1.1, "basin@1": 0.8, "terraces@1": 0.7, "dunes@1": 0.3 },
  },
];

/** A component's reach where it meets the ground, in 48 directions around its origin. */
function outlineOf(plant: Realized): Float32Array {
  const out = new Float32Array(48);
  for (const part of plant.parts) {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) {
      const y = p[i + 1] as number;
      if (y < -0.02 || y > 0.25) continue;
      const x = p[i] as number;
      const z = p[i + 2] as number;
      const k = Math.floor(((((Math.atan2(z, x) / (Math.PI * 2)) % 1) + 1) % 1) * 48) % 48;
      out[k] = Math.max(out[k] as number, Math.hypot(x, z));
    }
  }
  // Fill directions no vertex fell in from their neighbors.
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < 48; k++) if (out[k] === 0) out[k] = Math.max(out[(k + 47) % 48] as number, out[(k + 1) % 48] as number);
  }
  return out;
}

/** The ground a realized component covers: its widest reach near the ground. */
function footprintOf(plant: Realized): number {
  let reach = 0.2;
  for (const part of plant.parts) {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) {
      if ((p[i + 1] as number) > 0.6) continue;
      reach = Math.max(reach, Math.hypot(p[i] as number, p[i + 2] as number));
    }
  }
  return reach;
}

export interface Understory {
  /** Scatters everything again over freshly baked land, keeping clear of the trees. */
  place(terrain: Terrain, world: WorldSpec, trees: readonly Occupied[]): void;
  /** Instances that cast into the sun's shadow map. */
  readonly casters: () => readonly PlantInstances[];
  /** Objects the shadow pass hides: drifts of flowers are too fine to cast. */
  readonly quiet: () => readonly THREE.Object3D[];
  readonly placements: () => readonly Placement[];
  /** Shows or hides everything, for comparing frame costs. */
  show(on: boolean): void;
  readonly stats: () => { placed: Record<string, number>; triangles: number; meshes: number };
}

export function createUnderstory(scene: THREE.Scene, light: SceneLight, lib: Library, clearings: Clearings): Understory {
  const built = GROUPS.map((g) => {
    const plants = g.presets.map((p, i) => realize(p.blueprint, g.kind, lib, { seed: seedOf(`terrain-lab/${g.id}/${i}`), facts: { scale: 1, age: 120 } }));
    return { group: g, plants, radii: plants.map(footprintOf), outlines: plants.map((p) => outlineOf(p).map((r) => r * g.clears)) };
  });
  let views: { group: Group; view: PlantInstances }[] = [];
  let placed: Placement[] = [];

  return {
    place(terrain, world, trees) {
      for (const v of views) v.view.dispose();
      views = [];
      const rules: ScatterRule[] = built.map(({ group, radii }) => ({
        ...group.rule,
        id: group.id,
        variants: radii.map((radius, i) => ({ radius, weight: group.weights[i] ?? 1 })),
        regions: world.regions.map((r) => group.landforms[r.biome.slots.relief?.use ?? ""] ?? 1),
      }));
      placed = scatterComponents(terrain, rules, seedOf("terrain-lab/understory"), trees);
      clearings.update(
        placed.flatMap((p) => {
          const b = built.find((x) => x.group.id === p.rule);
          const outline = b?.outlines[p.variant];
          return b === undefined || outline === undefined || b.group.clears === 0 ? [] : [{ x: p.x, z: p.z, yaw: p.yaw, scale: p.scale, outline }];
        }),
      );
      for (const { group, plants } of built) {
        plants.forEach((plant, variant) => {
          const spots = placed
            .filter((p) => p.rule === group.id && p.variant === variant)
            .map((p) => ({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, scale: p.scale, slope: p.slope, hue: ((((p.x * 12.9898 + p.z * 78.233) % 1) + 1) % 1) * 0.04 - 0.02 }));
          if (spots.length === 0) return;
          const view = createPlantInstances(plant, light, spots);
          scene.add(view.object);
          views.push({ group, view });
        });
      }
    },
    casters: () => views.filter((v) => v.group.casts).map((v) => v.view),
    quiet: () => views.filter((v) => !v.group.casts).map((v) => v.view.object),
    placements: () => placed,
    show(on) {
      for (const v of views) v.view.object.visible = on;
    },
    stats: () => ({
      placed: Object.fromEntries(GROUPS.map((g) => [g.id, placed.filter((p) => p.rule === g.id).length])),
      triangles: views.reduce((n, v) => n + v.view.triangles, 0),
      meshes: views.reduce((n, v) => n + v.view.object.children.length, 0),
    }),
  };
}
