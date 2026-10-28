// Grows the wild land past the codebase's land: the wild's two ground covers,
// tall green grass and tall dry grass, and scattered thickets of the bush Jev
// composed for each cover (`composeWorld`), drawn as instanced copies like the
// understory. The wild represents no code, so it has no signs, cards or code
// vitality.
//
// Thickets are seeded on a fixed world grid, so a bush never moves. Only the
// thickets around an anchor that follows the person in jumps are placed, and
// the copies a jump adds or removes lie past 1.4 km, where land has fully
// dissolved into the sky, so nothing changes in view.

import type * as THREE from "three";
import { type Blueprint, type GroundSpec, type Library, blueprintOf, seedOf } from "@gaia/schema";
import { biome } from "@gaia/kinds";
import { type Realized, realizeRegion } from "@gaia/realize";
import type { InstanceSpot, SceneLight } from "@gaia/render";
import { type Terrain, WILD_THICKETS, wildHeightAt, wildPatch, wildThicket } from "@gaia/terrain";
import type { Clearing, Clearings } from "./clearings.ts";
import { WILD_GROUNDS } from "./looks.ts";
import { type BuildAsk, made, makeLater, plantAsk } from "./made.ts";
import type { RegionCovers } from "./regions.ts";
import { SHRUB_CLEARS, outlineOf } from "./understory.ts";
import { type Copies, FAR, type FarForms, type FarOf, createCopies } from "./woods.ts";

export const WILD_GROWTH = {
  /**
   * Bushes are placed within `reach` meters of the anchor, which jumps to the
   * person once they are `recenter` meters from it. `reach - recenter` stays
   * past the 1.4 km where land has fully dissolved, so no copy that comes or
   * goes is seen.
   */
  reach: 1640,
  recenter: 200,
  /** How far a bush sinks into the ground, meters. */
  sink: 0.08,
  /** The fixed vitality of every wild thing. */
  vitality: 0.9,
  /** The share of blades the wild's covers grow, a little sparser than the land, so the tall blades cost no more than a tall cover on the land. */
  density: 0.9,
} as const;

export interface WildGrowth {
  /** Every instanced blueprint, for culling each pass, warming and the sun's shadow. */
  readonly all: () => readonly Copies[];
  /** Each bush's blueprint, build and far form, for the swap test. */
  readonly farBuilds: () => readonly { readonly blueprint: Blueprint; readonly plant: () => Realized; readonly far: FarOf }[];
  /**
   * Makes the build, far form and instances of the bush Jev composed for each wild ground (`CodeWorld.wild`, in
   * `WILD_GROUNDS` order), once, when the world opens and before anything is placed.
   */
  build(blueprints: readonly Blueprint[]): void;
  /** Updates for a new bake and places the bushes again around the anchor. */
  update(t: Terrain): void;
  /** Call every frame the person walks. The anchor jumps to them once they are `WILD_GROWTH.recenter` from it. */
  follow(x: number, z: number): void;
  /** Shows the bushes while walking and hides them in views from above, where they would lie past the coarse wild ring. */
  show(on: boolean): void;
}

/** One world cell's thicket (`wildThicket`), if it has one: the ground whose bush it uses, and its bushes set on the ground. */
function thicketIn(t: Terrain, ci: number, cj: number, grounds: number): { ground: number; spots: InstanceSpot[] } | null {
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
  // Pick the ground at the cell's center as the covers mingle. The first ground is the green grass, the last the golden steppe.
  const { cell } = WILD_THICKETS;
  return { ground: Math.min(grounds - 1, Math.floor(wildPatch((ci + 0.5) * cell, (cj + 0.5) * cell) * grounds)), spots };
}

/** Each cell's thicket, once seeded, by "ci,cj". */
type Thickets = Map<string, ReturnType<typeof thicketIn>>;

/** Cell (ci, cj)'s thicket, seeded once and kept in `cache`. */
function thicketOf(t: Terrain, ci: number, cj: number, grounds: number, cache: Thickets): ReturnType<typeof thicketIn> {
  const key = `${ci},${cj}`;
  let thicket = cache.get(key);
  if (thicket === undefined) {
    thicket = thicketIn(t, ci, cj, grounds);
    cache.set(key, thicket);
  }
  return thicket;
}

/** Whether cell (ci, cj)'s thicket is placed around an anchor at (ax, az): its cell's center is within `WILD_GROWTH.reach`. */
const standsAround = (ci: number, cj: number, ax: number, az: number): boolean => Math.hypot((ci + 0.5) * WILD_THICKETS.cell - ax, (cj + 0.5) * WILD_THICKETS.cell - az) <= WILD_GROWTH.reach;

/**
 * Each ground's bush's copies within `WILD_GROWTH.reach` of (ax, az).
 * `cache` keeps each cell's thicket from one call to the next, so a jump of
 * the anchor seeds only the cells it newly reaches.
 */
function wildSpots(t: Terrain, ax: number, az: number, grounds: number, cache: Thickets): InstanceSpot[][] {
  const { reach } = WILD_GROWTH;
  const { cell } = WILD_THICKETS;
  const out: InstanceSpot[][] = Array.from({ length: grounds }, () => []);
  const lo = (v: number): number => Math.floor((v - reach) / cell);
  const hi = (v: number): number => Math.ceil((v + reach) / cell);
  for (let cj = lo(az); cj <= hi(az); cj++) {
    for (let ci = lo(ax); ci <= hi(ax); ci++) {
      if (!standsAround(ci, cj, ax, az)) continue;
      const thicket = thicketOf(t, ci, cj, grounds, cache);
      if (thicket !== null) out[thicket.ground]?.push(...thicket.spots);
    }
  }
  // Forget cells long out of reach, so a long walk keeps a bounded cache.
  if (cache.size > 40_000) cache.clear();
  return out;
}

/**
 * The ground kept clear of grass under every bush placed around (ax, az)
 * (`wildSpots`) that could reach the area from (x0, z0) to (x1, z1). `clears`
 * has each ground's bush's cleared outline at scale 1.
 */
function wildClearings(t: Terrain, ax: number, az: number, x0: number, z0: number, x1: number, z1: number, clears: readonly Float32Array[], cache: Thickets): Clearing[] {
  const { cell, spread, scale } = WILD_THICKETS;
  let farthest = 0;
  for (const outline of clears) for (const r of outline) farthest = Math.max(farthest, r);
  // A bush lies within `spread` of its thicket's center, which is in the thicket's cell.
  const margin = spread + farthest * scale[1];
  const out: Clearing[] = [];
  for (let cj = Math.floor((z0 - margin) / cell); cj <= Math.floor((z1 + margin) / cell); cj++) {
    for (let ci = Math.floor((x0 - margin) / cell); ci <= Math.floor((x1 + margin) / cell); ci++) {
      if (!standsAround(ci, cj, ax, az)) continue;
      const thicket = thicketOf(t, ci, cj, clears.length, cache);
      const outline = thicket === null ? undefined : clears[thicket.ground];
      if (thicket === null || outline === undefined) continue;
      for (const s of thicket.spots) out.push({ x: s.x, z: s.z, yaw: s.yaw, scale: s.scale, outline });
    }
  }
  return out;
}

/** The wild's covers, realized as a region's cover is. */
function wildGround(lib: Library): [GroundSpec, GroundSpec] {
  const [a, b] = WILD_GROUNDS.map((params, i) => {
    const blueprint = blueprintOf("biome", {
      relief: { use: "meadow@1", params: { undulation: "softly undulating", tilt: "level", facing: "north" } },
      cover: { use: "ground-cover@1", params: { ...params } },
      natives: { use: "native-families@1", params: { families: [] } },
    });
    const ground = realizeRegion({ blueprint, kind: biome }, lib, seedOf(`wilds/cover-${i}`)).ground;
    return { ...ground, density: ground.density * WILD_GROWTH.density };
  });
  return [a as GroundSpec, b as GroundSpec];
}

/**
 * Creates the wild's growth. It gives the wild's covers to the ground and the
 * grass, and places its bushes once a world provides them (`build`), each
 * clearing the grass at its base in `clearings`. `biomeLib` has the biome
 * primitives and `floraLib` the flora ones. `farForms` receives each bush's
 * far form. Without it, no bush has one.
 */
export function createWildGrowth(scene: THREE.Scene, light: SceneLight, covers: RegionCovers, biomeLib: Library, floraLib: Library, clearings: Clearings, farForms?: FarForms): WildGrowth {
  covers.wild(wildGround(biomeLib));
  let views: Copies[] = [];
  let builds: { readonly blueprint: Blueprint; readonly plant: () => Realized; readonly far: FarOf }[] = [];
  /** Each ground's bush's ground outline that clears the grass, at scale 1. */
  let clears: Float32Array[] = [];
  let shown = true;
  let terrain: Terrain | null = null;
  const cache: Thickets = new Map();
  const anchor = { x: 0, z: 0 };
  // Until the bushes are built, return none and seed no thicket, since a thicket's bush is one of the grounds' built bushes.
  clearings.setNear((x0, z0, x1, z1) => (terrain === null || clears.length === 0 ? [] : wildClearings(terrain, anchor.x, anchor.z, x0, z0, x1, z1, clears, cache)));
  /** Pending respots, one blueprint a frame, so a jump never costs one frame much. */
  let queue: { view: Copies; spots: InstanceSpot[] }[] = [];
  const stand = (t: Terrain, now: boolean): void => {
    if (views.length === 0) return;
    const spots = wildSpots(t, anchor.x, anchor.z, views.length, cache);
    queue = views.map((view, i) => ({ view, spots: spots[i] ?? [] }));
    if (now) {
      for (const q of queue) q.view.respot(q.spots);
      queue = [];
    }
  };
  return {
    all: () => views,
    farBuilds: () => builds,
    build(blueprints) {
      if (views.length > 0) throw new Error("The wild builds a world's bushes once, when it opens.");
      if (blueprints.length !== WILD_GROUNDS.length) throw new Error(`The wild has ${WILD_GROUNDS.length} grounds, each with its own bush; the world gives ${blueprints.length}.`);
      const asks = blueprints.map(plantAsk);
      const plants = asks.map((ask) => made(ask, floraLib));
      clears = plants.map((p) => outlineOf(p).map((r) => r * SHRUB_CLEARS));
      const fars = plants.map((p, i) => farForms?.add(p, () => makeLater(asks[i] as BuildAsk, floraLib), FAR.bush));
      views = plants.map((p, i) => {
        const view = createCopies(p, light, [], fars[i]);
        view.object.visible = shown;
        scene.add(view.object);
        return view;
      });
      // Drop a bush's build once its instances are made and its far form is baked. The swap test realizes it again.
      builds = asks.flatMap((ask, i) => {
        const far = fars[i];
        return far === undefined ? [] : [{ blueprint: ask.blueprint, plant: () => made(ask, floraLib), far }];
      });
      if (terrain !== null) stand(terrain, true);
    },
    show(on) {
      shown = on;
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
