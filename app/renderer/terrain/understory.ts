// The terrain lab's understory: rocks in groups, bushes in thickets and
// drifts of wildflowers, scattered by @gaia/terrain and drawn as one
// InstancedMesh per part and level of detail of each blueprint, so a hundred
// bushes cost a handful of draw calls, and each pass draws only the cells it
// can see. Placement reruns whenever the land is rebaked.

import * as THREE from "three";
import { type AnyKind, type Library, seedOf } from "@gaia/schema";
import { flora, rock, wildflowers } from "@gaia/kinds";
import { FLOWER_PRESETS, type Preset, ROCK_PRESETS, type Realized, SHRUB_PRESETS, realize } from "@gaia/realize";
import { type PlantInstances, type SceneLight, createPlantInstances } from "@gaia/render";
import { type Habitat, type Occupied, type Placement, type ScatterRule, type Terrain, type WorldSpec, scatterComponents } from "@gaia/terrain";
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
  /** Each preset's chance by kind of place, in preset order. */
  readonly places: readonly Partial<Record<Habitat, number>>[];
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

/**
 * Each thing of the understory grows where it belongs: shrubs at a wood's
 * edge and under its canopy, bluebells on the woodland floor, meadow flowers
 * in the open, marsh marigolds and feathery reed-like shrubs by water,
 * stones on dry or steep ground. Nothing scatters over open meadow but
 * flowers and the odd stone; wild brush grows only past the land.
 */

const GROUPS: readonly Group[] = [
  {
    id: "rocks",
    kind: rock,
    ...seeded(ROCK_PRESETS, [3, 0.5, 1, 2, 1, 0.7], 2),
    casts: true,
    clears: 0.92,
    rule: { groups: 3.5, members: [1, 4], spread: 6, mix: "member", scale: [0.7, 1.25], maxSlope: 22, waterClearance: 1.5, ground: "lowest", sink: 0.05, places: { dry: 3, wet: 0.7, under: 0.4, edge: 0.5, open: 0.18 } },
    landforms: { "terraces@1": 1.8, "basin@1": 1.4, "valley@1": 1, "rolling-hills@1": 1, "meadow@1": 0.6, "dunes@1": 0.3 },
    // Mossy boulder, standing stone, bench stone, stone family, shale ledge, sandstone.
    places: [{ under: 2.5, wet: 2.5, edge: 1.5 }, { dry: 0.5, under: 0.3 }, { open: 1.5 }, { edge: 1.5, under: 1.5 }, { dry: 3, open: 0.3 }, { dry: 2, open: 1.2, under: 0.2 }],
  },
  {
    id: "shrubs",
    kind: flora,
    ...seeded(SHRUB_PRESETS, [1, 1, 0.7, 0.6], 3),
    casts: true,
    clears: 0.55,
    rule: { groups: 5, members: [1, 5], spread: 5, mix: "member", scale: [0.75, 1.2], maxSlope: 24, waterClearance: 2, ground: "lowest", sink: 0.06, places: { edge: 1.7, under: 0.5, wet: 1.2, dry: 0.3, open: 0.02 } },
    landforms: { "valley@1": 1.3, "rolling-hills@1": 1.2, "basin@1": 1, "terraces@1": 0.8, "meadow@1": 0.7, "dunes@1": 0.4 },
    // Box mound, blueberry, rhododendron, feather shrub (the reeds' stand-in by water).
    places: [{ edge: 1.2, dry: 2, under: 0.4, wet: 0.1 }, { edge: 1, under: 1.8, wet: 0.1 }, { under: 1.6, edge: 0.9, wet: 0.1 }, { wet: 6, edge: 0.25, under: 0.2, dry: 0.5 }],
  },
  {
    id: "flowers",
    kind: wildflowers,
    ...seeded(FLOWER_PRESETS, [1.2, 1, 0.8, 0.8, 0.8, 0.7], 1),
    casts: false,
    clears: 0,
    rule: { groups: 6.5, members: [2, 5], spread: 7, mix: "group", scale: [0.8, 1.15], maxSlope: 20, waterClearance: 1, ground: "plane", sink: 0.02, places: { open: 1.3, edge: 1, under: 0.9, wet: 1.4, dry: 0.5 } },
    landforms: { "meadow@1": 1.6, "rolling-hills@1": 1.3, "valley@1": 1.1, "basin@1": 0.8, "terraces@1": 0.7, "dunes@1": 0.3 },
    // Daisies, poppies, bluebells (the woodland floor), lupines, marigolds (marsh marigolds by water), pink asters.
    places: [{ open: 2, edge: 0.8, under: 0, wet: 0.2, dry: 0.6 }, { open: 1, dry: 2.5, under: 0, wet: 0 }, { under: 6, edge: 1.6, open: 0.05, wet: 0.2, dry: 0 }, { open: 1, wet: 1.4, edge: 0.6, under: 0 }, { wet: 6, open: 0.25, edge: 0.2, under: 0, dry: 0 }, { open: 1.2, edge: 0.7, under: 0, wet: 0.2 }],
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
  /** The rules and seed `place` scatters with, as plain data, so a bake thread can scatter ahead of time; `density` multiplies every group's count. */
  plan(world: WorldSpec, density?: number): { rules: ScatterRule[]; seed: number; open: (Habitat | undefined)[] };
  /**
   * Scatters everything again over freshly baked land, keeping clear of the
   * trees, at `density` times every group's count; or, given `placed` (what
   * `plan`'s rules and seed gave on this land elsewhere), stands those.
   */
  place(terrain: Terrain, world: WorldSpec, trees: readonly Occupied[], density?: number, placed?: readonly Placement[]): void;
  /** Instances that cast into the sun's shadow map. */
  readonly casters: () => readonly PlantInstances[];
  /** Objects the shadow pass hides: drifts of flowers are too fine to cast. */
  readonly quiet: () => readonly THREE.Object3D[];
  /** Every instanced blueprint, for culling each pass and forcing detail. */
  readonly all: () => readonly PlantInstances[];
  readonly placements: () => readonly Placement[];
  /** Sets each placement's vitality, by its index in `placements()`, on its copy; nothing moves or rebuilds. */
  setVitality(vitality: ArrayLike<number>): void;
  /** A placed component's reach at the ground in 48 directions and its top above its origin, at scale 1, by the rule and variant its placement names. */
  readonly footprint: (rule: string, variant: number) => { readonly outline: Float32Array; readonly top: number } | undefined;
  /** Shows or hides everything, for comparing frame costs. */
  show(on: boolean): void;
  /** What was placed, its triangles at full detail, its meshes, and the triangles the last pass drew. */
  readonly stats: () => { placed: Record<string, number>; triangles: number; meshes: number; drawn: number };
}

export function createUnderstory(scene: THREE.Scene, light: SceneLight, lib: Library, clearings: Clearings): Understory {
  const built = GROUPS.map((g) => {
    const plants = g.presets.map((p, i) => realize(p.blueprint, g.kind, lib, { seed: seedOf(`terrain-lab/${g.id}/${i}`), facts: { scale: 1, age: 120 } }));
    const reach = plants.map(outlineOf);
    const tops = plants.map((p) => p.parts.reduce((top, part) => part.positions.reduce((t, v, i) => (i % 3 === 1 ? Math.max(t, v) : t), top), 0));
    return { group: g, plants, radii: plants.map(footprintOf), reach, tops, outlines: reach.map((o) => o.map((r) => r * g.clears)) };
  });
  const views: { group: Group; view: PlantInstances }[] = [];
  /** Each blueprint's instances by rule and variant, kept for the life of the lab. */
  const kept = new Map<string, { group: Group; view: PlantInstances }>();
  let placed: readonly Placement[] = [];
  /** Each placement's blueprint and its copy among that blueprint's instances. */
  let copies: readonly { readonly key: string; readonly copy: number }[] = [];
  const plan = (world: WorldSpec, density = 1): { rules: ScatterRule[]; seed: number; open: (Habitat | undefined)[] } => ({
    rules: built.map(({ group, radii }) => ({
      ...group.rule,
      groups: group.rule.groups * density,
      id: group.id,
      variants: radii.map((radius, i) => ({ radius, weight: group.weights[i] ?? 1, places: group.places[i % group.places.length] ?? {} })),
      regions: world.regions.map((r) => group.landforms[r.biome.slots.relief?.use ?? ""] ?? 1),
    })),
    seed: seedOf("terrain-lab/understory"),
    // Terraces and dunes are dry, stony ground where nothing else says otherwise.
    open: world.regions.map((r) => (r.biome.slots.relief?.use === "terraces@1" || r.biome.slots.relief?.use === "dunes@1" ? "dry" : undefined)),
  });

  return {
    plan,
    place(terrain, world, trees, density = 1, given) {
      if (given !== undefined) placed = given;
      else {
        const { rules, seed, open } = plan(world, density);
        placed = scatterComponents(terrain, rules, seed, trees, { canopy: trees, open });
      }
      clearings.update(
        placed.flatMap((p) => {
          const b = built.find((x) => x.group.id === p.rule);
          const outline = b?.outlines[p.variant];
          return b === undefined || outline === undefined || b.group.clears === 0 ? [] : [{ x: p.x, z: p.z, yaw: p.yaw, scale: p.scale, outline }];
        }),
      );
      // Each blueprint keeps its instances from bake to bake and only moves its
      // copies, so a new world never rebuilds a blueprint's geometry or levels.
      for (const { group, plants } of built) {
        plants.forEach((plant, variant) => {
          const spots = placed
            .filter((p) => p.rule === group.id && p.variant === variant)
            .map((p) => ({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, scale: p.scale, slope: p.slope, hue: ((((p.x * 12.9898 + p.z * 78.233) % 1) + 1) % 1) * 0.04 - 0.02, ...(p.vitality === undefined ? {} : { vitality: p.vitality }) }));
          const key = `${group.id}/${variant}`;
          const had = kept.get(key);
          if (had !== undefined) {
            had.view.respot(spots);
            return;
          }
          if (spots.length === 0) return;
          const view = createPlantInstances(plant, light, spots);
          scene.add(view.object);
          const entry = { group, view };
          kept.set(key, entry);
          views.push(entry);
        });
      }
      const counts = new Map<string, number>();
      copies = placed.map((p) => {
        const key = `${p.rule}/${p.variant}`;
        const copy = counts.get(key) ?? 0;
        counts.set(key, copy + 1);
        return { key, copy };
      });
    },
    setVitality(vitality) {
      copies.forEach((c, i) => kept.get(c.key)?.view.setVitalityAt(c.copy, vitality[i] ?? 1));
    },
    casters: () => views.filter((v) => v.group.casts).map((v) => v.view),
    quiet: () => views.filter((v) => !v.group.casts).map((v) => v.view.object),
    all: () => views.map((v) => v.view),
    placements: () => placed,
    footprint: (rule, variant) => {
      const b = built.find((x) => x.group.id === rule);
      const outline = b?.reach[variant];
      return b === undefined || outline === undefined ? undefined : { outline, top: b.tops[variant] ?? 0 };
    },
    show(on) {
      for (const v of views) v.view.object.visible = on;
    },
    stats: () => ({
      placed: Object.fromEntries(GROUPS.map((g) => [g.id, placed.filter((p) => p.rule === g.id).length])),
      triangles: views.reduce((n, v) => n + v.view.triangles, 0),
      meshes: views.reduce((n, v) => n + v.view.object.children.length, 0),
      drawn: views.reduce((n, v) => n + v.view.drawn().triangles, 0),
    }),
  };
}
