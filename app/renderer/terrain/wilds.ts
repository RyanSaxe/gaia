// What grows on the wild land past the codebase's land: the wild's own two
// ground covers (tall green grass and tall dry grass, which the ground and the
// grass draw) and scattered wild bushes and scrub, drawn as instanced copies like the
// understory. It stands for nothing, so nothing here has a sign, a card or a
// vitality from code: it is always healthy.
//
// Bushes stand in seeded thickets on a fixed world grid, so a bush never
// moves. Only those near enough to be seen stand: around an anchor that
// follows the person in jumps, out to just past where land has fully
// dissolved into the sky (1.4 km). The copies that come and go when it jumps
// lie past that distance, so nothing ever appears or vanishes in view.

import type * as THREE from "three";
import { type GroundSpec, type Library, blueprintOf, seedOf } from "@gaia/schema";
import { biome, flora } from "@gaia/kinds";
import { type Realized, realize, realizeRegion } from "@gaia/realize";
import type { InstanceSpot, SceneLight } from "@gaia/render";
import { NO_SHIFT, hex } from "@gaia/primitives";
import { type Terrain, WILD_THICKETS, wildHeightAt, wildThicket } from "@gaia/terrain";
import type { RegionCovers } from "./regions.ts";
import { type Copies, createCopies } from "./woods.ts";

export const WILD_GROWTH = {
  /**
   * Bushes stand within `reach` of the anchor, which jumps to the person once
   * they are `recenter` from it, meters: `reach - recenter` stays past the
   * 1.4 km where land has fully dissolved, so no copy that comes or goes is seen.
   */
  reach: 1640,
  recenter: 200,
  /** How far a bush sinks into the ground, meters. */
  sink: 0.08,
  /** Every wild thing is healthy. */
  vitality: 0.9,
  /** The wild's covers grow this share of their blades: a little sparser than the land, so the tall blades cost no more than a tall cover on the land. */
  density: 0.9,
} as const;

/**
 * The wild's covers, in the ground cover's own words: tall unkempt green
 * grass, and dry golden grass in patches through it.
 */
const WILD_COVERS = [
  { cover: "lush grass", length: "tall and unkempt", wildflowers: "a scattering" },
  { cover: "golden steppe", length: "tall and unkempt", wildflowers: "none" },
] as const;

/** Wild bushes in the flora kind's words: a tangle of grey-green scrub and a rounded bush. */
const WILD_BUSHES = [
  blueprintOf("flora", {
    form: { use: "thicket@1", params: { habit: "spreading", stems: "a few stems", stature: "waist-high" } },
    bark: { use: "bark@1", params: { roughness: "smooth" } },
    crown: { use: "leaf-mound@1", params: { leaves: "rounded", fullness: "full" } },
    motion: { use: "sway@1", params: { stiffness: "stiff", rhythm: "gentle" } },
    palette: { use: "palette@1", params: { family: "desert-sage", contrast: "balanced" } },
  }),
  blueprintOf("flora", {
    form: { use: "thicket@1", params: { habit: "mound", stems: "a few stems", stature: "head-high" } },
    bark: { use: "bark@1", params: { roughness: "smooth" } },
    crown: { use: "leaf-mound@1", params: { leaves: "rounded", fullness: "full" } },
    motion: { use: "sway@1", params: { stiffness: "stiff", rhythm: "gentle" } },
    palette: { use: "palette@1", params: { family: "deep-forest", contrast: "balanced" } },
  }),
];

export interface WildGrowth {
  /** Every instanced blueprint, for culling each pass, warming and the sun's shadow. */
  readonly all: () => readonly Copies[];
  /** Takes on a new bake: stands the bushes again around the anchor. */
  update(t: Terrain): void;
  /** Called every frame the person walks: the anchor jumps to them once they are far from it. */
  follow(x: number, z: number): void;
  /** Shows the bushes walking and hides them in views from above, where they would stand past the coarse wild ring. */
  show(on: boolean): void;
}

/** One world cell's thicket (`wildThicket`), if it holds one: which blueprint, and its bushes standing on the ground. */
function thicketIn(t: Terrain, ci: number, cj: number, variants: number): { variant: number; spots: InstanceSpot[] } | null {
  const thicket = wildThicket(t, ci, cj);
  if (thicket === null) return null;
  const spots = thicket.bushes.map((b): InstanceSpot => {
    const y = wildHeightAt(t, b.x, b.z);
    return {
      x: b.x,
      y: y - WILD_GROWTH.sink,
      z: b.z,
      yaw: b.yaw,
      scale: b.scale,
      slope: [(wildHeightAt(t, b.x + 0.5, b.z) - y) * 2, (wildHeightAt(t, b.x, b.z + 0.5) - y) * 2],
      vitality: WILD_GROWTH.vitality,
      hue: b.hue,
      seed: b.seed,
    };
  });
  return { variant: Math.floor(thicket.pick * variants), spots };
}

/**
 * Each bush blueprint's copies within `WILD_GROWTH.reach` of (ax, az).
 * `cache` keeps each cell's thicket from one call to the next, so a jump of
 * the anchor seeds only the cells it newly reaches.
 */
function wildSpots(t: Terrain, ax: number, az: number, variants: number, cache: Map<string, ReturnType<typeof thicketIn>>): InstanceSpot[][] {
  const { reach } = WILD_GROWTH;
  const { cell } = WILD_THICKETS;
  const out: InstanceSpot[][] = Array.from({ length: variants }, () => []);
  const lo = (v: number): number => Math.floor((v - reach) / cell);
  const hi = (v: number): number => Math.ceil((v + reach) / cell);
  for (let cj = lo(az); cj <= hi(az); cj++) {
    for (let ci = lo(ax); ci <= hi(ax); ci++) {
      if (Math.hypot((ci + 0.5) * cell - ax, (cj + 0.5) * cell - az) > reach) continue;
      const key = `${ci},${cj}`;
      let thicket = cache.get(key);
      if (thicket === undefined) {
        thicket = thicketIn(t, ci, cj, variants);
        cache.set(key, thicket);
      }
      if (thicket !== null) out[thicket.variant]?.push(...thicket.spots);
    }
  }
  // Forget cells long out of reach, so a long walk keeps a bounded cache.
  if (cache.size > 40_000) cache.clear();
  return out;
}

/** The wild's covers, realized as a region's cover is, with no season. */
function wildGround(lib: Library): [GroundSpec, GroundSpec] {
  const season = { swatches: {}, ground: NO_SHIFT, frost: 0, fall: hex(0xd9a04a) };
  const [a, b] = WILD_COVERS.map((params, i) => {
    const blueprint = blueprintOf("biome", {
      relief: { use: "meadow@1", params: { undulation: "softly undulating", tilt: "level", facing: "north" } },
      cover: { use: "ground-cover@1", params: { ...params } },
      natives: { use: "native-families@1", params: { families: [] } },
    });
    const ground = realizeRegion({ blueprint, kind: biome }, lib, seedOf(`wilds/cover-${i}`), season).ground;
    return { ...ground, density: ground.density * WILD_GROWTH.density };
  });
  return [a as GroundSpec, b as GroundSpec];
}

/**
 * The wild's growth: hands the wild's covers to the ground and the grass,
 * and stands its bushes. `biomeLib` holds the biome primitives, `floraLib`
 * the flora ones.
 */
export function createWildGrowth(scene: THREE.Scene, light: SceneLight, covers: RegionCovers, biomeLib: Library, floraLib: Library): WildGrowth {
  covers.wild(wildGround(biomeLib));
  const plants: Realized[] = WILD_BUSHES.map((bp, i) => realize(bp, flora, floraLib, { seed: seedOf(`wilds/bush-${i}`), facts: { scale: 1, age: 120 } }));
  const views = plants.map((p) => {
    const view = createCopies(p, light, []);
    scene.add(view.object);
    return view;
  });
  let terrain: Terrain | null = null;
  const cache = new Map<string, ReturnType<typeof thicketIn>>();
  const anchor = { x: 0, z: 0 };
  /** Respots still to make, one blueprint a frame, so a jump never costs one frame much. */
  let queue: { view: Copies; spots: InstanceSpot[] }[] = [];
  const stand = (t: Terrain, now: boolean): void => {
    const spots = wildSpots(t, anchor.x, anchor.z, views.length, cache);
    queue = views.map((view, i) => ({ view, spots: spots[i] ?? [] }));
    if (now) {
      for (const q of queue) q.view.respot(q.spots);
      queue = [];
    }
  };
  return {
    all: () => views,
    show(on) {
      for (const v of views) v.object.visible = on;
    },
    update(t) {
      terrain = t;
      cache.clear();
      stand(t, true);
    },
    follow(x, z) {
      const next = queue.shift();
      if (next !== undefined) next.view.respot(next.spots);
      if (terrain === null || Math.hypot(x - anchor.x, z - anchor.z) <= WILD_GROWTH.recenter) return;
      anchor.x = Math.round(x / WILD_THICKETS.cell) * WILD_THICKETS.cell;
      anchor.z = Math.round(z / WILD_THICKETS.cell) * WILD_THICKETS.cell;
      stand(terrain, false);
    },
  };
}
